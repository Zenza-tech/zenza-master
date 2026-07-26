# Engineering Guide

For engineers picking this up from GitHub. Covers how the codebase is
organized, the patterns to follow when extending it, and — specifically —
how to build the core-banking API integration layer, since that's the
most-requested next piece and doesn't exist yet.

---

## Before you start

```bash
node setup.js        # installs dependencies for both apps
```

Run `QA-TESTING-REPORT.md` alongside this — it documents exactly what's
been tested, what hasn't, and every known limitation. Read that before
assuming a piece of functionality is more (or less) battle-tested than it
is.

## Multi-tenancy — read this before touching anything

This deployment serves multiple customer organizations. **Each
organization's fraud data lives in its own SQLite file.** There is no
shared `entities` table with an `org_id` column, and that is deliberate:
a shared table means isolation depends on every developer, on every
route, forever, remembering a `WHERE org_id = ?` clause. One miss leaks
one bank's fraud intelligence to another. Separate files make that
mistake structurally impossible.

**What this means for you in practice:**

- `req.tenantDb` is attached by `requireAuth` on every authenticated
  request. **Always use it.** Never import a database singleton into a
  route — there isn't a global one, and reintroducing one would undo the
  isolation guarantee.
- The shared `platformDb` holds only organizations, users, roles,
  sessions, network signals and the platform audit log. Queries against
  *it* for user data **do** need explicit `org_id` scoping — see
  `routes/users.js`, where the pre-multi-tenancy version had a real
  privilege-escalation bug from exactly this.
- **You cannot SQL-JOIN across the two.** SQLite can't join separate
  database files. Tenant tables store user ids as plain integers; resolve
  names in application code via the `resolveUserNames()` helper each
  route file defines. If you write `JOIN users` inside a tenant query it
  will fail at runtime, not at review.
- Adding a table? It goes in `tenantDb.js`'s schema if it holds customer
  fraud data, `platformDb.js` if it's account/billing/platform-level.
  When in doubt it belongs in the tenant.

## The network layer — the rules are not negotiable

`services/network.js` is the only place data crosses an organization
boundary. Before changing it, read its header comment in full. The
non-negotiables:

1. **Never publish raw identifiers.** Only HMAC hashes, keyed with the
   server-side pepper. Plain hashes of an 11-digit BVN are brute-forceable.
2. **Never reveal which organization reported a signal** to another
   organization. The `org_id` column exists for withdrawal and deletion
   requests, not for display.
3. **Never publish anything but approved, active watchlist entries.** A
   pending request is one person's unreviewed opinion; that's the entire
   reason maker-checker exists.
4. **Opt-in only.** Never default an organization into participation.

## The platform admin boundary

`routes/platform.js` must never return the *content* of tenant data —
only counts and metadata. The header comment in that file explains the
legal reasoning. If a request comes in for "let support see what they
flagged," that's a separate feature with consent, time-bounding and
audit requirements. Don't add it to the existing endpoints.

## The pattern every route follows

Every backend route in `03-zenza-fid-app/server/routes/` follows the same
shape. Learn one, you've learned them all:

```js
router.post("/", requirePermission("resource.action"), (req, res) => {
  // 1. Validate input — fail fast with a specific error message
  // 2. Check business rules (ownership, status, maker-checker, etc.)
  // 3. Mutate the database inside a transaction if more than one write
  // 4. writeAudit(...) — every write action logs, no exceptions
  // 5. Respond with { ok: true, ...data }
});
```

Follow this shape for new routes and they'll be consistent with
everything else — same error format, same audit coverage, same
permission-check placement.

## Adding a new permission

1. Add it to the `PERMISSIONS` array in `server/db.js`.
2. Add it to whichever `ROLE_PERMISSIONS` entries should have it.
3. Use `requirePermission("your.permission")` on the route.
4. Delete `data/zenza_fid.db` locally and restart — the schema/seed step
   is idempotent and re-creates roles/permissions on every boot, but a
   *new* permission added to an *existing* database needs the seed to
   re-run against a fresh file. (Don't do this in production — see the
   note in `db.js` about idempotent seeding vs. schema migrations.)

## Adding a new rule type to the Rule Trigger Engine

`server/services/ruleEngine.js` is deliberately structured so a new rule
type is a self-contained addition:

1. Add the type name to `VALID_RULE_TYPES`.
2. Add a case to `validateConfig()` describing what a valid config looks
   like for it.
3. Write an `evaluateYourType(config)` function returning
   `[{ entity_id, reason }]`.
4. Add a case to `evaluateRule()` dispatching to it.
5. Add the corresponding form fields in `public/assets/app.js`'s
   `ruleConfigFieldsHtml()` and `collectRuleConfig()`.

**Two natural next rule types, given what already exists:**
- A `keyword_match` rule checking an entity's `keywords` column
  (populated on every create/update — see `server/utils/keywords.js`)
  against a configured term list. All the data is already there.
- A `network_match` rule that flags any entity whose identifiers return a
  network hit. `services/network.js` already exposes `checkIdentifiers()`;
  this would turn a manual lookup into an automatic one.

Note that a rule evaluator receives the tenant database as its first
argument (`evaluateYourType(db, config)`) — there is no global database
to reach for.

---

## Building the core-banking API integration layer

This is the one major Phase 2 piece that doesn't exist yet, and it's
explicitly *not* something to build against a guess — the right shape of
this depends heavily on which bank's core banking system you're
integrating with first (different vendors, different auth models,
different data formats). What follows is the extension point and the
pattern to build it against, not a finished implementation.

### The shape to build

Follow the same connector-interface pattern that keeps the AI
summarization feature swappable (`server/services/summarize.js` is a good
reference — it isolates "call an external thing" behind a small, testable
function that the route layer doesn't need to know the details of).

```
server/services/coreBanking/
  index.js              Picks a connector based on config, exposes one interface
  connector.interface.js  Documents the shape every connector must implement (see below)
  mockConnector.js         A fake connector for local dev/testing without a real bank
  <bankName>Connector.js     One file per real integration, added as pilots come online
```

**The interface every connector should implement**, at minimum:

```js
// Every method returns a Promise. Every method should throw a clear
// error (not swallow failures) — let the route layer decide how to
// handle a connector failure, the same way summarize.js does.
{
  // Look up whether a given identifier (BVN/NIN/account number) exists
  // in the bank's system, and any basic risk-relevant metadata they
  // expose (never full PII — see the BRD's privacy-preserving matching
  // principle, Section 8.3.1, if you have it).
  async lookupIdentifier(type, value) { ... },

  // Push a containment/quarantine flag to the bank's system, respecting
  // the same 72-hour/court-order limits as the rest of this system (see
  // BR-16 in the BRD) — this should NEVER be a silent autonomous action.
  async pushContainmentFlag(entityId, flag) { ... },

  // Health check — used to show connection status in the console.
  async ping() { ... },
}
```

### Why a mock connector matters, not just a nice-to-have

Build `mockConnector.js` first, before any real bank is involved. It lets
the rest of the team (frontend, QA, other backend routes) build and test
against a stable, fast, offline interface while the real integration work
— which depends on a pilot partner's actual API, sandbox access, and
security review — proceeds in parallel and on its own timeline. This is
the same reason `summarize.js` degrades gracefully without an API key:
the rest of the system shouldn't be blocked on external dependencies it
doesn't fully control.

### Where this plugs in

- A new `server/routes/integrations.js` for admin-facing connector
  status/config (which connector is active, last successful ping, etc.)
- The watchlist "escalate" and containment flows are the natural places
  to eventually call `pushContainmentFlag()` — but **do not wire this up
  until the containment/compliance framework from the BRD (72-hour limits,
  court-order handling, immutable audit trail) has its own dedicated
  build**, the same way the credit-investment bridge in ZenVest was
  deliberately sequenced last. Pushing a flag to a real bank's system is a
  much bigger deal than anything currently in this codebase and deserves
  the same care.

---

## Code quality expectations, made explicit

- **No inline `<script>` blocks in `public/` HTML.** The CSP blocks them
  by design (see `server/index.js`) — put JS in `public/assets/`.
- **All SQL through prepared statements**, never string-concatenated
  values. Every existing route does this; a PR introducing string-built
  SQL should be treated as a bug, not a style preference.
- **Every user-controllable value rendered to the DOM goes through
  `esc()`** in `app.js`. Same severity as the SQL rule.
- **Every write action calls `writeAudit()`.** If you're adding a route
  that changes data and it doesn't show up in the audit log, that's
  incomplete, not optional.
- **Run the regression checks in `QA-TESTING-REPORT.md`'s Section 2
  manually after any change touching auth, RBAC, or the maker-checker
  flow**, until an automated test suite exists to do this for you (see
  Known Limitations — this is the single highest-value piece of
  infrastructure work not yet done, and genuinely worth prioritizing
  before this handles real production data at scale).

## Where things are genuinely incomplete (be honest with stakeholders about this)

- No automated tests. Every "tested" claim in the QA report reflects
  manual testing performed once, not a regression suite that runs on
  every future commit.
- No CI pipeline. Consider GitHub Actions running `node -c` syntax
  checks and (once they exist) automated tests on every PR.
- No dependency vulnerability scanning. `npm audit` and/or Dependabot are
  both easy to turn on once this is on GitHub.
- Rate limiting and the rule engine scheduler are both in-memory,
  single-instance. Fine today; revisit if this ever runs as more than one
  server process.
