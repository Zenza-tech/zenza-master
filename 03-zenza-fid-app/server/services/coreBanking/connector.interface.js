/**
 * Core Banking Connector Interface
 * -----------------------------------
 * This file documents the contract every connector must satisfy — it's
 * not enforced by the language (plain JS, no TypeScript in this codebase),
 * so treat this as the spec to test a new connector against, not a type
 * checker that will catch a mismatch for you.
 *
 * See ENGINEERING.md ("Building the core-banking API integration layer")
 * for the full context on why this exists and how it should be wired in
 * — deliberately not yet connected to any route. Building the connector
 * layer and building the containment/compliance framework that should
 * gate its most sensitive method are two separate pieces of work.
 */

class CoreBankingConnectorInterface {
  /**
   * Look up whether an identifier (BVN, NIN, account number, etc.)
   * exists in the bank's system.
   *
   * @param {string} type - one of BVN, NIN, PHONE, ACCOUNT, DEVICE (matches
   *   the identifier types already used in server/utils/validators.js)
   * @param {string} value
   * @returns {Promise<{ exists: boolean, riskFlags?: string[] }>}
   *   Deliberately minimal — never return full customer PII across this
   *   boundary. See the BRD's privacy-preserving matching principle
   *   (hashed lookups, boolean + risk metadata only, never raw records).
   */
  async lookupIdentifier(type, value) {
    throw new Error("Not implemented — see connector.interface.js");
  }

  /**
   * Push a containment/quarantine flag to the bank's system.
   *
   * DO NOT call this from any route until the containment/compliance
   * framework (72-hour limit, court-order override, immutable audit
   * trail — see the BRD) has its own dedicated build. This method
   * existing here is documentation of the eventual shape, not
   * permission to wire it up early.
   *
   * @param {number} entityId
   * @param {{ severity: string, reason: string, expiresAt: string }} flag
   * @returns {Promise<{ success: boolean, referenceId?: string }>}
   */
  async pushContainmentFlag(entityId, flag) {
    throw new Error("Not implemented — see connector.interface.js");
  }

  /**
   * Health check — used to show connection status in the console.
   * @returns {Promise<{ ok: boolean, latencyMs?: number, message?: string }>}
   */
  async ping() {
    throw new Error("Not implemented — see connector.interface.js");
  }
}

module.exports = { CoreBankingConnectorInterface };
