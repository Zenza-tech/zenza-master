const express = require("express");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { db: platformDb, nowIso, hashPassword, writePlatformAudit } = require("../platformDb");
const { getTenantDb, TENANTS_DIR } = require("../tenantDb");
const { requireAuth, requirePlatformAdmin } = require("../middleware/auth");
const { clientIp } = require("../middleware/audit");
const { networkStats, purgeOrgSignals } = require("../services/network");

const router = express.Router();
router.use(requireAuth, requirePlatformAdmin);

/**
 * PLATFORM ADMINISTRATION — for us, the operator, not for customers.
 *
 * ================= THE ONE RULE FOR THIS FILE =================
 * Nothing in here may return the CONTENT of an organization's fraud
 * data. Not an entity name, not an identifier, not a watchlist reason,
 * not an attachment, not an audit-log detail blob. Ever.
 *
 * What it MAY return: counts, timestamps, status, plan, storage size —
 * operational metadata that lets us run the service, bill correctly,
 * spot an org that has gone quiet, and support a customer who asks for
 * help. That is a genuinely different category from reading their
 * customers' fraud files, and the difference is not cosmetic: under
 * NDPA we are a data processor for tenant content, and a processor
 * reading client data for its own purposes is exactly what the law
 * restricts (see COMPLIANCE-NDPA.md).
 *
 * The functions below therefore run COUNT() against tenant databases and
 * return numbers. If a future feature request sounds like "can the
 * platform admin just peek at what they flagged" — that is a support-
 * access feature with its own consent, logging and time-bounding
 * requirements, and it does not belong in this file as a quiet addition.
 * ==============================================================
 */

/** Counts only. Deliberately no SELECT of any content column. */
function tenantMetrics(orgId) {
  try {
    const db = getTenantDb(orgId);
    const count = (sql) => {
      try { return db.prepare(sql).get().n; } catch { return 0; }
    };
    return {
      entities: count("SELECT COUNT(*) AS n FROM entities"),
      watchlist_active: count("SELECT COUNT(*) AS n FROM watchlist_entries WHERE status = 'active'"),
      watchlist_pending: count("SELECT COUNT(*) AS n FROM watchlist_entries WHERE status = 'pending_approval'"),
      rules_active: count("SELECT COUNT(*) AS n FROM rules WHERE status = 'active'"),
      alerts_open: count("SELECT COUNT(*) AS n FROM alerts WHERE status = 'open'"),
      attachments: count("SELECT COUNT(*) AS n FROM watchlist_attachments"),
      audit_events: count("SELECT COUNT(*) AS n FROM audit_log"),
      last_activity: (() => {
        try { return db.prepare("SELECT MAX(created_at) AS t FROM audit_log").get().t; } catch { return null; }
      })(),
    };
  } catch {
    return null;
  }
}

function tenantStorageBytes(orgId) {
  let total = 0;
  const dbFile = path.join(TENANTS_DIR, `org_${orgId}.db`);
  if (fs.existsSync(dbFile)) total += fs.statSync(dbFile).size;
  const attachDir = path.join(TENANTS_DIR, `org_${orgId}`, "attachments");
  if (fs.existsSync(attachDir)) {
    fs.readdirSync(attachDir).forEach((f) => {
      const p = path.join(attachDir, f);
      if (fs.statSync(p).isFile()) total += fs.statSync(p).size;
    });
  }
  return total;
}

function orgUserSummary(orgId) {
  const rows = platformDb
    .prepare(
      `SELECT r.name AS role, COUNT(*) AS n, SUM(CASE WHEN u.status='active' THEN 1 ELSE 0 END) AS active
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.org_id = ? GROUP BY r.name`
    )
    .all(orgId);
  const total = rows.reduce((s, r) => s + r.n, 0);
  const active = rows.reduce((s, r) => s + (r.active || 0), 0);
  const lastLogin = platformDb.prepare("SELECT MAX(last_login_at) AS t FROM users WHERE org_id = ?").get(orgId).t;
  return { total, active, by_role: Object.fromEntries(rows.map((r) => [r.role, r.n])), last_login: lastLogin };
}

// ---- overview ----
router.get("/stats", (req, res) => {
  const orgs = platformDb.prepare("SELECT status FROM organizations").all();
  res.json({
    ok: true,
    organizations: {
      total: orgs.length,
      active: orgs.filter((o) => o.status === "active").length,
      suspended: orgs.filter((o) => o.status === "suspended").length,
      archived: orgs.filter((o) => o.status === "archived").length,
    },
    users: platformDb.prepare("SELECT COUNT(*) AS n FROM users").get().n,
    network: networkStats(),
  });
});

// ---- list organizations ----
router.get("/organizations", (req, res) => {
  const { status } = req.query;
  const rows = status
    ? platformDb.prepare("SELECT * FROM organizations WHERE status = ? ORDER BY created_at DESC").all(status)
    : platformDb.prepare("SELECT * FROM organizations ORDER BY created_at DESC").all();

  const results = rows.map((o) => ({
    ...o,
    network_enabled: !!o.network_enabled,
    users: orgUserSummary(o.id),
    metrics: tenantMetrics(o.id),
    storage_bytes: tenantStorageBytes(o.id),
  }));
  res.json({ ok: true, results });
});

// ---- organization detail ----
router.get("/organizations/:id", (req, res) => {
  const org = platformDb.prepare("SELECT * FROM organizations WHERE id = ?").get(req.params.id);
  if (!org) return res.status(404).json({ ok: false, error: "Organization not found" });

  const users = platformDb
    .prepare(
      `SELECT u.id, u.full_name, u.email, u.status, u.created_at, u.last_login_at, r.name AS role
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.org_id = ? ORDER BY u.created_at`
    )
    .all(org.id);

  res.json({
    ok: true,
    organization: { ...org, network_enabled: !!org.network_enabled },
    users,
    metrics: tenantMetrics(org.id),
    storage_bytes: tenantStorageBytes(org.id),
  });
});

// ---- create organization (+ its first admin) ----
router.post("/organizations", (req, res) => {
  const { name, plan = "starter", admin_name, admin_email, network_enabled = false } = req.body || {};
  if (!name || !admin_name || !admin_email) {
    return res.status(400).json({ ok: false, error: "name, admin_name, and admin_email are required" });
  }
  const email = admin_email.trim().toLowerCase();
  if (platformDb.prepare("SELECT id FROM users WHERE email = ?").get(email)) {
    return res.status(409).json({ ok: false, error: "A user with this email already exists" });
  }

  let slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  if (platformDb.prepare("SELECT id FROM organizations WHERE slug = ?").get(slug)) {
    slug = `${slug}-${crypto.randomBytes(2).toString("hex")}`;
  }

  const now = nowIso();
  const password = crypto.randomBytes(9).toString("base64").replace(/[+/=]/g, "").slice(0, 12) + "!1";
  const salt = crypto.randomBytes(16).toString("hex");
  const adminRole = platformDb.prepare("SELECT id FROM roles WHERE name = 'admin'").get();

  const txn = platformDb.transaction(() => {
    const orgResult = platformDb
      .prepare("INSERT INTO organizations (name, slug, plan, status, network_enabled, created_at) VALUES (?, ?, ?, 'active', ?, ?)")
      .run(name, slug, plan, network_enabled ? 1 : 0, now);
    const orgId = orgResult.lastInsertRowid;
    platformDb
      .prepare(
        `INSERT INTO users (org_id, full_name, email, password_hash, password_salt, role_id, status, is_platform_admin, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', 0, ?)`
      )
      .run(orgId, admin_name, email, hashPassword(password, salt), salt, adminRole.id, now);
    return orgId;
  });
  const orgId = txn();
  getTenantDb(orgId);

  writePlatformAudit({
    actorId: req.user.id, action: "platform.org_create", targetOrgId: orgId,
    details: { name, plan, network_enabled: !!network_enabled }, ipAddress: clientIp(req),
  });

  res.status(201).json({
    ok: true,
    organization: { id: orgId, name, slug, plan },
    admin: { email, temporary_password: password },
  });
});

// ---- update plan / network participation / notes ----
router.put("/organizations/:id", (req, res) => {
  const org = platformDb.prepare("SELECT * FROM organizations WHERE id = ?").get(req.params.id);
  if (!org) return res.status(404).json({ ok: false, error: "Organization not found" });

  const { plan, network_enabled, notes, name } = req.body || {};
  const changes = {};
  if (plan !== undefined && plan !== org.plan) changes.plan = plan;
  if (name !== undefined && name !== org.name) changes.name = name;
  if (notes !== undefined && notes !== org.notes) changes.notes = notes;
  if (network_enabled !== undefined && Number(!!network_enabled) !== org.network_enabled) {
    changes.network_enabled = !!network_enabled;
  }

  platformDb
    .prepare(
      `UPDATE organizations SET name = COALESCE(?, name), plan = COALESCE(?, plan),
       network_enabled = COALESCE(?, network_enabled), notes = COALESCE(?, notes) WHERE id = ?`
    )
    .run(name ?? null, plan ?? null, network_enabled === undefined ? null : (network_enabled ? 1 : 0), notes ?? null, org.id);

  // Turning network participation OFF must immediately stop sharing — an
  // org that opts out should not keep contributing signals, and leaving
  // them live would misrepresent what "opted out" means to that customer.
  if (changes.network_enabled === false) {
    const { purged } = purgeOrgSignals(org.id);
    changes.network_signals_purged = purged;
  }

  writePlatformAudit({
    actorId: req.user.id, action: "platform.org_update", targetOrgId: org.id,
    details: changes, ipAddress: clientIp(req),
  });
  res.json({ ok: true, changes });
});

// ---- suspend (blocks login; data retained untouched) ----
router.post("/organizations/:id/suspend", (req, res) => {
  const org = platformDb.prepare("SELECT * FROM organizations WHERE id = ?").get(req.params.id);
  if (!org) return res.status(404).json({ ok: false, error: "Organization not found" });
  if (org.id === req.user.org_id) {
    return res.status(400).json({ ok: false, error: "You cannot suspend your own organization" });
  }
  const { reason } = req.body || {};

  platformDb.prepare("UPDATE organizations SET status = 'suspended' WHERE id = ?").run(org.id);
  platformDb.prepare("DELETE FROM sessions WHERE org_id = ?").run(org.id);
  purgeOrgSignals(org.id);

  writePlatformAudit({
    actorId: req.user.id, action: "platform.org_suspend", targetOrgId: org.id,
    details: { reason: reason || null }, ipAddress: clientIp(req),
  });
  res.json({ ok: true, status: "suspended" });
});

// ---- reactivate ----
router.post("/organizations/:id/reactivate", (req, res) => {
  const org = platformDb.prepare("SELECT * FROM organizations WHERE id = ?").get(req.params.id);
  if (!org) return res.status(404).json({ ok: false, error: "Organization not found" });

  platformDb.prepare("UPDATE organizations SET status = 'active', archived_at = NULL WHERE id = ?").run(org.id);
  writePlatformAudit({ actorId: req.user.id, action: "platform.org_reactivate", targetOrgId: org.id, ipAddress: clientIp(req) });
  res.json({ ok: true, status: "active" });
});

// ---- archive (offboarding: no access, data retained) ----
router.post("/organizations/:id/archive", (req, res) => {
  const org = platformDb.prepare("SELECT * FROM organizations WHERE id = ?").get(req.params.id);
  if (!org) return res.status(404).json({ ok: false, error: "Organization not found" });
  if (org.id === req.user.org_id) {
    return res.status(400).json({ ok: false, error: "You cannot archive your own organization" });
  }

  platformDb.prepare("UPDATE organizations SET status = 'archived', archived_at = ? WHERE id = ?").run(nowIso(), org.id);
  platformDb.prepare("DELETE FROM sessions WHERE org_id = ?").run(org.id);
  purgeOrgSignals(org.id);

  writePlatformAudit({
    actorId: req.user.id, action: "platform.org_archive", targetOrgId: org.id,
    details: { reason: req.body?.reason || null }, ipAddress: clientIp(req),
  });
  res.json({
    ok: true,
    status: "archived",
    note: "Access revoked and network contributions withdrawn. Tenant data is retained on disk — use the purge endpoint to delete it permanently.",
  });
});

// ---- purge (permanent deletion — for a genuine erasure request) ----
router.delete("/organizations/:id/purge", (req, res) => {
  const org = platformDb.prepare("SELECT * FROM organizations WHERE id = ?").get(req.params.id);
  if (!org) return res.status(404).json({ ok: false, error: "Organization not found" });
  if (org.id === req.user.org_id) {
    return res.status(400).json({ ok: false, error: "You cannot purge your own organization" });
  }
  // Deliberate friction: irreversible, and destroys a customer's entire
  // fraud repository. Requiring the exact name typed back is the same
  // pattern GitHub uses for repo deletion, for the same reason.
  if (req.body?.confirm_name !== org.name) {
    return res.status(400).json({
      ok: false,
      error: `Confirmation required: send { "confirm_name": "${org.name}" } to permanently delete this organization's data.`,
    });
  }
  if (org.status !== "archived") {
    return res.status(409).json({ ok: false, error: "Archive the organization first — purge is only permitted on an archived organization." });
  }

  const removed = { signals: purgeOrgSignals(org.id).purged, files: 0, db: false, users: 0 };

  const orgDir = path.join(TENANTS_DIR, `org_${org.id}`);
  if (fs.existsSync(orgDir)) {
    const attachDir = path.join(orgDir, "attachments");
    removed.files = fs.existsSync(attachDir) ? fs.readdirSync(attachDir).length : 0;
    fs.rmSync(orgDir, { recursive: true, force: true });
  }
  ["", "-shm", "-wal"].forEach((suffix) => {
    const f = path.join(TENANTS_DIR, `org_${org.id}.db${suffix}`);
    if (fs.existsSync(f)) { fs.rmSync(f); removed.db = true; }
  });

  removed.users = platformDb.prepare("DELETE FROM users WHERE org_id = ?").run(org.id).changes;
  platformDb.prepare("DELETE FROM sessions WHERE org_id = ?").run(org.id);
  platformDb.prepare("DELETE FROM organizations WHERE id = ?").run(org.id);

  // The platform audit entry deliberately survives the organization it
  // refers to — proving to a regulator "this data was deleted, on this
  // date, by this operator" requires the record of the deletion to
  // outlive the data itself.
  writePlatformAudit({
    actorId: req.user.id, action: "platform.org_purge", targetOrgId: org.id,
    details: { organization_name: org.name, removed }, ipAddress: clientIp(req),
  });

  res.json({ ok: true, purged: removed });
});

// ---- platform audit log ----
router.get("/audit", (req, res) => {
  const { page = 1, limit = 50 } = req.query;
  const p = Math.max(parseInt(page, 10) || 1, 1);
  const l = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);

  const total = platformDb.prepare("SELECT COUNT(*) AS n FROM platform_audit_log").get().n;
  const rows = platformDb
    .prepare("SELECT * FROM platform_audit_log ORDER BY created_at DESC LIMIT ? OFFSET ?")
    .all(l, (p - 1) * l);

  const actorIds = [...new Set(rows.map((r) => r.actor_id).filter(Boolean))];
  const actors = actorIds.length
    ? Object.fromEntries(
        platformDb
          .prepare(`SELECT id, full_name FROM users WHERE id IN (${actorIds.map(() => "?").join(",")})`)
          .all(...actorIds)
          .map((u) => [u.id, u.full_name])
      )
    : {};

  res.json({
    ok: true, total, page: p, limit: l,
    results: rows.map((r) => ({
      ...r,
      details: r.details ? JSON.parse(r.details) : null,
      actor_name: r.actor_id ? actors[r.actor_id] || `User #${r.actor_id}` : "system",
    })),
  });
});

module.exports = router;
