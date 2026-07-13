const express = require("express");
const { db, nowIso } = require("../db");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { writeAudit, clientIp } = require("../middleware/audit");

const router = express.Router();
router.use(requireAuth);

const VALID_SEVERITY = ["low", "medium", "high", "critical"];

function logHistory(watchlistId, action, actorId, notes = null) {
  db.prepare(
    "INSERT INTO watchlist_history (watchlist_id, action, actor_id, notes, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(watchlistId, action, actorId, notes, nowIso());
}

// lazily auto-expire anything past its expiry date — called before reads
function applyAutoExpiry() {
  const expired = db
    .prepare("SELECT id FROM watchlist_entries WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < ?")
    .all(nowIso());
  if (expired.length === 0) return;
  const now = nowIso();
  const update = db.prepare("UPDATE watchlist_entries SET status = 'expired' WHERE id = ?");
  expired.forEach((row) => {
    update.run(row.id);
    logHistory(row.id, "auto_expired", null, "Automatically expired — past expires_at");
  });
}

function getEntry(id) {
  return db.prepare("SELECT * FROM watchlist_entries WHERE id = ?").get(id);
}

function getEntryWithContext(id) {
  const entry = getEntry(id);
  if (!entry) return null;
  const entity = db.prepare("SELECT id, full_name, entity_type FROM entities WHERE id = ?").get(entry.entity_id);
  const history = db
    .prepare(
      `SELECT h.*, u.full_name AS actor_name FROM watchlist_history h
       LEFT JOIN users u ON u.id = h.actor_id WHERE h.watchlist_id = ? ORDER BY h.created_at ASC`
    )
    .all(id);
  return { ...entry, entity, history };
}

// ---- list ----
router.get("/", requirePermission("watchlist.view"), (req, res) => {
  applyAutoExpiry();
  const { status, severity, entity_id, page = 1, limit = 25 } = req.query;
  const p = Math.max(parseInt(page, 10) || 1, 1);
  const l = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
  const offset = (p - 1) * l;

  let where = "WHERE 1=1";
  const params = [];
  if (status) { where += " AND w.status = ?"; params.push(status); }
  if (severity) { where += " AND w.severity = ?"; params.push(severity); }
  if (entity_id) { where += " AND w.entity_id = ?"; params.push(entity_id); }

  const total = db.prepare(`SELECT COUNT(*) AS n FROM watchlist_entries w ${where}`).get(...params).n;
  const rows = db
    .prepare(
      `SELECT w.*, e.full_name AS entity_name, req.full_name AS requested_by_name, rev.full_name AS reviewed_by_name
       FROM watchlist_entries w
       JOIN entities e ON e.id = w.entity_id
       JOIN users req ON req.id = w.requested_by
       LEFT JOIN users rev ON rev.id = w.reviewed_by
       ${where} ORDER BY w.created_at DESC LIMIT ? OFFSET ?`
    )
    .all(...params, l, offset);

  res.json({ ok: true, total, page: p, limit: l, results: rows });
});

// ---- detail ----
router.get("/:id", requirePermission("watchlist.view"), (req, res) => {
  applyAutoExpiry();
  const entry = getEntryWithContext(req.params.id);
  if (!entry) return res.status(404).json({ ok: false, error: "Watchlist entry not found" });
  res.json({ ok: true, entry });
});

// ---- create (maker) ----
router.post("/", requirePermission("watchlist.create"), (req, res) => {
  const { entity_id, category, severity, reason, expires_at = null } = req.body || {};
  if (!entity_id || !category || !severity || !reason) {
    return res.status(400).json({ ok: false, error: "entity_id, category, severity, and reason are required" });
  }
  if (!VALID_SEVERITY.includes(severity)) {
    return res.status(400).json({ ok: false, error: `severity must be one of: ${VALID_SEVERITY.join(", ")}` });
  }
  const entity = db.prepare("SELECT id FROM entities WHERE id = ?").get(entity_id);
  if (!entity) return res.status(404).json({ ok: false, error: "Entity not found" });

  const txn = db.transaction(() => {
    const now = nowIso();
    const result = db
      .prepare(
        `INSERT INTO watchlist_entries (entity_id, category, severity, reason, status, requested_by, created_at, expires_at)
         VALUES (?, ?, ?, ?, 'pending_approval', ?, ?, ?)`
      )
      .run(entity_id, category, severity, reason, req.user.id, now, expires_at);
    const id = result.lastInsertRowid;
    logHistory(id, "created", req.user.id, "Submitted for approval");
    writeAudit({
      actorId: req.user.id, action: "watchlist.create", resourceType: "watchlist_entry", resourceId: id,
      details: { entity_id, severity, category }, ipAddress: clientIp(req),
    });
    return id;
  });

  const id = txn();
  res.status(201).json({ ok: true, entry: getEntryWithContext(id) });
});

// ---- approve (checker) ----
router.post("/:id/approve", requirePermission("watchlist.approve"), (req, res) => {
  const entry = getEntry(req.params.id);
  if (!entry) return res.status(404).json({ ok: false, error: "Watchlist entry not found" });
  if (entry.status !== "pending_approval") {
    return res.status(409).json({ ok: false, error: `Cannot approve — entry is currently '${entry.status}'` });
  }
  if (entry.requested_by === req.user.id) {
    return res.status(403).json({ ok: false, error: "Maker-checker violation: you cannot approve your own request" });
  }

  const txn = db.transaction(() => {
    const now = nowIso();
    db.prepare("UPDATE watchlist_entries SET status = 'active', reviewed_by = ?, reviewed_at = ? WHERE id = ?").run(
      req.user.id, now, entry.id
    );
    logHistory(entry.id, "approved", req.user.id, req.body?.notes || null);
    writeAudit({
      actorId: req.user.id, action: "watchlist.approve", resourceType: "watchlist_entry", resourceId: entry.id,
      details: { requested_by: entry.requested_by }, ipAddress: clientIp(req),
    });
  });
  txn();
  res.json({ ok: true, entry: getEntryWithContext(entry.id) });
});

// ---- reject (checker) ----
router.post("/:id/reject", requirePermission("watchlist.approve"), (req, res) => {
  const entry = getEntry(req.params.id);
  if (!entry) return res.status(404).json({ ok: false, error: "Watchlist entry not found" });
  if (entry.status !== "pending_approval") {
    return res.status(409).json({ ok: false, error: `Cannot reject — entry is currently '${entry.status}'` });
  }
  if (entry.requested_by === req.user.id) {
    return res.status(403).json({ ok: false, error: "Maker-checker violation: you cannot review your own request" });
  }
  const { notes } = req.body || {};
  if (!notes || !notes.trim()) {
    return res.status(400).json({ ok: false, error: "notes are required when rejecting a request" });
  }

  const txn = db.transaction(() => {
    const now = nowIso();
    db.prepare("UPDATE watchlist_entries SET status = 'rejected', reviewed_by = ?, reviewed_at = ? WHERE id = ?").run(
      req.user.id, now, entry.id
    );
    logHistory(entry.id, "rejected", req.user.id, notes);
    writeAudit({
      actorId: req.user.id, action: "watchlist.reject", resourceType: "watchlist_entry", resourceId: entry.id,
      details: { notes }, ipAddress: clientIp(req),
    });
  });
  txn();
  res.json({ ok: true, entry: getEntryWithContext(entry.id) });
});

// ---- suspend ----
router.post("/:id/suspend", requirePermission("watchlist.suspend"), (req, res) => {
  const entry = getEntry(req.params.id);
  if (!entry) return res.status(404).json({ ok: false, error: "Watchlist entry not found" });
  if (entry.status !== "active") {
    return res.status(409).json({ ok: false, error: `Cannot suspend — entry is currently '${entry.status}'` });
  }
  const txn = db.transaction(() => {
    db.prepare("UPDATE watchlist_entries SET status = 'suspended' WHERE id = ?").run(entry.id);
    logHistory(entry.id, "suspended", req.user.id, req.body?.notes || null);
    writeAudit({ actorId: req.user.id, action: "watchlist.suspend", resourceType: "watchlist_entry", resourceId: entry.id, ipAddress: clientIp(req) });
  });
  txn();
  res.json({ ok: true, entry: getEntryWithContext(entry.id) });
});

// ---- reactivate ----
router.post("/:id/reactivate", requirePermission("watchlist.suspend"), (req, res) => {
  const entry = getEntry(req.params.id);
  if (!entry) return res.status(404).json({ ok: false, error: "Watchlist entry not found" });
  if (entry.status !== "suspended") {
    return res.status(409).json({ ok: false, error: `Cannot reactivate — entry is currently '${entry.status}'` });
  }
  const txn = db.transaction(() => {
    db.prepare("UPDATE watchlist_entries SET status = 'active' WHERE id = ?").run(entry.id);
    logHistory(entry.id, "reactivated", req.user.id, req.body?.notes || null);
    writeAudit({ actorId: req.user.id, action: "watchlist.reactivate", resourceType: "watchlist_entry", resourceId: entry.id, ipAddress: clientIp(req) });
  });
  txn();
  res.json({ ok: true, entry: getEntryWithContext(entry.id) });
});

module.exports = router;
