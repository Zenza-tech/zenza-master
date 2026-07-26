/**
 * Tenant databases — one completely separate SQLite file per
 * organization. This is the actual isolation boundary for this
 * multi-tenant deployment, and it's deliberately architectural rather
 * than a discipline problem:
 *
 * A shared table with a `WHERE org_id = ?` clause on every query relies
 * on every developer, on every route, forever, remembering to add that
 * clause. Miss it once and one organization's fraud data — bad actor
 * profiles, watchlist entries, everything — is visible to another
 * organization's users. For a product whose entire purpose is handling
 * sensitive identifiers (BVN, NIN), that is not an acceptable risk
 * profile to accept for developer convenience.
 *
 * With one database file per tenant, that mistake is structurally
 * impossible: a request for Organization A's data opens Organization A's
 * file. There is no query that could accidentally reach into
 * Organization B's file, because the two are different file handles
 * entirely — nothing to forget.
 *
 * The tradeoff: cross-tenant admin queries (e.g. "total entities across
 * every customer") require opening each tenant DB separately and
 * aggregating in application code, rather than one SQL query. That's a
 * rare, internal, low-stakes operation — a fine trade for making the
 * common, high-stakes operation (never leak a customer's data to another
 * customer) a guarantee instead of a hope.
 */

const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const TENANTS_DIR = path.join(__dirname, "..", "data", "tenants");
if (!fs.existsSync(TENANTS_DIR)) fs.mkdirSync(TENANTS_DIR, { recursive: true });

// Cached open connections, keyed by org id. Fine for a modest number of
// tenants on a single server process; if this ever grows into hundreds
// of concurrently-active organizations, add an LRU eviction here so this
// doesn't hold open file handles for tenants nobody's used in months.
const connections = new Map();

function tenantDbPath(orgId) {
  return path.join(TENANTS_DIR, `org_${orgId}.db`);
}

function initSchema(db) {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
CREATE TABLE IF NOT EXISTS entities (
  id INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL DEFAULT 'individual',
  full_name TEXT NOT NULL,
  risk_notes TEXT,
  keywords TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entity_identifiers (
  id INTEGER PRIMARY KEY,
  entity_id INTEGER NOT NULL REFERENCES entities(id),
  identifier_type TEXT NOT NULL,
  identifier_value TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_identifiers_value ON entity_identifiers(identifier_value);
CREATE INDEX IF NOT EXISTS idx_identifiers_entity ON entity_identifiers(entity_id);

CREATE TABLE IF NOT EXISTS entity_versions (
  id INTEGER PRIMARY KEY,
  entity_id INTEGER NOT NULL REFERENCES entities(id),
  changed_by INTEGER NOT NULL,
  change_summary TEXT,
  snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS watchlist_entries (
  id INTEGER PRIMARY KEY,
  entity_id INTEGER NOT NULL REFERENCES entities(id),
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  reason TEXT NOT NULL,
  keywords TEXT,
  status TEXT NOT NULL DEFAULT 'pending_approval',
  requested_by INTEGER NOT NULL,
  reviewed_by INTEGER,
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  expires_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_watchlist_entity ON watchlist_entries(entity_id);
CREATE INDEX IF NOT EXISTS idx_watchlist_status ON watchlist_entries(status);

CREATE TABLE IF NOT EXISTS watchlist_history (
  id INTEGER PRIMARY KEY,
  watchlist_id INTEGER NOT NULL REFERENCES watchlist_entries(id),
  action TEXT NOT NULL,
  actor_id INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS watchlist_attachments (
  id INTEGER PRIMARY KEY,
  watchlist_id INTEGER NOT NULL REFERENCES watchlist_entries(id),
  original_filename TEXT NOT NULL,
  stored_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  uploaded_by INTEGER NOT NULL,
  uploaded_at TEXT NOT NULL,
  ai_summary TEXT,
  summary_status TEXT NOT NULL DEFAULT 'pending'
);
CREATE INDEX IF NOT EXISTS idx_attachments_watchlist ON watchlist_attachments(watchlist_id);

CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
  resource_type UNINDEXED,
  resource_id UNINDEXED,
  title,
  content
);

CREATE TABLE IF NOT EXISTS user_input_history (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  field_name TEXT NOT NULL,
  value TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  UNIQUE(user_id, field_name, value)
);
CREATE INDEX IF NOT EXISTS idx_input_history_lookup ON user_input_history(user_id, field_name, last_used_at);

CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  rule_type TEXT NOT NULL,
  config TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_run_at TEXT
);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY,
  rule_id INTEGER NOT NULL REFERENCES rules(id),
  entity_id INTEGER NOT NULL REFERENCES entities(id),
  triggered_reason TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  reviewed_by INTEGER,
  reviewed_at TEXT,
  review_notes TEXT,
  escalated_watchlist_id INTEGER REFERENCES watchlist_entries(id)
);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
CREATE INDEX IF NOT EXISTS idx_alerts_entity ON alerts(entity_id);
CREATE INDEX IF NOT EXISTS idx_alerts_rule ON alerts(rule_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  actor_id INTEGER,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id INTEGER,
  details TEXT,
  ip_address TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
`);
}

/**
 * Returns the (cached) database connection for one organization,
 * creating the file and schema on first access. This is the ONLY
 * function in the whole app that should ever open a tenant database —
 * every route reaches its tenant's data through `req.tenantDb`, attached
 * by requireAuth after resolving the session, never by importing a
 * global singleton the way the pre-multi-tenant version of this app did.
 */
function getTenantDb(orgId) {
  if (!orgId) throw new Error("getTenantDb called without an orgId — this should never happen post-auth");

  if (connections.has(orgId)) return connections.get(orgId);

  const db = new Database(tenantDbPath(orgId));
  initSchema(db);
  connections.set(orgId, db);
  return db;
}

/** For scripts/tests that need to list which tenant databases exist on disk. */
function listTenantIds() {
  if (!fs.existsSync(TENANTS_DIR)) return [];
  return fs
    .readdirSync(TENANTS_DIR)
    .filter((f) => f.startsWith("org_") && f.endsWith(".db"))
    .map((f) => Number(f.replace("org_", "").replace(".db", "")))
    .filter((n) => !Number.isNaN(n));
}

module.exports = { getTenantDb, listTenantIds, TENANTS_DIR };
