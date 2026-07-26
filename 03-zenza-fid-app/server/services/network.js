const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { db: platformDb, nowIso } = require("../platformDb");

/**
 * Cross-organization fraud intelligence network.
 * ------------------------------------------------
 * The BRD's central promise is that institutions can benefit from each
 * other's fraud knowledge WITHOUT handing each other customer data. This
 * module is where that promise is actually kept or broken, so the
 * reasoning is spelled out rather than assumed.
 *
 * WHAT CROSSES AN ORGANIZATION BOUNDARY:
 *   - A keyed hash (HMAC-SHA256) of an identifier value
 *   - The identifier TYPE (BVN / PHONE / etc.)
 *   - A category ("mule_account") and severity
 *   - A timestamp
 *
 * WHAT NEVER CROSSES:
 *   - The raw identifier value
 *   - The person's name, or any part of their profile
 *   - The analyst's reason text, notes, or attachments
 *   - WHICH organization reported it (query results are aggregate counts;
 *     the org_id column exists so an org can withdraw its OWN signals and
 *     so we can honour deletion requests, not so it can be shown to
 *     another org)
 *
 * WHY HMAC AND NOT A PLAIN HASH — this is the part that matters:
 * A Nigerian BVN is exactly 11 digits: 10^11 possible values. A plain
 * SHA-256 of that is exhaustively brute-forceable on commodity hardware.
 * Publishing plain hashes would be publishing the identifiers with extra
 * steps, while *looking* anonymous — the worst kind of privacy failure,
 * because it invites false confidence. Keying the hash with a secret
 * that never leaves this deployment defeats that attack.
 *
 * OPT-IN, NOT OPT-OUT: an organization contributes nothing and sees
 * nothing until someone deliberately enables participation. Enrolling a
 * customer's data into a sharing scheme by default is not a defensible
 * consent posture (see COMPLIANCE-NDPA.md).
 */

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const PEPPER_FILE = path.join(DATA_DIR, ".network-pepper");

/**
 * The HMAC key ("pepper"). Preferred source is the environment. If it's
 * absent we generate one and persist it, because a pepper that changed
 * on every restart would silently orphan every hash already published —
 * the network would appear to work while quietly matching nothing.
 *
 * In a real deployment this belongs in a secrets manager, and it must be
 * backed up: losing it is equivalent to losing the entire network index,
 * and rotating it invalidates every existing signal. Flagged clearly in
 * the README rather than buried here.
 */
function loadPepper() {
  if (process.env.NETWORK_HASH_PEPPER) return process.env.NETWORK_HASH_PEPPER;
  if (fs.existsSync(PEPPER_FILE)) return fs.readFileSync(PEPPER_FILE, "utf8").trim();

  const generated = crypto.randomBytes(32).toString("hex");
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PEPPER_FILE, generated, { mode: 0o600 });
  console.warn(
    "\n  Network intelligence: no NETWORK_HASH_PEPPER set — generated one and saved it to\n" +
    "  data/.network-pepper. Fine for local development. Before production, move this into\n" +
    "  your environment/secrets manager and back it up: losing or changing it invalidates\n" +
    "  every hash already published to the network.\n"
  );
  return generated;
}

const PEPPER = loadPepper();

/** Normalizes then keyed-hashes an identifier. Normalization matters:
 *  "0801 234 5678" and "08012345678" must produce the same hash or the
 *  network silently fails to match real duplicates. */
function hashIdentifier(type, value) {
  const normalized = String(value).trim().toLowerCase().replace(/[\s\-()]/g, "");
  return crypto.createHmac("sha256", PEPPER).update(`${type}:${normalized}`).digest("hex");
}

function isParticipating(orgId) {
  const org = platformDb.prepare("SELECT network_enabled, status FROM organizations WHERE id = ?").get(orgId);
  return !!(org && org.network_enabled && org.status === "active");
}

/**
 * Publishes signals for a watchlist entry that has just become ACTIVE.
 * Only approved, active entries contribute — a pending request or a
 * rejected one must never reach the network, since the whole point of
 * maker-checker is that one person's unreviewed opinion isn't actionable.
 */
function publishSignals(tenantDb, orgId, watchlistEntry) {
  if (!isParticipating(orgId)) return { published: 0, skipped: "organization is not participating in the network" };
  if (watchlistEntry.status !== "active") return { published: 0, skipped: `entry status is '${watchlistEntry.status}', only active entries are published` };

  const identifiers = tenantDb
    .prepare("SELECT identifier_type, identifier_value FROM entity_identifiers WHERE entity_id = ?")
    .all(watchlistEntry.entity_id);
  if (identifiers.length === 0) return { published: 0, skipped: "entity has no identifiers to publish" };

  const now = nowIso();
  const insert = platformDb.prepare(
    `INSERT INTO network_signals (identifier_hash, identifier_type, org_id, watchlist_id, category, severity, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(org_id, watchlist_id, identifier_hash) DO UPDATE SET withdrawn_at = NULL`
  );

  let published = 0;
  const txn = platformDb.transaction(() => {
    identifiers.forEach((id) => {
      insert.run(
        hashIdentifier(id.identifier_type, id.identifier_value),
        id.identifier_type,
        orgId,
        watchlistEntry.id,
        watchlistEntry.category,
        watchlistEntry.severity,
        now
      );
      published += 1;
    });
  });
  txn();
  return { published };
}

/**
 * Withdraws an organization's signals for one watchlist entry — called
 * whenever an entry stops being active (suspended, expired, recalled).
 * Soft withdrawal (set withdrawn_at) rather than delete, so the platform
 * audit trail of "this was shared between these dates" survives, which
 * matters for answering a regulator's question later.
 */
function withdrawSignals(orgId, watchlistId) {
  const result = platformDb
    .prepare("UPDATE network_signals SET withdrawn_at = ? WHERE org_id = ? AND watchlist_id = ? AND withdrawn_at IS NULL")
    .run(nowIso(), orgId, watchlistId);
  return { withdrawn: result.changes };
}

/**
 * Checks a set of identifiers against the network, EXCLUDING the asking
 * organization's own signals (otherwise every org would just be told
 * about itself).
 *
 * Returns aggregate counts and categories only. Deliberately does not
 * return which organizations reported, or how to contact them — that
 * would be a different product decision with different consent
 * requirements, and it isn't needed for the core value ("has anyone else
 * seen this person?").
 */
function checkIdentifiers(askingOrgId, identifiers) {
  if (!isParticipating(askingOrgId)) {
    return { participating: false, matches: [] };
  }
  if (!identifiers || identifiers.length === 0) return { participating: true, matches: [] };

  const matches = [];
  identifiers.forEach((id) => {
    const hash = hashIdentifier(id.identifier_type || id.type, id.identifier_value || id.value);
    const rows = platformDb
      .prepare(
        `SELECT category, severity, created_at, org_id FROM network_signals
         WHERE identifier_hash = ? AND withdrawn_at IS NULL AND org_id != ?`
      )
      .all(hash, askingOrgId);

    if (rows.length === 0) return;

    // Count DISTINCT organizations, not raw signal rows — one org
    // flagging the same person across two watchlist entries is one
    // corroborating institution, not two.
    const distinctOrgs = new Set(rows.map((r) => r.org_id));
    matches.push({
      identifier_type: id.identifier_type || id.type,
      // echo back which identifier matched, so the analyst knows which
      // one triggered it — this is their OWN data, safe to return
      identifier_value: id.identifier_value || id.value,
      reporting_institution_count: distinctOrgs.size,
      categories: [...new Set(rows.map((r) => r.category))],
      highest_severity: ["critical", "high", "medium", "low"].find((s) => rows.some((r) => r.severity === s)) || null,
      most_recent: rows.map((r) => r.created_at).sort().reverse()[0],
    });
  });

  return { participating: true, matches };
}

/** Purges every signal an organization ever contributed. Used when an
 *  organization is offboarded or exercises a deletion request — see
 *  COMPLIANCE-NDPA.md on data subject rights. Hard delete, not soft:
 *  a withdrawal request should leave nothing behind. */
function purgeOrgSignals(orgId) {
  const result = platformDb.prepare("DELETE FROM network_signals WHERE org_id = ?").run(orgId);
  return { purged: result.changes };
}

/** Aggregate stats for the platform admin view — counts only, no hashes,
 *  no categories tied to any organization. */
function networkStats() {
  const total = platformDb.prepare("SELECT COUNT(*) AS n FROM network_signals WHERE withdrawn_at IS NULL").get().n;
  const contributing = platformDb
    .prepare("SELECT COUNT(DISTINCT org_id) AS n FROM network_signals WHERE withdrawn_at IS NULL")
    .get().n;
  const participating = platformDb
    .prepare("SELECT COUNT(*) AS n FROM organizations WHERE network_enabled = 1 AND status = 'active'")
    .get().n;
  return { active_signals: total, contributing_organizations: contributing, participating_organizations: participating };
}

module.exports = {
  hashIdentifier,
  isParticipating,
  publishSignals,
  withdrawSignals,
  checkIdentifiers,
  purgeOrgSignals,
  networkStats,
};
