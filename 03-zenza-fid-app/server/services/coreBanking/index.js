const { MockCoreBankingConnector } = require("./mockConnector");

/**
 * Connector factory. Defaults to the mock connector — this module is not
 * imported by any route yet (see ENGINEERING.md), so nothing in the app
 * currently depends on a real bank connection. When a real connector is
 * built (e.g. `firstBankConnector.js`), register it here:
 *
 *   const { FirstBankConnector } = require("./firstBankConnector");
 *   if (process.env.CORE_BANKING_CONNECTOR === "firstbank") {
 *     return new FirstBankConnector({ apiKey: process.env.FIRSTBANK_API_KEY });
 *   }
 *
 * Kept as a single switch point so the rest of the app only ever depends
 * on the interface, never on a specific bank's implementation details.
 */
function getConnector() {
  const which = process.env.CORE_BANKING_CONNECTOR || "mock";

  switch (which) {
    case "mock":
      return new MockCoreBankingConnector();
    default:
      console.warn(`Unknown CORE_BANKING_CONNECTOR "${which}" — falling back to mock connector`);
      return new MockCoreBankingConnector();
  }
}

module.exports = { getConnector };
