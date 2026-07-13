/**
 * Zenza FID — local site server + lightweight database
 * ------------------------------------------------------
 * Serves the three static pages (welcome, investors, careers) and an
 * /admin.html view, and stores every form submission from those pages
 * into a local JSON file at data/submissions.json.
 *
 * Zero dependencies — just Node.js. Run with:
 *   node server.js
 * or
 *   npm start
 *
 * Then visit:
 *   http://localhost:3000/welcome.html
 *   http://localhost:3000/investors.html
 *   http://localhost:3000/careers.html
 *   http://localhost:3000/admin.html      <- view everything that's been submitted
 *
 * See README.md for how to scale this to a real database and host it live.
 */

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DB_FILE = path.join(DATA_DIR, "submissions.json");
const PORT = process.env.PORT || 3000;

// ---- tiny JSON-file "database" -------------------------------------------
// Swap these two functions for a real database client (SQLite/Postgres/etc.)
// when you're ready to scale — nothing else in this file needs to change,
// because everything else only talks to readDB()/writeDB(). See README.md.

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, "[]\n");

function readDB() {
  try {
    const raw = fs.readFileSync(DB_FILE, "utf8");
    return raw.trim() ? JSON.parse(raw) : [];
  } catch (err) {
    console.error("Failed to read database, starting fresh:", err.message);
    return [];
  }
}

function writeDB(rows) {
  // Write to a temp file then rename — avoids a half-written file if the
  // process is killed mid-write.
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2) + "\n");
  fs.renameSync(tmp, DB_FILE);
}

// ---- static file serving ---------------------------------------------------

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function serveStatic(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

// ---- request handler ---------------------------------------------------

const server = http.createServer((req, res) => {
  // Permissive CORS for local development. Tighten this before going live —
  // see the "Before You Host This Live" section in README.md.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  // -- API: save a submission from any of the three pages --
  if (url.pathname === "/api/submissions" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      let payload;
      try {
        payload = body ? JSON.parse(body) : {};
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Invalid JSON body" }));
        return;
      }
      const rows = readDB();
      const entry = {
        id: crypto.randomUUID(),
        receivedAt: new Date().toISOString(),
        page: payload.page || "unknown",
        formType: payload.formType || "general",
        ...payload,
      };
      rows.push(entry);
      writeDB(rows);
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, id: entry.id }));
    });
    return;
  }

  // -- API: list all submissions (used by admin.html) --
  if (url.pathname === "/api/submissions" && req.method === "GET") {
    const rows = readDB().sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(rows));
    return;
  }

  // -- API: basic counts, handy for a future dashboard --
  if (url.pathname === "/api/stats" && req.method === "GET") {
    const rows = readDB();
    const byPage = {};
    const byType = {};
    rows.forEach((r) => {
      byPage[r.page] = (byPage[r.page] || 0) + 1;
      byType[r.formType] = (byType[r.formType] || 0) + 1;
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ total: rows.length, byPage, byType }));
    return;
  }

  // -- static files --
  let reqPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.join(ROOT, reqPath);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }
    serveStatic(res, filePath);
  });
});

server.listen(PORT, () => {
  console.log(`\nZenza Technology site running:`);
  console.log(`  Home                → http://localhost:${PORT}/  (or /index.html)`);
  console.log(`  ZenzaTech Careers   → http://localhost:${PORT}/careers.html`);
  console.log(`  Zenza FID — About   → http://localhost:${PORT}/fid-welcome.html`);
  console.log(`  Zenza FID — Invest  → http://localhost:${PORT}/fid-investors.html`);
  console.log(`  Zenza FID — Careers → http://localhost:${PORT}/fid-careers.html`);
  console.log(`  ZenVest — About     → http://localhost:${PORT}/zenvest-welcome.html`);
  console.log(`  ZenVest — Invest    → http://localhost:${PORT}/zenvest-investors.html`);
  console.log(`  ZenVest — Careers   → http://localhost:${PORT}/zenvest-careers.html`);
  console.log(`  Admin view          → http://localhost:${PORT}/admin.html`);
  console.log(`\nAll form submissions are saved to data/submissions.json\n`);
});
