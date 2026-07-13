const express = require("express");
const { db } = require("../db");
const { requireAuth, requirePermission } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

router.get("/", requirePermission("audit.view"), (req, res) => {
  const { actor_id, action, resource_type, from, to, page = 1, limit = 50 } = req.query;
  const p = Math.max(parseInt(page, 10) || 1, 1);
  const l = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const offset = (p - 1) * l;

  let where = "WHERE 1=1";
  const params = [];
  if (actor_id) { where += " AND a.actor_id = ?"; params.push(actor_id); }
  if (action) { where += " AND a.action LIKE ?"; params.push(`%${action}%`); }
  if (resource_type) { where += " AND a.resource_type = ?"; params.push(resource_type); }
  if (from) { where += " AND a.created_at >= ?"; params.push(from); }
  if (to) { where += " AND a.created_at <= ?"; params.push(to); }

  const total = db.prepare(`SELECT COUNT(*) AS n FROM audit_log a ${where}`).get(...params).n;
  const rows = db
    .prepare(
      `SELECT a.*, u.full_name AS actor_name, u.email AS actor_email
       FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
       ${where} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`
    )
    .all(...params, l, offset)
    .map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null }));

  res.json({ ok: true, total, page: p, limit: l, results: rows });
});

module.exports = router;
