const express = require("express");
const { nowIso } = require("../utils/time");
const { db: platformDb } = require("../platformDb");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { writeAudit, clientIp } = require("../middleware/audit");
const { indexWatchlistEntry } = require("../services/search");

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

function getAlertWithContext(db, id) {
  const alert = db
    .prepare(
      `SELECT a.*, e.full_name AS entity_name, r.name AS rule_name, r.rule_type
       FROM alerts a
       JOIN entities e ON e.id = a.entity_id
       JOIN rules r ON r.id = a.rule_id
       WHERE a.id = ?`
    )
    .get(id);
  if (!alert) return null;
  if (alert.reviewed_by) {
    const names = resolveUserNames([alert.reviewed_by]);
    alert.reviewed_by_name = names[alert.reviewed_by] || `User #${alert.reviewed_by}`;
  }
  return alert;
}

// ---- list ----
router.get("/", requirePermission("alerts.view"), (req, res) => {
  const db = req.tenantDb;
  const { status, severity, entity_id, page = 1, limit = 25 } = req.query;
  const p = Math.max(parseInt(page, 10) || 1, 1);
  const l = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
  const offset = (p - 1) * l;

  let where = "WHERE 1=1";
  const params = [];
  if (status) { where += " AND a.status = ?"; params.push(status); }
  if (severity) { where += " AND a.severity = ?"; params.push(severity); }
  if (entity_id) { where += " AND a.entity_id = ?"; params.push(entity_id); }

  const total = db.prepare(`SELECT COUNT(*) AS n FROM alerts a ${where}`).get(...params).n;
  const rows = db
    .prepare(
      `SELECT a.*, e.full_name AS entity_name, r.name AS rule_name
       FROM alerts a JOIN entities e ON e.id = a.entity_id JOIN rules r ON r.id = a.rule_id
       ${where} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`
    )
    .all(...params, l, offset);

  res.json({ ok: true, total, page: p, limit: l, results: rows });
});

// ---- detail ----
router.get("/:id", requirePermission("alerts.view"), (req, res) => {
  const alert = getAlertWithContext(req.tenantDb, req.params.id);
  if (!alert) return res.status(404).json({ ok: false, error: "Alert not found" });
  res.json({ ok: true, alert });
});

// ---- dismiss ----
router.post("/:id/dismiss", requirePermission("alerts.action"), (req, res) => {
  const db = req.tenantDb;
  const alert = db.prepare("SELECT * FROM alerts WHERE id = ?").get(req.params.id);
  if (!alert) return res.status(404).json({ ok: false, error: "Alert not found" });
  if (alert.status !== "open") return res.status(409).json({ ok: false, error: `Cannot dismiss — alert is currently '${alert.status}'` });

  const { notes } = req.body || {};
  if (!notes || !notes.trim()) return res.status(400).json({ ok: false, error: "notes are required when dismissing an alert" });

  db.prepare(
    "UPDATE alerts SET status = 'dismissed', reviewed_by = ?, reviewed_at = ?, review_notes = ? WHERE id = ?"
  ).run(req.user.id, nowIso(), notes, alert.id);

  writeAudit(db, { actorId: req.user.id, action: "alert.dismiss", resourceType: "alert", resourceId: alert.id, details: { notes }, ipAddress: clientIp(req) });
  res.json({ ok: true, alert: getAlertWithContext(db, alert.id) });
});

// ---- escalate: creates a linked watchlist request (maker step), pre-filled from the alert ----
router.post("/:id/escalate", requirePermission("alerts.action"), (req, res) => {
  const db = req.tenantDb;
  const alert = db.prepare("SELECT * FROM alerts WHERE id = ?").get(req.params.id);
  if (!alert) return res.status(404).json({ ok: false, error: "Alert not found" });
  if (alert.status !== "open") return res.status(409).json({ ok: false, error: `Cannot escalate — alert is currently '${alert.status}'` });

  const { category = "other", notes } = req.body || {};

  const txn = db.transaction(() => {
    const now = nowIso();
    const wl = db
      .prepare(
        `INSERT INTO watchlist_entries (entity_id, category, severity, reason, status, requested_by, created_at)
         VALUES (?, ?, ?, ?, 'pending_approval', ?, ?)`
      )
      .run(alert.entity_id, category, alert.severity, alert.triggered_reason, req.user.id, now);
    const watchlistId = wl.lastInsertRowid;

    db.prepare(
      "INSERT INTO watchlist_history (watchlist_id, action, actor_id, notes, created_at) VALUES (?, 'created', ?, ?, ?)"
    ).run(watchlistId, req.user.id, `Escalated from alert #${alert.id} (rule-triggered)`, now);

    db.prepare(
      "UPDATE alerts SET status = 'escalated', reviewed_by = ?, reviewed_at = ?, review_notes = ?, escalated_watchlist_id = ? WHERE id = ?"
    ).run(req.user.id, now, notes || null, watchlistId, alert.id);

    return watchlistId;
  });

  const watchlistId = txn();
  indexWatchlistEntry(db, db.prepare("SELECT * FROM watchlist_entries WHERE id = ?").get(watchlistId));
  writeAudit(db, {
    actorId: req.user.id, action: "alert.escalate", resourceType: "alert", resourceId: alert.id,
    details: { watchlist_id: watchlistId }, ipAddress: clientIp(req),
  });

  res.json({ ok: true, alert: getAlertWithContext(db, alert.id), watchlist_id: watchlistId });
});

module.exports = router;
