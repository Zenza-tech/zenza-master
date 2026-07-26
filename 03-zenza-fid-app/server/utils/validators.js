/**
 * Identifier format validation — one place, used by both the create and
 * update paths in entities.js, so the rules can't drift between them.
 *
 * Deliberately not overly strict on formats that genuinely vary (PHONE,
 * ACCOUNT) — the goal is to catch obvious junk ("banana" as a BVN), not to
 * become a full national-ID-format authority that breaks on edge cases.
 */

const PATTERNS = {
  BVN: {
    regex: /^\d{11}$/,
    message: "BVN must be exactly 11 digits",
  },
  NIN: {
    regex: /^\d{11}$/,
    message: "NIN must be exactly 11 digits",
  },
  EMAIL: {
    regex: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    message: "Not a valid email address",
  },
  PHONE: {
    regex: /^(\+234|234|0)[7-9][0-1]\d{8}$/,
    message: "Not a valid Nigerian phone number (e.g. 08012345678 or +2348012345678)",
  },
  ACCOUNT: {
    regex: /^\d{10}$/,
    message: "Account number must be exactly 10 digits (NUBAN format)",
  },
  DEVICE: {
    regex: /^[A-Za-z0-9\-_:]{6,128}$/,
    message: "Device identifier must be 6-128 characters (letters, numbers, -, _, :)",
  },
};

/** Returns null if valid, or a human-readable error string if not. */
function validateIdentifier(type, value) {
  const spec = PATTERNS[type];
  if (!spec) return `Unknown identifier type: ${type}`;
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "Identifier value cannot be empty";
  if (!spec.regex.test(trimmed)) return `${type}: ${spec.message}`;
  return null;
}

/** Validates a whole array of {type, value} identifiers; returns the first error found, or null. */
function validateIdentifiers(identifiers) {
  for (const id of identifiers || []) {
    const err = validateIdentifier(id.type, id.value);
    if (err) return err;
  }
  return null;
}

module.exports = { PATTERNS, validateIdentifier, validateIdentifiers };
