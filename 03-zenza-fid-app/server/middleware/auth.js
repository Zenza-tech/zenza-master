const crypto = require("node:crypto");
const { db, nowIso } = require("../platformDb");
const { getTenantDb } = require("../tenantDb");

const SESSION_COOKIE = "zenza_session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

function createSession(userId, orgId) {
  const token = crypto.randomBytes(32).toString("hex");
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_MS);
  db.prepare(
    "INSERT INTO sessions (token, user_id, org_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)"
  ).run(token, userId, orgId, now.toISOString(), expires.toISOString());
  return { token, expiresAt: expires };
}

function destroySession(token) {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  });
  return out;
}

// In production (behind real HTTPS), cookies must be marked Secure so
// browsers refuse to send them over plain HTTP. Locally (NODE_ENV
// unset/development), Secure is left off so the app still works over
// plain http://localhost, which browsers require for testing without a
// certificate. Set NODE_ENV=production when you deploy for this to apply
// automatically — no code change needed at deploy time.
const IS_PRODUCTION = process.env.NODE_ENV === "production";

function setSessionCookie(res, token, expiresAt) {
  const attrs = [
    `${SESSION_COOKIE}=${token}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Expires=${expiresAt.toUTCString()}`,
  ];
  if (IS_PRODUCTION) attrs.push("Secure");
  res.setHeader("Set-Cookie", attrs.join("; "));
}

function clearSessionCookie(res) {
  const attrs = [
    `${SESSION_COOKIE}=`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];
  if (IS_PRODUCTION) attrs.push("Secure");
  res.setHeader("Set-Cookie", attrs.join("; "));
}

// user + role + permission codes + org, given a valid session. The org_id
// on the session itself (not just the user record) is the belt-and-braces
// check here — if a user is ever moved between organizations, their old
// sessions carry the old org_id and this comparison catches the mismatch
// rather than silently trusting a stale session into the wrong tenant.
function getUserFromToken(token) {
  if (!token) return null;
  const session = db.prepare("SELECT * FROM sessions WHERE token = ?").get(token);
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    destroySession(token);
    return null;
  }
  const user = db
    .prepare(
      `SELECT u.id, u.org_id, u.full_name, u.email, u.status, u.role_id, u.is_platform_admin,
              r.name AS role, o.name AS org_name, o.slug AS org_slug, o.status AS org_status
       FROM users u
       JOIN roles r ON r.id = u.role_id
       JOIN organizations o ON o.id = u.org_id
       WHERE u.id = ?`
    )
    .get(session.user_id);
  if (!user || user.status !== "active") return null;
  if (user.org_id !== session.org_id) return null; // stale/mismatched session — refuse rather than guess
  if (user.org_status !== "active") return null; // the whole organization has been suspended

  const perms = db
    .prepare(
      `SELECT p.code FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
       WHERE rp.role_id = ?`
    )
    .all(user.role_id)
    .map((r) => r.code);

  return { ...user, is_platform_admin: !!user.is_platform_admin, permissions: perms };
}

function requireAuth(req, res, next) {
  const cookies = parseCookies(req);
  const user = getUserFromToken(cookies[SESSION_COOKIE]);
  if (!user) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }
  req.user = user;
  req.sessionToken = cookies[SESSION_COOKIE];
  req.tenantDb = getTenantDb(user.org_id); // every route reaches tenant data through this, never a global import
  next();
}

function requirePermission(code) {
  return (req, res, next) => {
    if (!req.user || !req.user.permissions.includes(code)) {
      return res.status(403).json({ ok: false, error: `Missing permission: ${code}` });
    }
    next();
  };
}

function requirePlatformAdmin(req, res, next) {
  if (!req.user || !req.user.is_platform_admin) {
    return res.status(403).json({ ok: false, error: "Platform admin access required" });
  }
  next();
}

module.exports = {
  SESSION_COOKIE,
  createSession,
  destroySession,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  getUserFromToken,
  requireAuth,
  requirePermission,
  requirePlatformAdmin,
};
