#!/usr/bin/env node
/**
 * Onboards a new customer organization — creates the organization record,
 * its dedicated tenant database, and its first admin user.
 *
 * This is deliberately a CLI, not a self-serve signup flow: at this stage
 * (small number of manually-onboarded customers), a platform admin runs
 * this directly rather than building a signup UI that isn't needed yet.
 *
 * Usage:
 *   node scripts/create-organization.js --name "Acme Bank" --admin-name "Jane Doe" --admin-email jane@acmebank.com
 *
 * Prints a generated temporary password — the same pattern as the
 * default demo admin, and for the same reason: change it on first login.
 */

const crypto = require("node:crypto");
const path = require("node:path");
const { db, nowIso, hashPassword } = require(path.join(__dirname, "..", "server", "platformDb"));
const { getTenantDb } = require(path.join(__dirname, "..", "server", "tenantDb"));

function parseArgs() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, "");
    args[key] = argv[i + 1];
  }
  return args;
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function generatePassword() {
  return crypto.randomBytes(9).toString("base64").replace(/[+/=]/g, "").slice(0, 12) + "!1";
}

function main() {
  const args = parseArgs();
  const { name, "admin-name": adminName, "admin-email": adminEmail, plan = "starter" } = args;

  if (!name || !adminName || !adminEmail) {
    console.error("Usage: node scripts/create-organization.js --name \"Acme Bank\" --admin-name \"Jane Doe\" --admin-email jane@acmebank.com [--plan starter|growth|enterprise]");
    process.exit(1);
  }

  const existingEmail = db.prepare("SELECT id FROM users WHERE email = ?").get(adminEmail.trim().toLowerCase());
  if (existingEmail) {
    console.error(`Error: a user with email ${adminEmail} already exists (emails are unique platform-wide).`);
    process.exit(1);
  }

  let slug = slugify(name);
  const existingSlug = db.prepare("SELECT id FROM organizations WHERE slug = ?").get(slug);
  if (existingSlug) {
    slug = `${slug}-${crypto.randomBytes(2).toString("hex")}`;
  }

  const now = nowIso();
  const orgResult = db
    .prepare("INSERT INTO organizations (name, slug, plan, status, created_at) VALUES (?, ?, ?, 'active', ?)")
    .run(name, slug, plan, now);
  const orgId = orgResult.lastInsertRowid;

  // Creates the tenant database + schema immediately, rather than waiting
  // for first login, so the organization is fully provisioned and
  // verifiable right after this script runs.
  getTenantDb(orgId);

  const adminRole = db.prepare("SELECT id FROM roles WHERE name = 'admin'").get();
  const salt = crypto.randomBytes(16).toString("hex");
  const password = generatePassword();
  const hash = hashPassword(password, salt);
  db.prepare(
    `INSERT INTO users (org_id, full_name, email, password_hash, password_salt, role_id, status, is_platform_admin, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', 0, ?)`
  ).run(orgId, adminName, adminEmail.trim().toLowerCase(), hash, salt, adminRole.id, now);

  console.log("\nOrganization created successfully:\n");
  console.log(`  Organization: ${name} (id ${orgId}, slug "${slug}", plan "${plan}")`);
  console.log(`  Admin login:  ${adminEmail.trim().toLowerCase()}`);
  console.log(`  Password:     ${password}`);
  console.log(`\nShare these credentials securely and have them change the password on first login.\n`);
}

main();
