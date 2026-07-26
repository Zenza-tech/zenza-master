const { CoreBankingConnectorInterface } = require("./connector.interface");

/**
 * A working, in-memory fake — implements the full connector interface
 * with deterministic, fast, offline behavior. This is what the rest of
 * the app should be built and tested against while a real bank
 * integration is still in progress; see ENGINEERING.md for why that
 * matters (parallel workstreams, not blocked on external access/security
 * review timelines).
 *
 * Seeded with a couple of known values so lookupIdentifier() has
 * something deterministic to return during development/demos.
 */
class MockCoreBankingConnector extends CoreBankingConnectorInterface {
  constructor() {
    super();
    this._known = new Map([
      ["BVN:22212345678", { exists: true, riskFlags: ["previously_reported"] }],
      ["ACCOUNT:0123456789", { exists: true, riskFlags: [] }],
    ]);
    this._pushedFlags = []; // in-memory log, useful for asserting behavior in tests
  }

  async lookupIdentifier(type, value) {
    await this._simulateLatency();
    const key = `${type}:${value}`;
    return this._known.get(key) || { exists: false, riskFlags: [] };
  }

  async pushContainmentFlag(entityId, flag) {
    await this._simulateLatency();
    const referenceId = `MOCK-${Date.now()}-${entityId}`;
    this._pushedFlags.push({ entityId, flag, referenceId, at: new Date().toISOString() });
    return { success: true, referenceId };
  }

  async ping() {
    return { ok: true, latencyMs: 5, message: "Mock connector — no real bank connection" };
  }

  async _simulateLatency() {
    return new Promise((resolve) => setTimeout(resolve, 5));
  }
}

module.exports = { MockCoreBankingConnector };
