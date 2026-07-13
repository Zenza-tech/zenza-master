const express = require("express");
const { db, nowIso } = require("../db");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { writeAudit, clientIp } = require("../middleware/audit");

const router = express.Router();
router.use(requireAuth);

const VALID_IDENTIFIER_TYPES = ["BVN", "NIN", "EMAIL", "PHONE", "ACCOUNT", "DEVICE"];

function getIdentifiers(entityId) {
  return db
    .prepare("SELECT id, identifier_type, identifier_value, created_at FROM entity_identifiers WHERE entity_id = ? ORDER BY id")
    .all(entityId);
}

function getEntitySnapshot(entityId) {
  const entity = db.prepare("SELECT * FROM entities WHERE id = ?").get(entityId);
  if (!entity) return null;
  return { ...entity, identifiers: getIdentifiers(entityId) };
}

function findDuplicates(identifiers) {
  if (!identifiers || identifiers.length === 0) return [];
  const placeholders = identifiers.map(() => "?").join(",");
  const values = identifiers.map((i) => i.value);
  const matches = db
    .prepare(
      `SELECT ei.identifier_type, ei.identifier_value, e.id AS entity_id, e.full_name
       FROM entity_identifiers ei JOIN entities e ON e.id = ei.entity_id
       WHERE ei.identifier_value IN (${placeholders})`
    )
    .all(...values);
  return matches;
}

// ---- list / search ----
router.get("/", requirePermission("entities.view"), (req, res) => {
  const { q, type, status, page = 1, limit = 25 } = req.query;
  const p = Math.max(parseInt(page, 10) || 1, 1);
  const l = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
  const offset = (p - 1) * l;

  let where = "WHERE 1=1";
  const params = [];
  if (status) {
    where += " AND e.status = ?";
    params.push(status);
  }
  if (type) {
    where += " AND e.entity_type = ?";
    params.push(type);
  }
  if (q) {
    where += ` AND (e.full_name LIKE ? OR e.id IN (
      SELECT entity_id FROM entity_identifiers WHERE identifier_value LIKE ?
    ))`;
    params.push(`%${q}%`, `%${q}%`);
  }

  const total = db.prepare(`SELECT COUNT(*) AS n FROM entities e ${where}`).get(...params).n;
  const rows = db
    .prepare(
      `SELECT e.*, (SELECT COUNT(*) FROM watchlist_entries w WHERE w.entity_id = e.id AND w.status = 'active') AS active_watchlist_count
       FROM entities e ${where} ORDER BY e.updated_at DESC LIMIT ? OFFSET ?`
    )
    .all(...params, l, offset);

  const withIdentifiers = rows.map((r) => ({ ...r, identifiers: getIdentifiers(r.id) }));
  res.json({ ok: true, total, page: p, limit: l, results: withIdentifiers });
});

// ---- detail ----
router.get("/:id", requirePermission("entities.view"), (req, res) => {
  const entity = getEntitySnapshot(req.params.id);
  if (!entity) return res.status(404).json({ ok: false, error: "Entity not found" });

  const watchlist = db
    .prepare("SELECT * FROM watchlist_entries WHERE entity_id = ? ORDER BY created_at DESC")
    .all(entity.id);
  const versions = db
    .prepare("SELECT id, changed_by, change_summary, created_at FROM entity_versions WHERE entity_id = ? ORDER BY created_at DESC")
    .all(entity.id);

  res.json({ ok: true, entity, watchlist, versions });
});

// ---- version history (full snapshots) ----
router.get("/:id/history", requirePermission("entities.view"), (req, res) => {
  const versions = db
    .prepare("SELECT * FROM entity_versions WHERE entity_id = ? ORDER BY created_at DESC")
    .all(req.params.id)
    .map((v) => ({ ...v, snapshot: JSON.parse(v.snapshot) }));
  res.json({ ok: true, versions });
});

// ---- create ----
router.post("/", requirePermission("entities.create"), (req, res) => {
  const { full_name, entity_type = "individual", risk_notes = "", identifiers = [], force = false } = req.body || {};

  if (!full_name || !full_name.trim()) {
    return res.status(400).json({ ok: false, error: "full_name is required" });
  }
  for (const id of identifiers) {
    if (!VALID_IDENTIFIER_TYPES.includes(id.type)) {
      return res.status(400).json({ ok: false, error: `Invalid identifier type: ${id.type}` });
    }
    if (!id.value || !String(id.value).trim()) {
      return res.status(400).json({ ok: false, error: "Identifier value cannot be empty" });
    }
  }

  if (!force) {
    const dupes = findDuplicates(identifiers);
    if (dupes.length > 0) {
      return res.status(409).json({
        ok: false,
        error: "Possible duplicate — one or more identifiers already exist on another entity",
        duplicates: dupes,
      });
    }
  }

  const txn = db.transaction(() => {
    const now = nowIso();
    const result = db
      .prepare(
        `INSERT INTO entities (entity_type, full_name, risk_notes, status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, 'active', ?, ?, ?)`
      )
      .run(entity_type, full_name.trim(), risk_notes, req.user.id, now, now);
    const entityId = result.lastInsertRowid;

    const insertId = db.prepare(
      "INSERT INTO entity_identifiers (entity_id, identifier_type, identifier_value, created_at) VALUES (?, ?, ?, ?)"
    );
    identifiers.forEach((id) => insertId.run(entityId, id.type, String(id.value).trim(), now));

    const snapshot = getEntitySnapshot(entityId);
    db.prepare(
      `INSERT INTO entity_versions (entity_id, changed_by, change_summary, snapshot, created_at)
       VALUES (?, ?, 'Entity created', ?, ?)`
    ).run(entityId, req.user.id, JSON.stringify(snapshot), now);

    writeAudit({
      actorId: req.user.id,
      action: "entity.create",
      resourceType: "entity",
      resourceId: entityId,
      details: { full_name: full_name.trim(), identifier_count: identifiers.length },
      ipAddress: clientIp(req),
    });

    return entityId;
  });

  const entityId = txn();
  res.status(201).json({ ok: true, entity: getEntitySnapshot(entityId) });
});

// ---- update ----
router.put("/:id", requirePermission("entities.edit"), (req, res) => {
  const existing = db.prepare("SELECT * FROM entities WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ ok: false, error: "Entity not found" });

  const { full_name, entity_type, risk_notes, status, identifiers, change_summary } = req.body || {};

  const txn = db.transaction(() => {
    const now = nowIso();
    db.prepare(
      `UPDATE entities SET
        full_name = COALESCE(?, full_name),
        entity_type = COALESCE(?, entity_type),
        risk_notes = COALESCE(?, risk_notes),
        status = COALESCE(?, status),
        updated_at = ?
       WHERE id = ?`
    ).run(full_name, entity_type, risk_notes, status, now, existing.id);

    if (Array.isArray(identifiers)) {
      db.prepare("DELETE FROM entity_identifiers WHERE entity_id = ?").run(existing.id);
      const insertId = db.prepare(
        "INSERT INTO entity_identifiers (entity_id, identifier_type, identifier_value, created_at) VALUES (?, ?, ?, ?)"
      );
      identifiers.forEach((id) => insertId.run(existing.id, id.type, String(id.value).trim(), now));
    }

    const snapshot = getEntitySnapshot(existing.id);
    db.prepare(
      `INSERT INTO entity_versions (entity_id, changed_by, change_summary, snapshot, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(existing.id, req.user.id, change_summary || "Entity updated", JSON.stringify(snapshot), now);

    writeAudit({
      actorId: req.user.id,
      action: "entity.update",
      resourceType: "entity",
      resourceId: existing.id,
      details: { change_summary: change_summary || null },
      ipAddress: clientIp(req),
    });
  });

  txn();
  res.json({ ok: true, entity: getEntitySnapshot(existing.id) });
});

// ---- bulk create ----
router.post("/bulk", requirePermission("entities.create"), (req, res) => {
  const { records } = req.body || {};
  if (!Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ ok: false, error: "records must be a non-empty array" });
  }
  if (records.length > 500) {
    return res.status(400).json({ ok: false, error: "Max 500 records per bulk upload" });
  }

  const results = { created: [], skipped_duplicates: [], errors: [] };
  const now = nowIso();

  records.forEach((rec, idx) => {
    try {
      if (!rec.full_name || !String(rec.full_name).trim()) {
        results.errors.push({ row: idx, error: "full_name is required" });
        return;
      }
      const identifiers = rec.identifiers || [];
      const dupes = findDuplicates(identifiers);
      if (dupes.length > 0) {
        results.skipped_duplicates.push({ row: idx, full_name: rec.full_name, duplicates: dupes });
        return;
      }

      const txn = db.transaction(() => {
        const result = db
          .prepare(
            `INSERT INTO entities (entity_type, full_name, risk_notes, status, created_by, created_at, updated_at)
             VALUES (?, ?, ?, 'active', ?, ?, ?)`
          )
          .run(rec.entity_type || "individual", String(rec.full_name).trim(), rec.risk_notes || "", req.user.id, now, now);
        const entityId = result.lastInsertRowid;
        const insertId = db.prepare(
          "INSERT INTO entity_identifiers (entity_id, identifier_type, identifier_value, created_at) VALUES (?, ?, ?, ?)"
        );
        identifiers.forEach((id) => insertId.run(entityId, id.type, String(id.value).trim(), now));
        const snapshot = getEntitySnapshot(entityId);
        db.prepare(
          `INSERT INTO entity_versions (entity_id, changed_by, change_summary, snapshot, created_at)
           VALUES (?, ?, 'Created via bulk upload', ?, ?)`
        ).run(entityId, req.user.id, JSON.stringify(snapshot), now);
        return entityId;
      });

      const entityId = txn();
      results.created.push({ row: idx, entity_id: entityId, full_name: rec.full_name });
    } catch (err) {
      results.errors.push({ row: idx, error: err.message });
    }
  });

  writeAudit({
    actorId: req.user.id,
    action: "entity.bulk_create",
    resourceType: "entity",
    details: { created: results.created.length, skipped: results.skipped_duplicates.length, errors: results.errors.length },
    ipAddress: clientIp(req),
  });

  res.status(201).json({ ok: true, ...results });
});

module.exports = router;
