const { db, nowIso } = require("../db");

/**
 * Every write action in the system should call this. It's insert-only —
 * there is deliberately no update/delete exposed anywhere for audit_log,
 * because an editable audit trail isn't an audit trail (BRD BR-07, BR-19).
 */
function writeAudit({ actorId, action, resourceType = null, resourceId = null, details = null, ipAddress = null }) {
  db.prepare(
    `INSERT INTO audit_log (actor_id, action, resource_type, resource_id, details, ip_address, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    actorId,
    action,
    resourceType,
    resourceId,
    details ? JSON.stringify(details) : null,
    ipAddress,
    nowIso()
  );
}

function clientIp(req) {
  return (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").toString();
}

module.exports = { writeAudit, clientIp };
