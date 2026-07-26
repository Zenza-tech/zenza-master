const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { ALLOWED_FIELDS, getSuggestions } = require("../services/inputHistory");

const router = express.Router();
router.use(requireAuth);

router.get("/:field", (req, res) => {
  const { field } = req.params;
  if (!ALLOWED_FIELDS.has(field)) {
    return res.status(400).json({ ok: false, error: `Suggestions are not available for field: ${field}` });
  }
  const suggestions = getSuggestions(req.tenantDb, req.user.id, field, req.query.q || "");
  res.json({ ok: true, field, suggestions });
});

module.exports = router;
