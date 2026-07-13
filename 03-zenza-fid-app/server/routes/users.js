const express = require("express");
const crypto = require("node:crypto");
const { db, nowIso, hashPassword } = require("../db");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { writeAudit, clientIp } = require("../middleware/audit");

const router = express.Router();
router.use(requireAuth);

router.get("/", requirePermission("users.manage"), (req, res) => {
  const rows = db
    .prepare(
      `SELECT u.id, u.full_name, u.email, u.status, u.created_at, u.last_login_at, r.name AS role
       FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.created_at DESC`
    )
    .all();
  res.json({ ok: true, results: rows });
});

router.get("/roles", requirePermission("users.manage"), (req, res) => {
  res.json({ ok: true, roles: db.prepare("SELECT id, name, description FROM roles").all() });
});

router.post("/", requirePermission("users.manage"), (req, res) => {
  const { full_name, email, password, role } = req.body || {};
  if (!full_name || !email || !password || !role) {
    return res.status(400).json({ ok: false, error: "full_name, email, password, and role are required" });
  }
  if (password.length < 8) {
    return res.status(400).json({ ok: false, error: "Password must be at least 8 characters" });
  }
  const roleRow = db.prepare("SELECT id FROM roles WHERE name = ?").get(role);
  if (!roleRow) return res.status(400).json({ ok: false, error: `Unknown role: ${role}` });

  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email.trim().toLowerCase());
  if (existing) return res.status(409).json({ ok: false, error: "A user with this email already exists" });

  const salt = crypto.randomBytes(16).toString("hex");
  const hash = hashPassword(password, salt);
  const result = db
    .prepare(
      `INSERT INTO users (full_name, email, password_hash, password_salt, role_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?)`
    )
    .run(full_name.trim(), email.trim().toLowerCase(), hash, salt, roleRow.id, nowIso());

  writeAudit({
    actorId: req.user.id, action: "user.create", resourceType: "user", resourceId: result.lastInsertRowid,
    details: { email: email.trim().toLowerCase(), role }, ipAddress: clientIp(req),
  });

  res.status(201).json({ ok: true, id: result.lastInsertRowid });
});

router.put("/:id/role", requirePermission("users.manage"), (req, res) => {
  const { role } = req.body || {};
  const roleRow = db.prepare("SELECT id FROM roles WHERE name = ?").get(role);
  if (!roleRow) return res.status(400).json({ ok: false, error: `Unknown role: ${role}` });

  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(req.params.id);
  if (!user) return res.status(404).json({ ok: false, error: "User not found" });

  db.prepare("UPDATE users SET role_id = ? WHERE id = ?").run(roleRow.id, user.id);
  writeAudit({ actorId: req.user.id, action: "user.role_change", resourceType: "user", resourceId: user.id, details: { new_role: role }, ipAddress: clientIp(req) });
  res.json({ ok: true });
});

router.put("/:id/status", requirePermission("users.manage"), (req, res) => {
  const { status } = req.body || {};
  if (!["active", "disabled"].includes(status)) {
    return res.status(400).json({ ok: false, error: "status must be 'active' or 'disabled'" });
  }
  if (Number(req.params.id) === req.user.id) {
    return res.status(400).json({ ok: false, error: "You cannot disable your own account" });
  }
  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(req.params.id);
  if (!user) return res.status(404).json({ ok: false, error: "User not found" });

  db.prepare("UPDATE users SET status = ? WHERE id = ?").run(status, user.id);
  writeAudit({ actorId: req.user.id, action: "user.status_change", resourceType: "user", resourceId: user.id, details: { new_status: status }, ipAddress: clientIp(req) });
  res.json({ ok: true });
});

// self-service password change
router.post("/me/change-password", (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password) {
    return res.status(400).json({ ok: false, error: "current_password and new_password are required" });
  }
  if (new_password.length < 8) {
    return res.status(400).json({ ok: false, error: "New password must be at least 8 characters" });
  }
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  const attemptedHash = hashPassword(current_password, user.password_salt);
  const valid = crypto.timingSafeEqual(Buffer.from(attemptedHash, "hex"), Buffer.from(user.password_hash, "hex"));
  if (!valid) return res.status(401).json({ ok: false, error: "Current password is incorrect" });

  const salt = crypto.randomBytes(16).toString("hex");
  const hash = hashPassword(new_password, salt);
  db.prepare("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?").run(hash, salt, user.id);
  writeAudit({ actorId: user.id, action: "user.password_change", resourceType: "user", resourceId: user.id, ipAddress: clientIp(req) });
  res.json({ ok: true });
});

module.exports = router;
