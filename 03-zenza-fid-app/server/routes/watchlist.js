const express = require("express");
const path = require("node:path");
const fs = require("node:fs");
const { nowIso } = require("../utils/time");
const { db: platformDb } = require("../platformDb");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { writeAudit, clientIp } = require("../middleware/audit");
const { upload, tenantAttachmentsDir } = require("../utils/upload");
const { summarizeFile, summaryStatusFor } = require("../services/summarize");
const { indexWatchlistEntry } = require("../services/search");
const { recordInput } = require("../services/inputHistory");
const { publishSignals, withdrawSignals, checkIdentifiers } = require("../services/network");

const router = express.Router();
router.use(requireAuth);

const VALID_SEVERITY = ["low", "medium", "high", "critical"];

/**
 * Users live in the platform database; tenant data (including
 * watchlist_entries.requested_by/reviewed_by) only stores their numeric
 * id, since SQLite can't join across two separate database files. This
 * resolves a batch of user ids to display names in application code
 * instead — a small, deliberate seam at the tenant/platform boundary,
 * not a workaround for a bug.
 */
function resolveUserNames(userIds) {
  const ids = [...new Set(userIds.filter((id) => id != null))];
  if (ids.length === 0) return {};
  const rows = platformDb
    .prepare(`SELECT id, full_name FROM users WHERE id IN (${ids.map(() => "?").join(",")})`)
    .all(...ids);
  return Object.fromEntries(rows.map((r) => [r.id, r.full_name]));
}

function logHistory(db, watchlistId, action, actorId, notes = null) {
  db.prepare(
    "INSERT INTO watchlist_history (watchlist_id, action, actor_id, notes, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(watchlistId, action, actorId, notes, nowIso());
}

function applyAutoExpiry(db) {
  const expired = db
    .prepare("SELECT id FROM watchlist_entries WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < ?")
    .all(nowIso());
  if (expired.length === 0) return;
  const update = db.prepare("UPDATE watchlist_entries SET status = 'expired' WHERE id = ?");
  expired.forEach((row) => {
    update.run(row.id);
    logHistory(db, row.id, "auto_expired", null, "Automatically expired — past expires_at");
  });
}

function getEntry(db, id) {
  return db.prepare("SELECT * FROM watchlist_entries WHERE id = ?").get(id);
}

function getEntryWithContext(db, id) {
  const entry = getEntry(db, id);
  if (!entry) return null;
  const entity = db.prepare("SELECT id, full_name, entity_type FROM entities WHERE id = ?").get(entry.entity_id);
  const history = db
    .prepare(`SELECT * FROM watchlist_history WHERE watchlist_id = ? ORDER BY created_at ASC`)
    .all(id);
  const names = resolveUserNames(history.map((h) => h.actor_id));
  const historyWithNames = history.map((h) => ({
    ...h,
    actor_name: h.actor_id ? names[h.actor_id] || `User #${h.actor_id}` : "system",
  }));
  return { ...entry, entity, history: historyWithNames };
}

router.get("/", requirePermission("watchlist.view"), (req, res) => {
  const db = req.tenantDb;
  applyAutoExpiry(db);
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
      `SELECT w.*, e.full_name AS entity_name
       FROM watchlist_entries w
       JOIN entities e ON e.id = w.entity_id
       ${where} ORDER BY w.created_at DESC LIMIT ? OFFSET ?`
    )
    .all(...params, l, offset);

  const names = resolveUserNames(rows.flatMap((r) => [r.requested_by, r.reviewed_by]));
  const withNames = rows.map((r) => ({
    ...r,
    requested_by_name: names[r.requested_by] || `User #${r.requested_by}`,
    reviewed_by_name: r.reviewed_by ? names[r.reviewed_by] || `User #${r.reviewed_by}` : null,
  }));

  res.json({ ok: true, total, page: p, limit: l, results: withNames });
});

router.get("/:id", requirePermission("watchlist.view"), (req, res) => {
  const db = req.tenantDb;
  applyAutoExpiry(db);
  const entry = getEntryWithContext(db, req.params.id);
  if (!entry) return res.status(404).json({ ok: false, error: "Watchlist entry not found" });
  res.json({ ok: true, entry });
});

router.post("/", requirePermission("watchlist.create"), (req, res) => {
  const db = req.tenantDb;
  const { entity_id, category, severity, reason, expires_at = null } = req.body || {};
  if (!entity_id || !category || !severity || !reason) {
    return res.status(400).json({ ok: false, error: "entity_id, category, severity, and reason are required" });
  }
  if (!VALID_SEVERITY.includes(severity)) {
    return res.status(400).json({ ok: false, error: `severity must be one of: ${VALID_SEVERITY.join(", ")}` });
  }
  const trimmedReason = String(reason).trim();
  if (trimmedReason.length < 20) {
    return res.status(400).json({ ok: false, error: "reason must be at least 20 characters — a substantive justification, not a placeholder" });
  }
  if (trimmedReason.length > 4000) {
    return res.status(400).json({ ok: false, error: "reason must be 4000 characters or fewer" });
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
      .run(entity_id, category, severity, trimmedReason, req.user.id, now, expires_at);
    const id = result.lastInsertRowid;
    logHistory(db, id, "created", req.user.id, "Submitted for approval");
    writeAudit(db, {
      actorId: req.user.id, action: "watchlist.create", resourceType: "watchlist_entry", resourceId: id,
      details: { entity_id, severity, category }, ipAddress: clientIp(req),
    });
    return id;
  });

  const id = txn();
  indexWatchlistEntry(db, db.prepare("SELECT * FROM watchlist_entries WHERE id = ?").get(id));
  recordInput(db, req.user.id, "watchlist_category", category);
  recordInput(db, req.user.id, "watchlist_reason", trimmedReason);
  res.status(201).json({ ok: true, entry: getEntryWithContext(db, id) });
});

router.post("/:id/approve", requirePermission("watchlist.approve"), (req, res) => {
  const db = req.tenantDb;
  const entry = getEntry(db, req.params.id);
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
    logHistory(db, entry.id, "approved", req.user.id, req.body?.notes || null);
    writeAudit(db, {
      actorId: req.user.id, action: "watchlist.approve", resourceType: "watchlist_entry", resourceId: entry.id,
      details: { requested_by: entry.requested_by }, ipAddress: clientIp(req),
    });
  });
  txn();
  // Approved and active — contribute to the cross-org network, but only
  // if this organization opted in. Pending/rejected entries are never
  // published; see services/network.js for why.
  publishSignals(db, req.user.org_id, getEntry(db, entry.id));
  res.json({ ok: true, entry: getEntryWithContext(db, entry.id) });
});

router.post("/:id/reject", requirePermission("watchlist.approve"), (req, res) => {
  const db = req.tenantDb;
  const entry = getEntry(db, req.params.id);
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
    logHistory(db, entry.id, "rejected", req.user.id, notes);
    writeAudit(db, {
      actorId: req.user.id, action: "watchlist.reject", resourceType: "watchlist_entry", resourceId: entry.id,
      details: { notes }, ipAddress: clientIp(req),
    });
  });
  txn();
  res.json({ ok: true, entry: getEntryWithContext(db, entry.id) });
});

const RECALL_WINDOW_MS = 10 * 60 * 1000;

router.post("/:id/recall", requirePermission("watchlist.create"), (req, res) => {
  const db = req.tenantDb;
  const entry = getEntry(db, req.params.id);
  if (!entry) return res.status(404).json({ ok: false, error: "Watchlist entry not found" });
  if (entry.status !== "pending_approval") {
    return res.status(409).json({ ok: false, error: `Cannot recall — entry is currently '${entry.status}'` });
  }
  if (entry.requested_by !== req.user.id) {
    return res.status(403).json({ ok: false, error: "You can only recall your own request" });
  }
  const ageMs = Date.now() - new Date(entry.created_at).getTime();
  if (ageMs > RECALL_WINDOW_MS) {
    return res.status(409).json({ ok: false, error: "The 10-minute recall window has passed — ask a fraud manager to reject this request instead" });
  }

  const txn = db.transaction(() => {
    db.prepare("UPDATE watchlist_entries SET status = 'recalled' WHERE id = ?").run(entry.id);
    logHistory(db, entry.id, "recalled", req.user.id, req.body?.notes || "Recalled by submitter within the 10-minute window");
    writeAudit(db, { actorId: req.user.id, action: "watchlist.recall", resourceType: "watchlist_entry", resourceId: entry.id, ipAddress: clientIp(req) });
  });
  txn();
  withdrawSignals(req.user.org_id, entry.id); // withdrawn -> stop sharing
  res.json({ ok: true, entry: getEntryWithContext(db, entry.id) });
});

router.post("/:id/suspend", requirePermission("watchlist.suspend"), (req, res) => {
  const db = req.tenantDb;
  const entry = getEntry(db, req.params.id);
  if (!entry) return res.status(404).json({ ok: false, error: "Watchlist entry not found" });
  if (entry.status !== "active") {
    return res.status(409).json({ ok: false, error: `Cannot suspend — entry is currently '${entry.status}'` });
  }
  const txn = db.transaction(() => {
    db.prepare("UPDATE watchlist_entries SET status = 'suspended' WHERE id = ?").run(entry.id);
    logHistory(db, entry.id, "suspended", req.user.id, req.body?.notes || null);
    writeAudit(db, { actorId: req.user.id, action: "watchlist.suspend", resourceType: "watchlist_entry", resourceId: entry.id, ipAddress: clientIp(req) });
  });
  txn();
  withdrawSignals(req.user.org_id, entry.id); // no longer active -> stop sharing
  res.json({ ok: true, entry: getEntryWithContext(db, entry.id) });
});

router.post("/:id/reactivate", requirePermission("watchlist.suspend"), (req, res) => {
  const db = req.tenantDb;
  const entry = getEntry(db, req.params.id);
  if (!entry) return res.status(404).json({ ok: false, error: "Watchlist entry not found" });
  if (entry.status !== "suspended") {
    return res.status(409).json({ ok: false, error: `Cannot reactivate — entry is currently '${entry.status}'` });
  }
  const txn = db.transaction(() => {
    db.prepare("UPDATE watchlist_entries SET status = 'active' WHERE id = ?").run(entry.id);
    logHistory(db, entry.id, "reactivated", req.user.id, req.body?.notes || null);
    writeAudit(db, { actorId: req.user.id, action: "watchlist.reactivate", resourceType: "watchlist_entry", resourceId: entry.id, ipAddress: clientIp(req) });
  });
  txn();
  publishSignals(db, req.user.org_id, getEntry(db, entry.id)); // active again -> resume sharing
  res.json({ ok: true, entry: getEntryWithContext(db, entry.id) });
});

router.get("/:id/attachments", requirePermission("watchlist.view"), (req, res) => {
  const db = req.tenantDb;
  const entry = getEntry(db, req.params.id);
  if (!entry) return res.status(404).json({ ok: false, error: "Watchlist entry not found" });

  const rows = db
    .prepare(
      `SELECT id, original_filename, mime_type, size_bytes, uploaded_at, uploaded_by, ai_summary, summary_status
       FROM watchlist_attachments WHERE watchlist_id = ? ORDER BY uploaded_at DESC`
    )
    .all(entry.id);
  const names = resolveUserNames(rows.map((r) => r.uploaded_by));
  const withNames = rows.map((r) => ({ ...r, uploaded_by_name: names[r.uploaded_by] || `User #${r.uploaded_by}` }));
  res.json({ ok: true, results: withNames });
});

router.post("/:id/attachments", requirePermission("watchlist.create"), (req, res) => {
  const db = req.tenantDb;
  upload.array("files", 5)(req, res, async (err) => {
    if (err) return res.status(400).json({ ok: false, error: err.message });

    const entry = getEntry(db, req.params.id);
    if (!entry) return res.status(404).json({ ok: false, error: "Watchlist entry not found" });
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ ok: false, error: "No files were uploaded" });
    }

    const now = nowIso();
    const insert = db.prepare(
      `INSERT INTO watchlist_attachments (watchlist_id, original_filename, stored_filename, mime_type, size_bytes, uploaded_by, uploaded_at, summary_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const created = req.files.map((f) => {
      const result = insert.run(entry.id, f.originalname, f.filename, f.mimetype, f.size, req.user.id, now, summaryStatusFor(f.mimetype));
      return { id: result.lastInsertRowid, original_filename: f.originalname, size_bytes: f.size, mimetype: f.mimetype, path: f.path };
    });

    logHistory(db, entry.id, "attachment_uploaded", req.user.id, `${created.length} file(s): ${created.map((c) => c.original_filename).join(", ")}`);
    writeAudit(db, {
      actorId: req.user.id, action: "watchlist.attachment_upload", resourceType: "watchlist_entry", resourceId: entry.id,
      details: { files: created.map((c) => c.original_filename) }, ipAddress: clientIp(req),
    });

    let anySummarized = false;
    for (const file of created) {
      try {
        const result = await summarizeFile(file.path, file.mimetype);
        db.prepare("UPDATE watchlist_attachments SET ai_summary = ?, summary_status = ? WHERE id = ?").run(
          result.summary, result.status, file.id
        );
        file.summary_status = result.status;
        file.ai_summary = result.summary;
        if (result.status === "done") anySummarized = true;
        if (result.status === "failed") {
          console.warn(`Attachment #${file.id} summarization failed: ${result.reason}`);
        }
      } catch (summErr) {
        console.warn(`Attachment #${file.id} summarization threw unexpectedly: ${summErr.message}`);
        db.prepare("UPDATE watchlist_attachments SET summary_status = 'failed' WHERE id = ?").run(file.id);
        file.summary_status = "failed";
      }
      delete file.path;
    }

    if (anySummarized) {
      indexWatchlistEntry(db, db.prepare("SELECT * FROM watchlist_entries WHERE id = ?").get(entry.id));
    }

    res.status(201).json({ ok: true, uploaded: created });
  });
});

router.get("/:id/attachments/:attachmentId/download", requirePermission("watchlist.view"), (req, res) => {
  const db = req.tenantDb;
  const attachment = db
    .prepare("SELECT * FROM watchlist_attachments WHERE id = ? AND watchlist_id = ?")
    .get(req.params.attachmentId, req.params.id);
  if (!attachment) return res.status(404).json({ ok: false, error: "Attachment not found" });

  const filePath = path.join(tenantAttachmentsDir(req.user.org_id), attachment.stored_filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ ok: false, error: "File is missing from storage" });
  }

  writeAudit(db, {
    actorId: req.user.id, action: "watchlist.attachment_download", resourceType: "watchlist_entry", resourceId: attachment.watchlist_id,
    details: { attachment_id: attachment.id, filename: attachment.original_filename }, ipAddress: clientIp(req),
  });

  res.download(filePath, attachment.original_filename);
});

module.exports = router;
