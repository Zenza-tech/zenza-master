/**
 * Platform database — the ONE thing shared across every organization on
 * this deployment. This is deliberately minimal: it only holds what's
 * needed to authenticate a user and know which organization they belong
 * to. Everything else (entities, watchlist, rules, alerts, audit log)
 * lives in that organization's own separate database file — see
 * tenantDb.js and the architecture note at the top of that file for why.
 *
 * A user belongs to exactly one organization. Email is unique platform-
 * wide (not just within an org), which keeps the login form exactly as
 * simple as it's always been — no "which company do you work for"
 * selector needed.
 */

const path = require("node:path");
const crypto = require("node:crypto");
const Database = require("better-sqlite3");
const { nowIso } = require("./utils/time");
const { hashPassword } = require("./utils/password");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "platform.db");

const fs = require("node:fs");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS organizations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  plan TEXT NOT NULL DEFAULT 'starter',
  status TEXT NOT NULL DEFAULT 'active',
  network_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  archived_at TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS permissions (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(id),
  permission_id INTEGER NOT NULL REFERENCES permissions(id),
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role_id INTEGER NOT NULL REFERENCES roles(id),
  status TEXT NOT NULL DEFAULT 'active',
  is_platform_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- ---------------------------------------------------------------------
-- Cross-organization fraud intelligence network.
--
-- This table is the ONLY place data crosses an organization boundary,
-- and it is deliberately built so that crossing reveals almost nothing:
-- it stores a keyed HMAC of an identifier, never the identifier itself,
-- never a name, never a reason, never any free text an analyst wrote.
--
-- Why HMAC and not a plain SHA-256 hash: a Nigerian BVN is 11 digits.
-- That is only 10^11 possible values — a plain hash of it can be brute-
-- forced exhaustively on commodity hardware in hours. Keying the hash
-- with a server-side secret (the "pepper") that never leaves this
-- deployment makes that attack useless to anyone who obtains the table
-- without also obtaining the key. Getting this wrong would mean
-- publishing a table that looks anonymous and is not.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS network_signals (
  id INTEGER PRIMARY KEY,
  identifier_hash TEXT NOT NULL,
  identifier_type TEXT NOT NULL,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  watchlist_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  created_at TEXT NOT NULL,
  withdrawn_at TEXT,
  UNIQUE(org_id, watchlist_id, identifier_hash)
);
CREATE INDEX IF NOT EXISTS idx_network_hash ON network_signals(identifier_hash) WHERE withdrawn_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_network_org ON network_signals(org_id);

-- Platform-level audit trail. Distinct from each organization's own
-- audit_log (which lives in their tenant database): this records what
-- WE, the platform operator, did — created an org, suspended an org,
-- changed a plan. An organization's own admin should never see this,
-- and platform operators should never be able to edit it, for the same
-- reason tenant audit logs are insert-only.
CREATE TABLE IF NOT EXISTS platform_audit_log (
  id INTEGER PRIMARY KEY,
  actor_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  target_org_id INTEGER,
  details TEXT,
  ip_address TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_platform_audit_created ON platform_audit_log(created_at);
`);

// ---------------------------------------------------------------------
// Seed: roles + permissions (idempotent, same set as before — these are
// platform-wide role definitions, not customized per organization)
// ---------------------------------------------------------------------
const PERMISSIONS = [
  ["entities.view", "View fraud intelligence repository"],
  ["entities.create", "Create bad-actor profiles"],
  ["entities.edit", "Edit bad-actor profiles"],
  ["watchlist.view", "View watchlist"],
  ["watchlist.create", "Submit a watchlist request (maker)"],
  ["watchlist.approve", "Approve/reject a watchlist request (checker)"],
  ["watchlist.suspend", "Suspend or reactivate a watchlist entry"],
  ["audit.view", "View the system audit log"],
  ["users.manage", "Create and manage user accounts within your organization"],
  ["rules.view", "View detection rules"],
  ["rules.manage", "Create, edit, activate, disable, and run detection rules"],
  ["alerts.view", "View alerts generated by detection rules"],
  ["alerts.action", "Dismiss or escalate an alert into a watchlist request"],
];

const ROLE_PERMISSIONS = {
  admin: PERMISSIONS.map((p) => p[0]),
  fraud_manager: [
    "entities.view", "entities.create", "entities.edit",
    "watchlist.view", "watchlist.create", "watchlist.approve", "watchlist.suspend",
    "audit.view", "rules.view", "rules.manage", "alerts.view", "alerts.action",
  ],
  analyst: [
    "entities.view", "entities.create", "entities.edit",
    "watchlist.view", "watchlist.create", "rules.view", "alerts.view", "alerts.action",
  ],
};

const ROLES = [
  ["admin", "Full access within your organization — user management, audit trail, everything below"],
  ["fraud_manager", "Approves watchlist requests, manages detection rules, reviews the audit log"],
  ["analyst", "Creates and investigates entities, submits watchlist requests, handles alerts"],
];

const seedTxn = db.transaction(() => {
  const insertRole = db.prepare("INSERT OR IGNORE INTO roles (name, description) VALUES (?, ?)");
  ROLES.forEach(([name, desc]) => insertRole.run(name, desc));

  const insertPerm = db.prepare("INSERT OR IGNORE INTO permissions (code, description) VALUES (?, ?)");
  PERMISSIONS.forEach(([code, desc]) => insertPerm.run(code, desc));

  const getRoleId = db.prepare("SELECT id FROM roles WHERE name = ?");
  const getPermId = db.prepare("SELECT id FROM permissions WHERE code = ?");
  const linkPerm = db.prepare("INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)");

  Object.entries(ROLE_PERMISSIONS).forEach(([roleName, codes]) => {
    const role = getRoleId.get(roleName);
    codes.forEach((code) => {
      const perm = getPermId.get(code);
      if (role && perm) linkPerm.run(role.id, perm.id);
    });
  });
});
seedTxn();

// ---------------------------------------------------------------------
// Seed: a default organization + admin, only on a genuinely fresh
// install (zero organizations exist yet) — keeps `npm start` working
// out of the box for local dev/demos. Real customer onboarding goes
// through scripts/create-organization.js, not this path.
// ---------------------------------------------------------------------
let seededAdminNotice = null;

const orgCount = db.prepare("SELECT COUNT(*) AS n FROM organizations").get().n;
if (orgCount === 0) {
  const now = nowIso();
  const orgResult = db
    .prepare("INSERT INTO organizations (name, slug, plan, status, created_at) VALUES (?, ?, ?, 'active', ?)")
    .run("Demo Organization", "demo", "starter", now);
  const orgId = orgResult.lastInsertRowid;

  const adminRole = db.prepare("SELECT id FROM roles WHERE name = 'admin'").get();
  const salt = crypto.randomBytes(16).toString("hex");
  const defaultPassword = "ChangeMe123!";
  const hash = hashPassword(defaultPassword, salt);
  db.prepare(
    `INSERT INTO users (org_id, full_name, email, password_hash, password_salt, role_id, status, is_platform_admin, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', 1, ?)`
  ).run(orgId, "System Administrator", "admin@zenzafid.local", hash, salt, adminRole.id, now);

  seededAdminNotice =
    "\n  First run detected — a default organization and admin account were created:\n" +
    "    organization: Demo Organization\n" +
    "    email:        admin@zenzafid.local\n" +
    "    password:     ChangeMe123!\n" +
    "  Log in and change this password immediately (Users → Change My Password).\n" +
    "  This account is also a platform admin — see scripts/create-organization.js\n" +
    "  for onboarding real customer organizations.\n";
}

/**
 * Adds a column only if it doesn't already exist. SQLite has no
 * "ADD COLUMN IF NOT EXISTS", and the CREATE TABLE above only applies to
 * brand-new databases — so an install created before these columns
 * existed needs this to catch up. Kept explicit and tiny rather than
 * pulling in a migration framework for what is currently three columns.
 */
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
ensureColumn("organizations", "network_enabled", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("organizations", "archived_at", "TEXT");
ensureColumn("organizations", "notes", "TEXT");

function getOrganization(orgId) {
  return db.prepare("SELECT * FROM organizations WHERE id = ?").get(orgId);
}

function listOrganizations() {
  return db.prepare("SELECT * FROM organizations ORDER BY created_at DESC").all();
}

/** Organizations eligible to run rules / be served — excludes archived. */
function listActiveOrganizations() {
  return db.prepare("SELECT * FROM organizations WHERE status = 'active' ORDER BY created_at DESC").all();
}

/**
 * Records a platform-operator action (create/suspend/archive an org,
 * etc). Insert-only, same discipline as the tenant audit logs.
 */
function writePlatformAudit({ actorId, action, targetOrgId = null, details = null, ipAddress = null }) {
  db.prepare(
    `INSERT INTO platform_audit_log (actor_id, action, target_org_id, details, ip_address, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(actorId, action, targetOrgId, details ? JSON.stringify(details) : null, ipAddress, nowIso());
}

module.exports = {
  db,
  nowIso,
  hashPassword,
  seededAdminNotice,
  getOrganization,
  listOrganizations,
  listActiveOrganizations,
  writePlatformAudit,
};
