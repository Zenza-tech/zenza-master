const { nowIso } = require("../utils/time");

/**
 * Explicit whitelist of fields eligible for suggestion history. This is
 * the actual security boundary for this feature — identifier VALUES
 * (BVN, NIN, phone, email, account, device) are deliberately never on
 * this list. Suggesting a previously-entered BVN into a *different*
 * entity's form would be actively harmful, not helpful, so those fields
 * are excluded by design, not by oversight.
 */
const ALLOWED_FIELDS = new Set([
  "entity_full_name",
  "entity_risk_notes",
  "watchlist_category",
  "watchlist_reason",
]);

const MAX_PER_FIELD = 25; // per user, per field — oldest trimmed beyond this

function recordInput(db, userId, fieldName, value) {
  if (!ALLOWED_FIELDS.has(fieldName)) return;
  const trimmed = String(value || "").trim();
  if (!trimmed || trimmed.length < 3 || trimmed.length > 500) return;

  const now = nowIso();
  db.prepare(
    `INSERT INTO user_input_history (user_id, field_name, value, last_used_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, field_name, value) DO UPDATE SET last_used_at = excluded.last_used_at`
  ).run(userId, fieldName, trimmed, now);

  const excess = db
    .prepare(
      `SELECT id FROM user_input_history WHERE user_id = ? AND field_name = ?
       ORDER BY last_used_at DESC LIMIT -1 OFFSET ?`
    )
    .all(userId, fieldName, MAX_PER_FIELD);
  if (excess.length > 0) {
    const ids = excess.map((r) => r.id);
    db.prepare(`DELETE FROM user_input_history WHERE id IN (${ids.map(() => "?").join(",")})`).run(...ids);
  }
}

function getSuggestions(db, userId, fieldName, prefix = "", limit = 8) {
  if (!ALLOWED_FIELDS.has(fieldName)) return [];
  const rows = prefix
    ? db
        .prepare(
          `SELECT value FROM user_input_history WHERE user_id = ? AND field_name = ? AND value LIKE ?
           ORDER BY last_used_at DESC LIMIT ?`
        )
        .all(userId, fieldName, `${prefix}%`, limit)
    : db
        .prepare(
          `SELECT value FROM user_input_history WHERE user_id = ? AND field_name = ?
           ORDER BY last_used_at DESC LIMIT ?`
        )
        .all(userId, fieldName, limit);
  return rows.map((r) => r.value);
}

module.exports = { ALLOWED_FIELDS, recordInput, getSuggestions };
