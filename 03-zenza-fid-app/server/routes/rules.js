const express = require("express");
const { nowIso } = require("../utils/time");
const { db: platformDb } = require("../platformDb");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { writeAudit, clientIp } = require("../middleware/audit");
const { VALID_RULE_TYPES, VALID_SEVERITY, validateConfig, evaluateRule, runRule } = require("../services/ruleEngine");

const router = express.Router();
router.use(requireAuth);

function resolveUserNames(userIds) {
  const ids = [...new Set(userIds.filter((id) => id != null))];
  if (ids.length === 0) return {};
  const rows = platformDb
    .prepare(`SELECT id, full_name FROM users WHERE id IN (${ids.map(() => "?").join(",")})`)
    .all(...ids);
  return Object.fromEntries(rows.map((r) => [r.id, r.full_name]));
}

function serializeRule(rule) {
  return { ...rule, config: JSON.parse(rule.config) };
}

// ---- list ----
router.get("/", requirePermission("rules.view"), (req, res) => {
  const db = req.tenantDb;
  const { status, rule_type } = req.query;
  let where = "WHERE 1=1";
  const params = [];
  if (status) { where += " AND r.status = ?"; params.push(status); }
  if (rule_type) { where += " AND r.rule_type = ?"; params.push(rule_type); }

  const rows = db
    .prepare(
      `SELECT r.*,
        (SELECT COUNT(*) FROM alerts a WHERE a.rule_id = r.id AND a.status = 'open') AS open_alert_count
       FROM rules r ${where} ORDER BY r.created_at DESC`
    )
    .all(...params);

  const names = resolveUserNames(rows.map((r) => r.created_by));
  const results = rows.map((r) => ({ ...serializeRule(r), created_by_name: names[r.created_by] || `User #${r.created_by}` }));

  res.json({ ok: true, results });
});

// ---- detail ----
router.get("/:id", requirePermission("rules.view"), (req, res) => {
  const rule = req.tenantDb.prepare("SELECT * FROM rules WHERE id = ?").get(req.params.id);
  if (!rule) return res.status(404).json({ ok: false, error: "Rule not found" });
  res.json({ ok: true, rule: serializeRule(rule) });
});

// ---- create (starts as draft) ----
router.post("/", requirePermission("rules.manage"), (req, res) => {
  const db = req.tenantDb;
  const { name, description = "", rule_type, config, severity } = req.body || {};

  if (!name || !name.trim()) return res.status(400).json({ ok: false, error: "name is required" });
  if (!VALID_RULE_TYPES.includes(rule_type)) {
    return res.status(400).json({ ok: false, error: `rule_type must be one of: ${VALID_RULE_TYPES.join(", ")}` });
  }
  if (!VALID_SEVERITY.includes(severity)) {
    return res.status(400).json({ ok: false, error: `severity must be one of: ${VALID_SEVERITY.join(", ")}` });
  }
  const configError = validateConfig(rule_type, config || {});
  if (configError) return res.status(400).json({ ok: false, error: configError });

  const now = nowIso();
  const result = db
    .prepare(
      `INSERT INTO rules (name, description, rule_type, config, severity, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)`
    )
    .run(name.trim(), description, rule_type, JSON.stringify(config), severity, req.user.id, now, now);

  writeAudit(db, {
    actorId: req.user.id, action: "rule.create", resourceType: "rule", resourceId: result.lastInsertRowid,
    details: { name: name.trim(), rule_type, severity }, ipAddress: clientIp(req),
  });

  const rule = db.prepare("SELECT * FROM rules WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json({ ok: true, rule: serializeRule(rule) });
});

// ---- update ----
router.put("/:id", requirePermission("rules.manage"), (req, res) => {
  const db = req.tenantDb;
  const existing = db.prepare("SELECT * FROM rules WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ ok: false, error: "Rule not found" });

  const { name, description, config, severity } = req.body || {};
  const ruleType = existing.rule_type;
  const newConfig = config !== undefined ? config : JSON.parse(existing.config);

  if (config !== undefined) {
    const configError = validateConfig(ruleType, newConfig);
    if (configError) return res.status(400).json({ ok: false, error: configError });
  }
  if (severity !== undefined && !VALID_SEVERITY.includes(severity)) {
    return res.status(400).json({ ok: false, error: `severity must be one of: ${VALID_SEVERITY.join(", ")}` });
  }

  db.prepare(
    `UPDATE rules SET name = COALESCE(?, name), description = COALESCE(?, description),
     config = ?, severity = COALESCE(?, severity), updated_at = ? WHERE id = ?`
  ).run(name, description, JSON.stringify(newConfig), severity, nowIso(), existing.id);

  writeAudit(db, { actorId: req.user.id, action: "rule.update", resourceType: "rule", resourceId: existing.id, ipAddress: clientIp(req) });

  const rule = db.prepare("SELECT * FROM rules WHERE id = ?").get(existing.id);
  res.json({ ok: true, rule: serializeRule(rule) });
});

// ---- activate ----
router.post("/:id/activate", requirePermission("rules.manage"), (req, res) => {
  const db = req.tenantDb;
  const rule = db.prepare("SELECT * FROM rules WHERE id = ?").get(req.params.id);
  if (!rule) return res.status(404).json({ ok: false, error: "Rule not found" });
  if (rule.status === "active") return res.status(409).json({ ok: false, error: "Rule is already active" });

  db.prepare("UPDATE rules SET status = 'active', updated_at = ? WHERE id = ?").run(nowIso(), rule.id);
  writeAudit(db, { actorId: req.user.id, action: "rule.activate", resourceType: "rule", resourceId: rule.id, ipAddress: clientIp(req) });
  res.json({ ok: true });
});

// ---- disable ----
router.post("/:id/disable", requirePermission("rules.manage"), (req, res) => {
  const db = req.tenantDb;
  const rule = db.prepare("SELECT * FROM rules WHERE id = ?").get(req.params.id);
  if (!rule) return res.status(404).json({ ok: false, error: "Rule not found" });

  db.prepare("UPDATE rules SET status = 'disabled', updated_at = ? WHERE id = ?").run(nowIso(), rule.id);
  writeAudit(db, { actorId: req.user.id, action: "rule.disable", resourceType: "rule", resourceId: rule.id, ipAddress: clientIp(req) });
  res.json({ ok: true });
});

// ---- simulate ----
router.post("/:id/simulate", requirePermission("rules.view"), (req, res) => {
  const db = req.tenantDb;
  const rule = db.prepare("SELECT * FROM rules WHERE id = ?").get(req.params.id);
  if (!rule) return res.status(404).json({ ok: false, error: "Rule not found" });

  const matches = evaluateRule(db, rule);
  const entityIds = matches.map((m) => m.entity_id);
  const entityNames = entityIds.length
    ? Object.fromEntries(
        db
          .prepare(`SELECT id, full_name FROM entities WHERE id IN (${entityIds.map(() => "?").join(",")})`)
          .all(...entityIds)
          .map((e) => [e.id, e.full_name])
      )
    : {};

  res.json({
    ok: true,
    simulation: true,
    matchCount: matches.length,
    matches: matches.map((m) => ({ ...m, entity_name: entityNames[m.entity_id] || `Entity #${m.entity_id}` })),
  });
});

// ---- run for real ----
router.post("/:id/run", requirePermission("rules.manage"), (req, res) => {
  const db = req.tenantDb;
  const rule = db.prepare("SELECT * FROM rules WHERE id = ?").get(req.params.id);
  if (!rule) return res.status(404).json({ ok: false, error: "Rule not found" });
  if (rule.status !== "active") {
    return res.status(409).json({ ok: false, error: "Only active rules can be run — activate it first" });
  }

  const result = runRule(db, rule);
  writeAudit(db, {
    actorId: req.user.id, action: "rule.run", resourceType: "rule", resourceId: rule.id,
    details: result, ipAddress: clientIp(req),
  });
  res.json({ ok: true, ...result });
});

module.exports = router;
