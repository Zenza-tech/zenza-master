const fs = require("node:fs");

/**
 * Summarizes an uploaded watchlist attachment into ~2 lines of key
 * findings, using the Anthropic API. Scope, deliberately:
 *
 *  - PDF and images (png/jpg/jpeg) are sent to the model directly as
 *    base64 document/image content — no separate text-extraction library
 *    needed, since the model reads them natively.
 *  - Plain text files are summarized too (same mechanism, trivial once
 *    the API call exists, even though the original ask was specifically
 *    "read image, pdf").
 *  - DOCX is NOT summarized — extracting DOCX text would need a separate
 *    parsing library, out of scope for "read image, pdf." Attachments of
 *    this type get summary_status='skipped', not an error.
 *
 * This is a best-effort enhancement, never a blocker: any failure here
 * (missing API key, network error, API error) must never prevent the
 * underlying file upload from succeeding. Callers should treat a thrown
 * error from summarize() as "no summary available," not as an upload
 * failure.
 */

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001"; // fast, inexpensive — appropriate for a short summary task
const MAX_SUMMARY_INPUT_BYTES = 15 * 1024 * 1024; // stay well under the API's request size limit once base64-inflated

const SUMMARIZABLE_MIME = {
  "application/pdf": "document",
  "image/png": "image",
  "image/jpeg": "image",
  "text/plain": "text",
};

const SUMMARY_PROMPT =
  "You are assisting a fraud analyst reviewing evidence attached to a watchlist request. " +
  "Summarize this document in EXACTLY two short lines (each under 20 words). " +
  "Focus only on findings relevant to assessing fraud or risk — names, amounts, dates, patterns, or red flags. " +
  "If nothing relevant is found, say so in one line. Do not add commentary, headers, or bullet points — just the two lines.";

function summaryStatusFor(mimeType) {
  if (!SUMMARIZABLE_MIME[mimeType]) return "skipped";
  return "pending";
}

async function summarizeFile(filePath, mimeType) {
  const kind = SUMMARIZABLE_MIME[mimeType];
  if (!kind) {
    return { status: "skipped", summary: null, reason: `AI summary not supported for ${mimeType}` };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { status: "skipped", summary: null, reason: "ANTHROPIC_API_KEY is not configured" };
  }

  const stat = fs.statSync(filePath);
  if (stat.size > MAX_SUMMARY_INPUT_BYTES) {
    return { status: "skipped", summary: null, reason: "File too large for automatic summarization" };
  }

  let content;
  if (kind === "text") {
    const text = fs.readFileSync(filePath, "utf8").slice(0, 20000); // guard against pathological huge text files
    content = [{ type: "text", text: `${SUMMARY_PROMPT}\n\n---\n${text}\n---` }];
  } else {
    const base64 = fs.readFileSync(filePath).toString("base64");
    const block =
      kind === "document"
        ? { type: "document", source: { type: "base64", media_type: mimeType, data: base64 } }
        : { type: "image", source: { type: "base64", media_type: mimeType, data: base64 } };
    content = [block, { type: "text", text: SUMMARY_PROMPT }];
  }

  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 300,
        messages: [{ role: "user", content }],
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      return { status: "failed", summary: null, reason: `Anthropic API returned ${res.status}: ${errBody.slice(0, 200)}` };
    }

    const data = await res.json();
    const textBlock = (data.content || []).find((b) => b.type === "text");
    const summary = textBlock?.text?.trim() || null;
    if (!summary) return { status: "failed", summary: null, reason: "No text returned by the model" };

    return { status: "done", summary, reason: null };
  } catch (err) {
    return { status: "failed", summary: null, reason: `Request failed: ${err.message}` };
  }
}

module.exports = { summarizeFile, summaryStatusFor, SUMMARIZABLE_MIME };
