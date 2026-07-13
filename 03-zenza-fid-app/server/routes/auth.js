const express = require("express");
const crypto = require("node:crypto");
const { db, nowIso, hashPassword } = require("../db");
const {
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
} = require("../middleware/auth");
const { writeAudit, clientIp } = require("../middleware/audit");

const router = express.Router();

router.post("/login", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ ok: false, error: "Email and password are required" });
  }

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email.trim().toLowerCase());
  if (!user || user.status !== "active") {
    return res.status(401).json({ ok: false, error: "Invalid email or password" });
  }

  const attemptedHash = hashPassword(password, user.password_salt);
  const valid = crypto.timingSafeEqual(
    Buffer.from(attemptedHash, "hex"),
    Buffer.from(user.password_hash, "hex")
  );
  if (!valid) {
    writeAudit({ actorId: user.id, action: "auth.login_failed", resourceType: "user", resourceId: user.id, ipAddress: clientIp(req) });
    return res.status(401).json({ ok: false, error: "Invalid email or password" });
  }

  const { token, expiresAt } = createSession(user.id);
  setSessionCookie(res, token, expiresAt);
  db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(nowIso(), user.id);
  writeAudit({ actorId: user.id, action: "auth.login", resourceType: "user", resourceId: user.id, ipAddress: clientIp(req) });

  res.json({ ok: true, user: { id: user.id, full_name: user.full_name, email: user.email } });
});

router.post("/logout", requireAuth, (req, res) => {
  writeAudit({ actorId: req.user.id, action: "auth.logout", resourceType: "user", resourceId: req.user.id, ipAddress: clientIp(req) });
  destroySession(req.sessionToken);
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get("/me", requireAuth, (req, res) => {
  const { id, full_name, email, role, permissions } = req.user;
  res.json({ ok: true, user: { id, full_name, email, role, permissions } });
});

module.exports = router;
