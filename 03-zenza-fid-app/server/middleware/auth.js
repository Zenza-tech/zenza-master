const crypto = require("node:crypto");
const { db, nowIso } = require("../db");

const SESSION_COOKIE = "zenza_session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_MS);
  db.prepare(
    "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
  ).run(token, userId, now.toISOString(), expires.toISOString());
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

function setSessionCookie(res, token, expiresAt) {
  const attrs = [
    `${SESSION_COOKIE}=${token}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Expires=${expiresAt.toUTCString()}`,
  ];
  res.setHeader("Set-Cookie", attrs.join("; "));
}

function clearSessionCookie(res) {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`
  );
}

// user + role + permission codes, given a valid session
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
      `SELECT u.id, u.full_name, u.email, u.status, u.role_id, r.name AS role
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.id = ?`
    )
    .get(session.user_id);
  if (!user || user.status !== "active") return null;

  const perms = db
    .prepare(
      `SELECT p.code FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
       WHERE rp.role_id = ?`
    )
    .all(user.role_id)
    .map((r) => r.code);

  return { ...user, permissions: perms };
}

function requireAuth(req, res, next) {
  const cookies = parseCookies(req);
  const user = getUserFromToken(cookies[SESSION_COOKIE]);
  if (!user) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }
  req.user = user;
  req.sessionToken = cookies[SESSION_COOKIE];
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
};
