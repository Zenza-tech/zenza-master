/**
 * Zenza FID — database layer
 * ---------------------------
 * SQLite via better-sqlite3. One file, one source of truth for the schema.
 * Chosen over Postgres for the MVP because it needs zero setup — the whole
 * database is a single file at data/zenza_fid.db. See
 * docs/SCALING.md for the documented path to Postgres later.
 */

const path = require("node:path");
const crypto = require("node:crypto");
const Database = require("better-sqlite3");

const DB_PATH = path.join(__dirname, "..", "data", "zenza_fid.db");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

function nowIso() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------
db.exec(`
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
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role_id INTEGER NOT NULL REFERENCES roles(id),
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entities (
  id INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL DEFAULT 'individual',
  full_name TEXT NOT NULL,
  risk_notes TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_by INTEGER NOT NULL REFERENCES users(id),
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
  changed_by INTEGER NOT NULL REFERENCES users(id),
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
  status TEXT NOT NULL DEFAULT 'pending_approval',
  requested_by INTEGER NOT NULL REFERENCES users(id),
  reviewed_by INTEGER REFERENCES users(id),
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
  actor_id INTEGER NOT NULL REFERENCES users(id),
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  actor_id INTEGER REFERENCES users(id),
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

// ---------------------------------------------------------------------
// Seed: roles + permissions (idempotent — safe to run on every boot)
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
  ["users.manage", "Create and manage user accounts"],
];

const ROLE_PERMISSIONS = {
  admin: PERMISSIONS.map((p) => p[0]), // everything
  fraud_manager: [
    "entities.view", "entities.create", "entities.edit",
    "watchlist.view", "watchlist.create", "watchlist.approve", "watchlist.suspend",
    "audit.view",
  ],
  analyst: [
    "entities.view", "entities.create", "entities.edit",
    "watchlist.view", "watchlist.create",
  ],
};

const ROLES = [
  ["admin", "Full system access, including user management and audit trail"],
  ["fraud_manager", "Can approve watchlist requests and manage the repository"],
  ["analyst", "Can create and investigate entities and submit watchlist requests"],
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
// Seed: default admin account, only if no users exist yet
// ---------------------------------------------------------------------
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

const userCount = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
let seededAdminNotice = null;

if (userCount === 0) {
  const adminRole = db.prepare("SELECT id FROM roles WHERE name = 'admin'").get();
  const salt = crypto.randomBytes(16).toString("hex");
  const defaultPassword = "ChangeMe123!";
  const hash = hashPassword(defaultPassword, salt);
  db.prepare(
    `INSERT INTO users (full_name, email, password_hash, password_salt, role_id, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?)`
  ).run("System Administrator", "admin@zenzafid.local", hash, salt, adminRole.id, nowIso());

  seededAdminNotice =
    "\n  First run detected — a default admin account was created:\n" +
    "    email:    admin@zenzafid.local\n" +
    "    password: ChangeMe123!\n" +
    "  Log in and change this password immediately (Users → change password).\n";
}

module.exports = { db, nowIso, hashPassword, seededAdminNotice };
