/**
 * Minimal in-memory rate limiter, scoped to login attempts.
 *
 * Keyed by IP address. Not distributed — fine for a single-instance MVP,
 * but if you ever run more than one server process behind a load balancer,
 * move this to a shared store (Redis) so limits apply across all of them.
 * See README.md "Scaling this beyond the MVP".
 */

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 8; // per IP, per window

const attempts = new Map(); // ip -> { count, windowStart }

function loginRateLimit(req, res, next) {
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").toString();
  const now = Date.now();
  const record = attempts.get(ip);

  if (!record || now - record.windowStart > WINDOW_MS) {
    attempts.set(ip, { count: 1, windowStart: now });
    return next();
  }

  if (record.count >= MAX_ATTEMPTS) {
    const retryAfterSec = Math.ceil((WINDOW_MS - (now - record.windowStart)) / 1000);
    res.setHeader("Retry-After", retryAfterSec);
    return res.status(429).json({
      ok: false,
      error: `Too many login attempts. Try again in ${Math.ceil(retryAfterSec / 60)} minute(s).`,
    });
  }

  record.count += 1;
  next();
}

// periodic cleanup so the map doesn't grow forever on a long-running process
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of attempts) {
    if (now - record.windowStart > WINDOW_MS) attempts.delete(ip);
  }
}, WINDOW_MS).unref();

module.exports = { loginRateLimit };
