const { nowIso } = require("../utils/time");

/**
 * Zenza FID — Rule Trigger Engine
 * ---------------------------------
 * Four rule types, matching the BRD's functional requirement (1.6.3):
 * threshold, velocity, pattern, and cross-entity rules.
 *
 * Every function here takes the tenant database as its first argument —
 * post-multi-tenancy, there is no global database to close over. The
 * scheduler in index.js calls runAllActiveRules(db) once per tenant
 * database, in a loop, rather than once globally.
 */

const VALID_RULE_TYPES = ["threshold", "velocity", "pattern", "cross_entity"];
const VALID_SEVERITY = ["low", "medium", "high", "critical"];

function validateConfig(ruleType, config) {
  switch (ruleType) {
    case "threshold": {
      if (typeof config.count !== "number" || config.count < 1) {
        return "threshold rules require a numeric 'count' >= 1";
      }
      if (config.identifier_type && typeof config.identifier_type !== "string") {
        return "identifier_type, if provided, must be a string";
      }
      return null;
    }
    case "velocity": {
      if (!["watchlist_entries", "entity_edits"].includes(config.metric)) {
        return "velocity rules require metric to be 'watchlist_entries' or 'entity_edits'";
      }
      if (typeof config.window_hours !== "number" || config.window_hours < 1) {
        return "velocity rules require a numeric 'window_hours' >= 1";
      }
      if (typeof config.count !== "number" || config.count < 1) {
        return "velocity rules require a numeric 'count' >= 1";
      }
      return null;
    }
    case "pattern": {
      if (!config.identifier_type || typeof config.identifier_type !== "string") {
        return "pattern rules require an identifier_type";
      }
      if (!config.pattern || typeof config.pattern !== "string") {
        return "pattern rules require a 'pattern' (regular expression) string";
      }
      if (config.pattern.length > 200) {
        return "pattern must be 200 characters or fewer";
      }
      try {
        new RegExp(config.pattern);
      } catch (e) {
        return `pattern is not a valid regular expression: ${e.message}`;
      }
      return null;
    }
    case "cross_entity": {
      return null;
    }
    default:
      return `Unknown rule_type: ${ruleType}`;
  }
}

function evaluateThreshold(db, config) {
  const { identifier_type, count } = config;
  let rows;
  if (identifier_type) {
    rows = db
      .prepare(
        `SELECT entity_id, COUNT(*) AS n FROM entity_identifiers
         WHERE identifier_type = ? GROUP BY entity_id HAVING n >= ?`
      )
      .all(identifier_type, count);
  } else {
    rows = db
      .prepare(`SELECT entity_id, COUNT(*) AS n FROM entity_identifiers GROUP BY entity_id HAVING n >= ?`)
      .all(count);
  }
  return rows.map((r) => ({
    entity_id: r.entity_id,
    reason: identifier_type
      ? `Entity has ${r.n} ${identifier_type} identifiers on file (threshold: ${count})`
      : `Entity has ${r.n} total identifiers on file (threshold: ${count})`,
  }));
}

function evaluateVelocity(db, config) {
  const { metric, window_hours, count } = config;
  const since = new Date(Date.now() - window_hours * 3600 * 1000).toISOString();
  let rows;
  if (metric === "watchlist_entries") {
    rows = db
      .prepare(
        `SELECT entity_id, COUNT(*) AS n FROM watchlist_entries
         WHERE created_at >= ? GROUP BY entity_id HAVING n >= ?`
      )
      .all(since, count);
  } else {
    rows = db
      .prepare(
        `SELECT entity_id, COUNT(*) AS n FROM entity_versions
         WHERE created_at >= ? GROUP BY entity_id HAVING n >= ?`
      )
      .all(since, count);
  }
  const label = metric === "watchlist_entries" ? "watchlist submissions" : "profile edits";
  return rows.map((r) => ({
    entity_id: r.entity_id,
    reason: `Entity had ${r.n} ${label} in the last ${window_hours}h (threshold: ${count})`,
  }));
}

function evaluatePattern(db, config) {
  const { identifier_type, pattern } = config;
  let regex;
  try {
    regex = new RegExp(pattern, "i");
  } catch {
    return [];
  }
  const rows = db
    .prepare(`SELECT entity_id, identifier_value FROM entity_identifiers WHERE identifier_type = ?`)
    .all(identifier_type);
  return rows
    .filter((r) => regex.test(r.identifier_value))
    .map((r) => ({
      entity_id: r.entity_id,
      reason: `${identifier_type} identifier matches flagged pattern (${pattern})`,
    }));
}

function evaluateCrossEntity(db) {
  const rows = db
    .prepare(
      `SELECT ei.identifier_value, ei.entity_id, e.status AS entity_status,
              (SELECT COUNT(*) FROM watchlist_entries w WHERE w.entity_id = ei.entity_id AND w.status = 'active') AS active_wl
       FROM entity_identifiers ei
       JOIN entities e ON e.id = ei.entity_id`
    )
    .all();

  const byValue = new Map();
  rows.forEach((r) => {
    if (!byValue.has(r.identifier_value)) byValue.set(r.identifier_value, []);
    byValue.get(r.identifier_value).push(r);
  });

  const results = [];
  for (const [value, group] of byValue) {
    if (group.length < 2) continue;
    const watchlisted = group.filter((g) => g.active_wl > 0);
    if (watchlisted.length === 0) continue;
    group.forEach((g) => {
      const isWatchlisted = g.active_wl > 0;
      if (!isWatchlisted) {
        const other = watchlisted[0];
        results.push({
          entity_id: g.entity_id,
          reason: `Shares identifier "${value}" with entity #${other.entity_id}, which is already actively watchlisted`,
        });
      }
    });
  }
  return results;
}

function evaluateRule(db, rule) {
  const config = JSON.parse(rule.config);
  switch (rule.rule_type) {
    case "threshold":
      return evaluateThreshold(db, config);
    case "velocity":
      return evaluateVelocity(db, config);
    case "pattern":
      return evaluatePattern(db, config);
    case "cross_entity":
      return evaluateCrossEntity(db);
    default:
      return [];
  }
}

function runRule(db, rule) {
  const matches = evaluateRule(db, rule);
  const now = nowIso();
  const existingOpen = new Set(
    db
      .prepare(`SELECT entity_id FROM alerts WHERE rule_id = ? AND status = 'open'`)
      .all(rule.id)
      .map((r) => r.entity_id)
  );

  const insert = db.prepare(
    `INSERT INTO alerts (rule_id, entity_id, triggered_reason, severity, status, created_at)
     VALUES (?, ?, ?, ?, 'open', ?)`
  );

  let created = 0;
  const txn = db.transaction(() => {
    matches.forEach((m) => {
      if (existingOpen.has(m.entity_id)) return;
      insert.run(rule.id, m.entity_id, m.reason, rule.severity, now);
      created += 1;
    });
    db.prepare(`UPDATE rules SET last_run_at = ? WHERE id = ?`).run(now, rule.id);
  });
  txn();

  return { evaluated: matches.length, created, skipped: matches.length - created };
}

function runAllActiveRules(db) {
  const activeRules = db.prepare(`SELECT * FROM rules WHERE status = 'active'`).all();
  const summary = [];
  activeRules.forEach((rule) => {
    try {
      const result = runRule(db, rule);
      summary.push({ rule_id: rule.id, name: rule.name, ...result });
    } catch (err) {
      console.error(`Rule engine: rule #${rule.id} (${rule.name}) failed to run:`, err.message);
      summary.push({ rule_id: rule.id, name: rule.name, error: err.message });
    }
  });
  return summary;
}

module.exports = {
  VALID_RULE_TYPES,
  VALID_SEVERITY,
  validateConfig,
  evaluateRule,
  runRule,
  runAllActiveRules,
};
