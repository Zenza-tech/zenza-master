const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { searchAll } = require("../services/search");

const router = express.Router();
router.use(requireAuth);

router.get("/", (req, res) => {
  const { q } = req.query;
  if (!q || !q.trim()) {
    return res.json({ ok: true, query: "", entities: [], watchlist: [] });
  }
  const results = searchAll(req.tenantDb, q, req.user.permissions);
  res.json({ ok: true, query: q, ...results });
});

module.exports = router;
