// Minimal .env loader — no dotenv dependency needed for something this
// small. Silently does nothing if .env doesn't exist (e.g. in production,
// where real environment variables are set by the hosting platform
// instead). Never overwrites a variable already set in the environment,
// so real deployment config always wins over a stray .env file.
(function loadEnvFile() {
  const fs = require("node:fs");
  const path = require("node:path");
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
})();

const express = require("express");
const path = require("node:path");
const { seededAdminNotice, listOrganizations, listActiveOrganizations } = require("./platformDb");
const { getTenantDb } = require("./tenantDb");
const { runAllActiveRules } = require("./services/ruleEngine");

const authRoutes = require("./routes/auth");
const entityRoutes = require("./routes/entities");
const watchlistRoutes = require("./routes/watchlist");
const auditRoutes = require("./routes/audit");
const userRoutes = require("./routes/users");
const ruleRoutes = require("./routes/rules");
const alertRoutes = require("./routes/alerts");
const searchRoutes = require("./routes/search");
const suggestionRoutes = require("./routes/suggestions");
const networkRoutes = require("./routes/network");
const platformRoutes = require("./routes/platform");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json({ limit: "2mb" }));

// Basic security headers on every response. Hand-written rather than a
// dependency (e.g. helmet) to keep this app's zero-extra-dependency
// philosophy — these are the handful that matter most for an app like
// this one, not an exhaustive hardening pass.
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff"); // stop browsers guessing content-types
  res.setHeader("X-Frame-Options", "DENY"); // this app should never be framed by another site
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src 'self' https://fonts.gstatic.com; " +
      "img-src 'self' data:; " +
      "script-src 'self'; " +
      "connect-src 'self'"
  );
  next();
});

// static frontend (zero build step — plain HTML/CSS/JS)
app.use(express.static(path.join(__dirname, "..", "public")));

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/entities", entityRoutes);
app.use("/api/watchlist", watchlistRoutes);
app.use("/api/audit", auditRoutes);
app.use("/api/users", userRoutes);
app.use("/api/rules", ruleRoutes);
app.use("/api/alerts", alertRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/suggestions", suggestionRoutes);
app.use("/api/network", networkRoutes);
app.use("/api/platform", platformRoutes);

app.get("/api/health", (req, res) => res.json({ ok: true, service: "zenza-fid", time: new Date().toISOString() }));

// fall back to the console shell for any unmatched non-API route (simple client-side routing support)
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "console.html"));
});

// central error handler — never leak stack traces to the client
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ ok: false, error: "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`\nZenza FID running at http://localhost:${PORT}`);
  if (seededAdminNotice) console.log(seededAdminNotice);
  const orgCount = listOrganizations().length;
  console.log(`Organizations: ${orgCount} (platform db: data/platform.db, tenant data: data/tenants/)\n`);
});

// Periodic rule engine — automatically re-evaluates every active rule on an
// interval, so alerts appear without a human having to click "Run Now"
// every time. Runs once per organization, since each has its own separate
// database and its own separate set of rules — see tenantDb.js. 5 minutes
// is a reasonable default for an MVP; tune via RULE_ENGINE_INTERVAL_MS if
// needed. Manual "Run Now" (via the API/UI) remains available for
// immediate testing without waiting for the tick.
const RULE_ENGINE_INTERVAL_MS = Number(process.env.RULE_ENGINE_INTERVAL_MS) || 5 * 60 * 1000;
setInterval(() => {
  // Only active organizations — a suspended or archived org should not
  // have its rules quietly running in the background.
  const organizations = listActiveOrganizations();
  organizations.forEach((org) => {
    try {
      const tenantDb = getTenantDb(org.id);
      const summary = runAllActiveRules(tenantDb);
      const created = summary.reduce((sum, r) => sum + (r.created || 0), 0);
      if (created > 0) {
        console.log(`Rule engine [${org.name}]: ${created} new alert(s) created across ${summary.length} active rule(s)`);
      }
    } catch (err) {
      console.error(`Rule engine scheduler failed for organization "${org.name}" (id ${org.id}):`, err.message);
    }
  });
}, RULE_ENGINE_INTERVAL_MS).unref();
