const express = require("express");
const crypto = require("node:crypto");
const { db, nowIso, hashPassword } = require("../platformDb");
const { getTenantDb } = require("../tenantDb");
const {
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
} = require("../middleware/auth");
const { writeAudit, clientIp } = require("../middleware/audit");
const { loginRateLimit } = require("../middleware/rateLimit");

const router = express.Router();

// A fixed dummy hash/salt used only to keep response timing consistent when
// the email doesn't match any account — without this, an attacker could
// measure response time to tell "no such user" apart from "wrong password"
// and enumerate valid emails. The value itself is never used to grant access.
const DUMMY_SALT = "0".repeat(32);
const DUMMY_HASH = hashPassword("not-a-real-password", DUMMY_SALT);

router.post("/login", loginRateLimit, (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ ok: false, error: "Email and password are required" });
  }

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email.trim().toLowerCase());

  // Always perform a hash comparison, even for a non-existent user, so the
  // response takes the same time either way (see DUMMY_HASH above).
  const compareSalt = user ? user.password_salt : DUMMY_SALT;
  const compareHash = user ? user.password_hash : DUMMY_HASH;
  const attemptedHash = hashPassword(password, compareSalt);
  const valid = crypto.timingSafeEqual(
    Buffer.from(attemptedHash, "hex"),
    Buffer.from(compareHash, "hex")
  );

  if (!user || user.status !== "active" || !valid) {
    if (user) {
      // Failed-login attempts are audited in the org's own trail, not the
      // platform DB — an org's admin should be able to see failed logins
      // against their own accounts as part of their own audit view.
      const tenantDb = getTenantDb(user.org_id);
      writeAudit(tenantDb, { actorId: user.id, action: "auth.login_failed", resourceType: "user", resourceId: user.id, ipAddress: clientIp(req) });
    }
    return res.status(401).json({ ok: false, error: "Invalid email or password" });
  }

  const org = db.prepare("SELECT * FROM organizations WHERE id = ?").get(user.org_id);
  if (!org || org.status !== "active") {
    return res.status(401).json({ ok: false, error: "This organization's account is not currently active" });
  }

  const { token, expiresAt } = createSession(user.id, user.org_id);
  setSessionCookie(res, token, expiresAt);
  db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(nowIso(), user.id);

  const tenantDb = getTenantDb(user.org_id);
  writeAudit(tenantDb, { actorId: user.id, action: "auth.login", resourceType: "user", resourceId: user.id, ipAddress: clientIp(req) });

  res.json({ ok: true, user: { id: user.id, full_name: user.full_name, email: user.email, org_name: org.name } });
});

router.post("/logout", requireAuth, (req, res) => {
  writeAudit(req.tenantDb, { actorId: req.user.id, action: "auth.logout", resourceType: "user", resourceId: req.user.id, ipAddress: clientIp(req) });
  destroySession(req.sessionToken);
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get("/me", requireAuth, (req, res) => {
  const { id, full_name, email, role, permissions, org_name, org_slug, is_platform_admin } = req.user;
  res.json({ ok: true, user: { id, full_name, email, role, permissions, org_name, org_slug, is_platform_admin } });
});

module.exports = router;
