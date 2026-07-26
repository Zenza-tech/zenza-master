const express = require("express");
const { db: platformDb } = require("../platformDb");
const { requireAuth, requirePermission } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

function resolveUsers(userIds) {
  const ids = [...new Set(userIds.filter((id) => id != null))];
  if (ids.length === 0) return {};
  const rows = platformDb
    .prepare(`SELECT id, full_name, email FROM users WHERE id IN (${ids.map(() => "?").join(",")})`)
    .all(...ids);
  return Object.fromEntries(rows.map((r) => [r.id, r]));
}

router.get("/", requirePermission("audit.view"), (req, res) => {
  const db = req.tenantDb;
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
    .prepare(`SELECT a.* FROM audit_log a ${where} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, l, offset);

  const users = resolveUsers(rows.map((r) => r.actor_id));
  const results = rows.map((r) => ({
    ...r,
    details: r.details ? JSON.parse(r.details) : null,
    actor_name: r.actor_id ? users[r.actor_id]?.full_name || `User #${r.actor_id}` : "system",
    actor_email: r.actor_id ? users[r.actor_id]?.email || null : null,
  }));

  res.json({ ok: true, total, page: p, limit: l, results });
});

module.exports = router;
