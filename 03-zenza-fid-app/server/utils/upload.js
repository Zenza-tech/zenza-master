const multer = require("multer");
const path = require("node:path");
const crypto = require("node:crypto");
const fs = require("node:fs");

/**
 * File upload configuration for watchlist supporting evidence.
 *
 * Tenant isolation: each organization's uploaded files land in their own
 * folder (data/tenants/org_<id>/attachments/), not a shared directory.
 * The destination is resolved per-request from req.user.org_id, which is
 * already attached by requireAuth by the time this middleware runs (every
 * route that accepts uploads is behind requireAuth + requirePermission
 * first). This mirrors the same per-tenant separation as the databases
 * themselves — the database row correctly scoped the *lookup* even
 * before this change, but the *file on disk* sitting in a shared folder
 * was unnecessary risk for no benefit, so it's fixed here too.
 *
 * Other safety choices, unchanged from before:
 *  - Files are stored under a random UUID-based name on disk, never the
 *    original filename — avoids path traversal and filename collisions.
 *    The original filename is kept only as metadata in the database, for
 *    display and download purposes.
 *  - Whitelist is enforced on BOTH extension and MIME type. Neither is
 *    fully trustworthy on its own (both can be spoofed by a determined
 *    user), but this is an authenticated internal tool used by
 *    permissioned staff, not a public upload form — the goal is to catch
 *    accidental/careless uploads, not to be an airtight content-security
 *    boundary. See README for the honest tradeoff this represents.
 */

const TENANTS_DIR = path.join(__dirname, "..", "..", "data", "tenants");

function tenantAttachmentsDir(orgId) {
  const dir = path.join(TENANTS_DIR, `org_${orgId}`, "attachments");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const ALLOWED_TYPES = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!req.user || !req.user.org_id) {
      return cb(new Error("Upload attempted without a resolved organization — this should never happen post-auth"));
    }
    cb(null, tenantAttachmentsDir(req.user.org_id));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_TYPES[ext]) {
    return cb(new Error(`File type not allowed: ${ext || "(no extension)"}. Allowed: ${Object.keys(ALLOWED_TYPES).join(", ")}`));
  }
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per file
    files: 5, // max files per upload call
  },
});

module.exports = { upload, tenantAttachmentsDir, ALLOWED_TYPES };
