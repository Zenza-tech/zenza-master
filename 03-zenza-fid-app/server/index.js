const express = require("express");
const path = require("node:path");
const { seededAdminNotice } = require("./db");

const authRoutes = require("./routes/auth");
const entityRoutes = require("./routes/entities");
const watchlistRoutes = require("./routes/watchlist");
const auditRoutes = require("./routes/audit");
const userRoutes = require("./routes/users");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json({ limit: "2mb" }));

// static frontend (zero build step — plain HTML/CSS/JS)
app.use(express.static(path.join(__dirname, "..", "public")));

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/entities", entityRoutes);
app.use("/api/watchlist", watchlistRoutes);
app.use("/api/audit", auditRoutes);
app.use("/api/users", userRoutes);

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
  console.log(`Database: data/zenza_fid.db\n`);
});
