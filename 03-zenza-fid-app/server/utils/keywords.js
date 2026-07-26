/**
 * Lightweight keyword extraction — no external NLP dependency needed for
 * what this does: tokenize, drop stopwords and short/numeric-only tokens,
 * dedupe, cap at a reasonable count. Good enough to power both the visible
 * "keywords" field on entities/watchlist entries and to seed the search
 * index's content alongside the raw text.
 */

const STOPWORDS = new Set([
  "the","a","an","and","or","but","if","then","of","to","in","on","at","by","for",
  "with","about","against","between","into","through","during","before","after",
  "above","below","from","up","down","is","are","was","were","be","been","being",
  "have","has","had","having","do","does","did","doing","this","that","these","those",
  "it","its","as","not","no","so","than","too","very","can","will","just","also",
  "he","she","they","them","his","her","their","we","our","you","your","i","me","my",
  "which","who","whom","what","when","where","why","how","all","each","few","more",
  "most","other","some","such","only","own","same","because","while","there",
]);

function extractKeywords(text, maxKeywords = 15) {
  if (!text) return [];
  const tokens = String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !/^\d+$/.test(t));

  const seen = new Set();
  const result = [];
  for (const t of tokens) {
    if (!seen.has(t)) {
      seen.add(t);
      result.push(t);
    }
    if (result.length >= maxKeywords) break;
  }
  return result;
}

module.exports = { extractKeywords };
