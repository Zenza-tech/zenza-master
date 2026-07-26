const crypto = require("node:crypto");

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

module.exports = { hashPassword };
