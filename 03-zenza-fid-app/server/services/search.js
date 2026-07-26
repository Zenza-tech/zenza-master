const { extractKeywords } = require("../utils/keywords");

/**
 * Every function here takes the tenant database as its first argument
 * now, rather than importing a shared global — there is no longer a
 * single global database to import. The caller (a route, which got its
 * tenant db from req.tenantDb) is always the one deciding which
 * organization's data this touches.
 */

function indexEntity(db, entity) {
  const keywords = extractKeywords(`${entity.full_name} ${entity.risk_notes || ""}`);
  db.prepare("UPDATE entities SET keywords = ? WHERE id = ?").run(keywords.join(" "), entity.id);

  const identifierValues = db
    .prepare("SELECT identifier_value FROM entity_identifiers WHERE entity_id = ?")
    .all(entity.id)
    .map((r) => r.identifier_value)
    .join(" ");

  const content = [entity.full_name, entity.risk_notes || "", keywords.join(" "), identifierValues].join(" ");
  db.prepare("DELETE FROM search_index WHERE resource_type = 'entity' AND resource_id = ?").run(entity.id);
  db.prepare("INSERT INTO search_index (resource_type, resource_id, title, content) VALUES ('entity', ?, ?, ?)").run(
    entity.id, entity.full_name, content
  );
}

function indexWatchlistEntry(db, entry) {
  const keywords = extractKeywords(`${entry.category} ${entry.reason}`);
  db.prepare("UPDATE watchlist_entries SET keywords = ? WHERE id = ?").run(keywords.join(" "), entry.id);

  const attachmentSummaries = db
    .prepare("SELECT ai_summary FROM watchlist_attachments WHERE watchlist_id = ? AND ai_summary IS NOT NULL")
    .all(entry.id)
    .map((r) => r.ai_summary)
    .join(" ");

  const content = [entry.category, entry.reason, keywords.join(" "), attachmentSummaries].join(" ");
  db.prepare("DELETE FROM search_index WHERE resource_type = 'watchlist' AND resource_id = ?").run(entry.id);
  db.prepare("INSERT INTO search_index (resource_type, resource_id, title, content) VALUES ('watchlist', ?, ?, ?)").run(
    entry.id, entry.category, content
  );
}

function buildSafeMatchQuery(raw) {
  const tokens = String(raw).trim().split(/\s+/).filter(Boolean).slice(0, 8);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t.replace(/"/g, "")}"*`).join(" AND ");
}

function searchAll(db, rawQuery, userPermissions, limit = 20) {
  const matchQuery = buildSafeMatchQuery(rawQuery);
  if (!matchQuery) return { entities: [], watchlist: [] };

  const allowedTypes = [];
  if (userPermissions.includes("entities.view")) allowedTypes.push("entity");
  if (userPermissions.includes("watchlist.view")) allowedTypes.push("watchlist");
  if (allowedTypes.length === 0) return { entities: [], watchlist: [] };

  const placeholders = allowedTypes.map(() => "?").join(",");
  const hits = db
    .prepare(
      `SELECT resource_type, resource_id, title FROM search_index
       WHERE search_index MATCH ? AND resource_type IN (${placeholders})
       ORDER BY rank LIMIT ?`
    )
    .all(matchQuery, ...allowedTypes, limit);

  const entityIds = hits.filter((h) => h.resource_type === "entity").map((h) => h.resource_id);
  const watchlistIds = hits.filter((h) => h.resource_type === "watchlist").map((h) => h.resource_id);

  const entities = entityIds.length
    ? db
        .prepare(
          `SELECT id, full_name, entity_type, status, keywords FROM entities WHERE id IN (${entityIds.map(() => "?").join(",")})`
        )
        .all(...entityIds)
    : [];

  const watchlist = watchlistIds.length
    ? db
        .prepare(
          `SELECT w.id, w.category, w.severity, w.status, w.keywords, e.full_name AS entity_name, e.id AS entity_id
           FROM watchlist_entries w JOIN entities e ON e.id = w.entity_id
           WHERE w.id IN (${watchlistIds.map(() => "?").join(",")})`
        )
        .all(...watchlistIds)
    : [];

  return { entities, watchlist };
}

module.exports = { indexEntity, indexWatchlistEntry, searchAll, buildSafeMatchQuery };
