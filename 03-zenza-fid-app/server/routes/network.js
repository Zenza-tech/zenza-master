const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { writeAudit, clientIp } = require("../middleware/audit");
const { isParticipating, checkIdentifiers } = require("../services/network");

const router = express.Router();
router.use(requireAuth);

// ---- is my organization part of the network? ----
router.get("/status", (req, res) => {
  res.json({
    ok: true,
    participating: isParticipating(req.user.org_id),
    organization: req.user.org_name,
  });
});

/**
 * Checks one of MY entities against the network.
 *
 * Reads the identifiers from my own tenant database (so an analyst can't
 * use this endpoint to probe arbitrary identifiers they haven't already
 * legitimately recorded — that would turn a corroboration tool into a
 * lookup oracle against other institutions' data).
 */
router.get("/check/:entityId", requirePermission("entities.view"), (req, res) => {
  const db = req.tenantDb;
  const entity = db.prepare("SELECT id, full_name FROM entities WHERE id = ?").get(req.params.entityId);
  if (!entity) return res.status(404).json({ ok: false, error: "Entity not found" });

  const identifiers = db
    .prepare("SELECT identifier_type, identifier_value FROM entity_identifiers WHERE entity_id = ?")
    .all(entity.id);

  const result = checkIdentifiers(req.user.org_id, identifiers);

  // Log the lookup. A query against other institutions' intelligence is
  // exactly the kind of action that should be auditable after the fact.
  writeAudit(db, {
    actorId: req.user.id,
    action: "network.check",
    resourceType: "entity",
    resourceId: entity.id,
    details: { identifiers_checked: identifiers.length, matches_found: result.matches.length },
    ipAddress: clientIp(req),
  });

  res.json({ ok: true, entity_id: entity.id, ...result });
});

module.exports = router;
