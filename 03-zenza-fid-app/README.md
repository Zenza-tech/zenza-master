# Zenza FID — Fraud Intelligence Platform (Phase 1 MVP)

This is the actual product — not the marketing site. It implements the
Phase 1 MVP scope defined in the BRD:

- **Fraud Intelligence Repository** — a governed, searchable store of
  bad-actor profiles and identifiers, with full version history.
- **Watchlist Management** — flag entities with a strict maker-checker
  approval workflow (the person who submits a flag can never be the one who
  approves it).
- **RBAC** — three roles (Admin, Fraud Manager, Analyst), each with a
  defined permission set, enforced on every API call.
- **Audit Trail** — every write action in the system is logged immutably.
  There is no API to edit or delete an audit entry, by design.

## Running it locally

Requires [Node.js](https://nodejs.org) v18 or newer.

```bash
npm install
npm start
```

Then open **http://localhost:4000** — you'll land on the sign-in page.

**First run:** the server seeds a default admin account and prints the
password to your terminal:
```
email:    admin@zenzafid.local
password: ChangeMe123!
```
Sign in and change this password immediately (Users → Change My Password).

**Optional:** copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY` to
enable AI summarization of watchlist attachments. Everything else works
identically without it.

## Onboarding a customer organization

Two ways, both equivalent:

```bash
node scripts/create-organization.js --name "Acme Bank" \
  --admin-name "Jane Doe" --admin-email jane@acmebank.com --plan growth
```

...or sign in as a platform admin and use **Organizations → Onboard
Organization** in the console. Either way you get a generated temporary
password to hand over securely; the customer's admin changes it at first
login and manages their own users from there.

Network participation is **off by default**. Turn it on only once that
customer has actually agreed to contribute to and consume from the shared
index — see `COMPLIANCE-NDPA.md` on why defaulting it on would not be a
defensible consent posture.

**Extending this codebase?** See `ENGINEERING.md` — the route pattern to
follow, how to add a new rule type, and specifically how to build the
core-banking API integration layer (the connector interface and a working
mock connector already exist at `server/services/coreBanking/`).

## What's actually implemented

| Area | What it does |
|---|---|
| **Auth** | Server-side sessions via httpOnly cookies (not localStorage/JWT-in-browser-storage) — the more secure default for this kind of app |
| **Repository** | Create/search/edit bad-actor profiles with multiple identifiers (BVN, NIN, email, phone, account, device); duplicate-identifier detection blocks accidental re-creation; every edit is snapshotted to version history |
| **Watchlist** | Submit → pending approval → approved/rejected by a *different* user with the right role; suspend/reactivate active entries; entries with an expiry date auto-expire when read |
| **RBAC** | Enforced at the API layer via permission checks on every route — the frontend also hides actions a user can't perform, but the real enforcement is server-side |
| **Audit Log** | Every create/update/approve/reject/login/logout writes an audit entry — actor, action, resource, timestamp, IP — viewable (not editable) by Admin/Fraud Manager |
| **Users** | Admin can create accounts, change roles, and enable/disable accounts (no hard delete — preserves audit integrity); every user can change their own password |
| **Rule Trigger Engine** *(Phase 2, added)* | Four rule types — threshold, velocity, pattern match, and cross-entity link — configurable via the console, with a dry-run "Simulate" mode before activating. Active rules re-run automatically every 5 minutes (configurable), plus an on-demand "Run Now." Matches create **Alerts**, not watchlist entries directly — an analyst reviews each alert and either dismisses it (with notes) or escalates it into the existing watchlist maker-checker flow, pre-filled with the rule's severity and reason |
| **Identifier format validation** *(added)* | BVN/NIN (11 digits), Nigerian phone numbers, email addresses, NUBAN account numbers, and device identifiers are all format-checked server-side (not just "not empty") — enforced on create, edit, and bulk upload alike |
| **Free-text watchlist categories** *(added)* | The four preset categories remain, plus "Other" reveals a text field for a genuinely custom category — not just a generic "other" label |
| **Watchlist evidence attachments** *(added)* | Supporting documents (PDF, DOCX, TXT, PNG, JPEG — up to 5 files, 10MB each) can be attached when submitting a watchlist request or added afterward, downloadable from the request's detail view, with every upload/download recorded in the audit log |
| **Multi-tenancy** *(added)* | One deployment serves many customer organizations. Each organization's fraud data lives in its own separate database file — isolation is architectural, not a `WHERE` clause developers must remember. Verified with adversarial cross-tenant tests |
| **Cross-institution fraud network** *(added)* | Opt-in. When an organization approves a watchlist entry, keyed hashes of that entity's identifiers are contributed to a shared index. Another participating institution checking the same identifier learns *that* a match exists, its category and severity, and how many institutions reported — never the name, the reason, the case notes, or which institution reported it |
| **Platform administration** *(added)* | A Zenza-operator console for onboarding, suspending, archiving and permanently purging customer organizations, and managing plans and network participation — showing operational metadata only, never customer case content |
| **Watchlist request recall** *(added)* | The original submitter can withdraw their own request within a 10-minute window (server-enforced, not just hidden in the UI after the fact) — a new `recalled` status, fully logged in the request's history |
| **Full-text search** *(added)* | A search bar in the console top bar queries entities and watchlist entries via SQLite FTS5 — matches on name, notes, category, reason, extracted keywords, *and* raw identifier values (so "find the entity with this BVN" works directly). Results are filtered to what the searching user's role can actually view |
| **Extracted keywords** *(added)* | Every entity and watchlist entry gets a `keywords` field, auto-derived from its descriptive text (name, notes, category, reason) on every create/update — feeds the search index today, and is available as a building block for a future rule-engine "keyword match" rule type |
| **Input suggestions** *(added)* | Non-sensitive free-text fields (entity name, risk notes, watchlist category, watchlist reason) suggest each user's own recent entries as they type — deliberately excludes identifier values (BVN/NIN/phone/email/etc.), since suggesting someone else's identifier into a new record would be actively harmful, not helpful |
| **AI attachment summarization** *(added, optional)* | PDF, image (PNG/JPEG), and text watchlist attachments get an automatic 2-line AI-generated summary of key findings, via the Anthropic API — entirely optional; uploads work identically with or without an API key configured, just with or without the summary |

## What's deliberately NOT in this MVP

Per the BRD's phased roadmap, these are later phases, not missing bugs:
- Relationship / Link Analytics (Phase 3)
- AI Risk Scoring (Phase 4)
- Cross-Bank Hashed Intelligence Network (Phase 4 / Enterprise add-on)
- Core banking / external API integrations (Phase 2)
- Containment & Compliance Controls / Auto-Pilot Mode (Phase 4)

## The Rule Trigger Engine, in detail

Four rule types, each answering a different kind of question:

| Type | Question it answers | Example |
|---|---|---|
| **Threshold** | Does this entity have an unusually high count of something? | "Entity has 3+ email addresses on file" — possible identity mixing |
| **Velocity** | Did something happen too many times, too fast? | "2+ watchlist submissions for this entity in 24 hours" |
| **Pattern** | Does an identifier match a known-bad pattern? | "Email matches `.*@tempmail\.com$`" |
| **Cross-Entity** | Does this entity secretly connect to one we already know about? | "Shares a BVN with an entity that's already actively watchlisted" — no configuration needed, it's a fixed check |

**Rules never create watchlist entries directly.** A match creates an
**Alert** — a lower-stakes, review-first object. An analyst looks at the
alert and either dismisses it (with a required reason) or escalates it,
which creates a real `pending_approval` watchlist entry pre-filled with the
rule's severity and reason — from there it goes through the exact same
maker-checker approval flow as a manually submitted watchlist request. The
rule engine is a source of *leads*, not an autonomous decision-maker — that
boundary is deliberate, consistent with the BRD's containment philosophy
elsewhere in this system.

**Simulate before you activate.** Every rule can be dry-run via "Simulate"
regardless of its status — see who it would currently match, with the
human-readable reason, before it's live and generating real alerts.

**Rules run on a timer.** Active rules automatically re-evaluate every 5
minutes (`RULE_ENGINE_INTERVAL_MS` env var to change it) via a periodic
scheduler built into `server/index.js` — no external cron job needed for
the MVP scale this runs at. Re-running a rule never creates a second alert
for an entity that already has an open, unresolved alert from that same
rule.

**A known, accepted tradeoff on Pattern rules:** they run a
fraud-manager-authored regular expression against every matching
identifier. This is an internal tool used by permissioned, trusted staff —
not a public input field — so the risk profile is different from a
public-facing regex injection. Still, a poorly written pattern (catastrophic
backtracking) could theoretically slow down a rule run. Mitigations in
place: patterns are capped at 200 characters and validated to compile at
creation time. What's **not** in place: a hard execution timeout on regex
evaluation (Node has no built-in mechanism for this). Worth adding if
Pattern rules end up being authored by a wider group than a small,
trusted fraud-management team.

## Watchlist attachments — what's protected, and one accepted tradeoff

Uploaded files are stored under a randomly generated name on disk
(`crypto.randomUUID()` + original extension) — never the filename a user
provided — which rules out path traversal and filename-collision attacks.
The original filename is kept only as metadata for display and download.
File type is whitelisted to PDF, DOCX, TXT, PNG, and JPEG, checked against
the file extension; size is capped at 10MB per file, 5 files per upload
call. Every upload and download is written to the audit log, same as every
other action in this system.

**The honest tradeoff:** extension-based type checking can be spoofed — a
renamed `.exe` with a `.pdf` extension would currently be accepted and
stored (though it would never execute, since it's only ever served back
via download, never run). This is judged an acceptable risk for an
internal tool used by authenticated, permissioned staff uploading their
own evidence — not a public upload form. If this ever needs to be
airtight (e.g. if upload access broadens beyond trusted staff), the next
step is real content-sniffing (checking the file's actual binary
signature, not just its extension) rather than trusting either the
extension or the browser-reported MIME type.

## Search & keywords, in detail

Every entity and watchlist entry is indexed into a SQLite FTS5 virtual
table on create (and, for entities, on every edit). Two things are worth
understanding about what's actually searchable:

- **The visible `keywords` field** (shown on entities and watchlist
  entries) is deliberately curated — extracted from descriptive text only
  (name, notes, category, reason), with common stopwords and short/numeric
  tokens filtered out. This is meant to be genuinely useful as a glance-
  able summary, and as a foundation for a future rule type that matches on
  keywords rather than just identifiers or thresholds.
- **The search index itself is broader** — it also includes raw
  identifier values (BVN, NIN, phone, email, etc.), because an analyst
  typing a BVN into the search bar expects to find the matching entity
  directly, not just entities whose *notes* happen to mention it.

Search queries are sanitized before hitting FTS5 — every term is quoted
and prefix-matched, ANDed together, so malformed or adversarial input
(unbalanced quotes, SQL-injection-style strings) can't break or hijack the
query. Verified directly against both malformed and adversarial input
before this shipped, not just assumed safe.

## Input suggestions, in detail

As you type into an entity's name/notes or a watchlist's category/reason,
a small dropdown offers your own recent entries for that field —
`server/services/inputHistory.js` has the full whitelist and the
reasoning, but the short version: **identifier values are never
suggested.** Suggesting your own BVN or someone else's from a previous
entry into a new record would actively cause harm, not save time, so
those fields are excluded by design. Suggestions are also strictly
per-user — nobody sees another analyst's recent inputs, both for privacy
and because "the last risk note I personally wrote" is a more useful
suggestion than an arbitrary colleague's.

## AI attachment summarization, in detail

Set `ANTHROPIC_API_KEY` (see `.env.example`) and every PDF, PNG, JPEG, or
TXT file attached to a watchlist request gets a short, automatically
generated summary of fraud-relevant findings, stored alongside the
attachment and folded into that watchlist entry's search index.

**What happens without a key configured:** uploads work exactly the same,
the summary is just marked `skipped`. This was tested directly, not
assumed — the app boots and every upload path was confirmed working with
no key present.

**What happens if the key is invalid, or the API call fails for any other
reason:** the attachment's `summary_status` becomes `failed`, a warning is
logged server-side, and — critically — **the file upload itself still
succeeds.** This was also tested directly: a deliberately invalid key was
used to confirm the request genuinely reaches Anthropic's API (a real
`authentication_error` came back, not a local/mocked response) and that
the failure is contained to the summary, never blocking the upload.

**Scope, deliberately:** DOCX files are not summarized — extracting DOCX
text needs a separate parsing library, which was out of scope for what
was asked ("read image, pdf"). DOCX attachments get `summary_status:
'skipped'`, same as any other unsupported type, not an error.

**A latency tradeoff worth knowing about:** summarization currently runs
synchronously, as part of the upload request — the response doesn't come
back until the AI call finishes (typically a few seconds per file). Fine
at this app's current scale; if uploads ever involve many large files at
once, or several people uploading concurrently, moving this to a
background job (upload responds immediately, summary appears on refresh)
would be the natural next step. Documented here rather than silently
building the more complex version before it's actually needed.

## The cross-institution network, in detail

This is the part of the product that has to be right, because getting it
wrong means either a useless network or a privacy breach.

**What an organization contributes** (only when it has opted in, and only
when a watchlist entry has been *approved* — never a pending or rejected
one): for each identifier on the flagged entity, an HMAC-SHA256 hash of
that identifier, plus the category, severity and a timestamp.

**What it never contributes:** the raw identifier, the person's name, the
analyst's reason, notes, or attachments.

**What a querying organization gets back:** for each of *its own*
identifiers that matches, how many distinct institutions have reported
it, which categories, the highest severity, and the most recent date.
Not which institutions. Not their case details.

**Why HMAC rather than a plain hash — the detail that matters most:** a
BVN is 11 digits, so there are only 10^11 possible values. A plain
SHA-256 of that is exhaustively brute-forceable on ordinary hardware.
Publishing plain hashes would be publishing the identifiers with extra
steps, while *looking* anonymous — which is worse than not hashing at
all, because it invites false confidence. Keying the hash with a secret
that never leaves the deployment defeats that attack.

**Operational consequence you must plan for:** the key lives in
`NETWORK_HASH_PEPPER` (or, in development, is generated into
`data/.network-pepper`). **Back it up, and never rotate it casually** —
changing it invalidates every hash already published, and the network
will silently match nothing while appearing to work.

**Withdrawal is real, not cosmetic.** Suspending, recalling or expiring a
watchlist entry withdraws its signals. Turning an organization's network
participation off purges every signal it ever contributed. An
organization that opts out stops both contributing and querying.

## What platform administrators can and cannot see

The platform console exists so we can run the service: onboard
customers, spot an account that has gone quiet, suspend for non-payment,
handle an offboarding.

**It shows:** organization status, plan, user counts and roles, last
login, storage used, and counts of entities / watchlist entries / rules /
alerts / audit events.

**It cannot show:** any entity name, any identifier, any watchlist
reason, any attachment, or any audit-log detail. This isn't a policy
promise — `server/routes/platform.js` only ever runs `COUNT()` against
tenant databases, and there is a test asserting that no fraud content
appears anywhere in any platform API response.

That boundary exists because under NDPA we are most likely a *processor*
for customer content, and a processor helping itself to client data is
exactly what the law restricts. If a support scenario ever genuinely
requires reading customer data, that is a separate feature needing
customer consent, time-bounding and its own audit trail — not a quiet
addition to the existing endpoints. See `COMPLIANCE-NDPA.md`.

## Architecture

```
server/
  index.js            Express app entry — mounts routes, serves the frontend, runs the rule scheduler
                       (once per organization), loads .env if present
  platformDb.js       SHARED database: organizations, users, roles, sessions, network signals,
                       platform audit log. The only database every tenant touches.
  tenantDb.js         One SQLite file PER ORGANIZATION — entities, watchlist, rules, alerts,
                       audit log, search index. The actual isolation boundary; read the header
                       comment in this file before changing anything about it.
  middleware/
    auth.js            Session cookies + RBAC permission checks
    audit.js            The one function every write action logs through
    rateLimit.js         In-memory login rate limiter
  services/
    ruleEngine.js        Rule evaluation logic — pure functions, no HTTP, independently testable
    search.js             FTS5 indexing + safe query building
    inputHistory.js         Per-user recent-input tracking (the non-sensitive-fields whitelist lives here)
    summarize.js              AI attachment summarization via the Anthropic API
    network.js                 Cross-institution hashed intelligence — read its header before editing
  utils/
    validators.js         Identifier format validation (BVN/NIN/phone/email/account/device)
    keywords.js             Keyword extraction (stopword filtering, dedup)
    upload.js                 Multer configuration — file type whitelist, safe disk storage
  routes/
    auth.js, entities.js, watchlist.js, audit.js, users.js, rules.js, alerts.js, search.js,
    suggestions.js, network.js, platform.js

public/                Frontend — plain HTML/CSS/JS, no build step, no framework
  login.html
  console.html          App shell (sidebar + topbar + search bar + view container)
  assets/
    theme.css            Shared design system (same one the marketing site uses)
    site.js               Theme toggle (Light/Dark/Auto) + scroll reveal
    app.css               Product-specific styles (tables, modals, badges)
    app.js                 All application logic — routing, API calls, rendering
    login.js                Login form handler (separate file so the CSP can block inline scripts)

data/
  platform.db              Shared platform database (created on first run)
  .network-pepper          HMAC key for network hashing — SECRET, gitignored, back this up
  tenants/
    org_<id>.db              One database per organization
    org_<id>/attachments/      That organization's uploaded evidence files
```

**Why the same design system as the website?** Visual consistency across
every Zenza Technology surface, and it means zero extra design work to get
a professional-looking console — see `02-brand-guide/` in the main project
package for the source of that system.

**Why no React/build step?** Matches the philosophy already established for
the marketing site: `npm install && npm start` is the entire setup. A
build step becomes worth adding once the console's interactivity outgrows
what vanilla JS handles comfortably — not before.

## API reference (summary)

All routes except `/api/auth/login` and `/api/health` require a valid
session cookie. All routes return `{ ok: true, ... }` or `{ ok: false, error }`.

| Method | Route | Permission | Purpose |
|---|---|---|---|
| POST | `/api/auth/login` | — | Sign in |
| POST | `/api/auth/logout` | any | Sign out |
| GET | `/api/auth/me` | any | Current user + permissions |
| GET | `/api/entities` | `entities.view` | Search/list, `?q=&type=&status=&page=` |
| GET | `/api/entities/:id` | `entities.view` | Full detail + watchlist + versions |
| POST | `/api/entities` | `entities.create` | Create (blocks on duplicate identifiers unless `force:true`) |
| PUT | `/api/entities/:id` | `entities.edit` | Update (writes a version snapshot) |
| POST | `/api/entities/bulk` | `entities.create` | Bulk create, max 500 records/call |
| GET | `/api/watchlist` | `watchlist.view` | List, `?status=&severity=&entity_id=` |
| POST | `/api/watchlist` | `watchlist.create` | Submit for approval (maker) |
| POST | `/api/watchlist/:id/approve` | `watchlist.approve` | Approve (checker — blocks self-approval) |
| POST | `/api/watchlist/:id/reject` | `watchlist.approve` | Reject (requires notes) |
| POST | `/api/watchlist/:id/suspend` | `watchlist.suspend` | Suspend an active entry |
| POST | `/api/watchlist/:id/reactivate` | `watchlist.suspend` | Reactivate a suspended entry |
| POST | `/api/watchlist/:id/recall` | `watchlist.create` | Withdraw your own request, within 10 minutes of submitting it |
| GET | `/api/watchlist/:id/attachments` | `watchlist.view` | List supporting documents on a request |
| POST | `/api/watchlist/:id/attachments` | `watchlist.create` | Upload up to 5 files (multipart/form-data, field name `files`) |
| GET | `/api/watchlist/:id/attachments/:attachmentId/download` | `watchlist.view` | Download a specific attachment |
| GET | `/api/search?q=` | any | Full-text search across entities and watchlist, filtered to what the caller can view |
| GET | `/api/suggestions/:field?q=` | any | Recent inputs for one whitelisted field, for the calling user only |
| GET | `/api/network/status` | any | Whether your organization is enrolled in the shared network |
| GET | `/api/network/check/:entityId` | `entities.view` | Check one of *your* entities against the network |
| GET | `/api/platform/stats` | platform admin | Deployment overview |
| GET | `/api/platform/organizations` | platform admin | All organizations + operational metrics |
| GET | `/api/platform/organizations/:id` | platform admin | One organization + its users |
| POST | `/api/platform/organizations` | platform admin | Onboard an organization + its first admin |
| PUT | `/api/platform/organizations/:id` | platform admin | Change plan, name, network participation, notes |
| POST | `/api/platform/organizations/:id/suspend` | platform admin | Block access, keep data |
| POST | `/api/platform/organizations/:id/reactivate` | platform admin | Restore access |
| POST | `/api/platform/organizations/:id/archive` | platform admin | Offboard — access revoked, data retained |
| DELETE | `/api/platform/organizations/:id/purge` | platform admin | Permanent deletion (archived orgs only, typed confirmation required) |
| GET | `/api/platform/audit` | platform admin | What Zenza operators did to customer accounts |
| GET | `/api/audit` | `audit.view` | Filterable, paginated, read-only |
| GET | `/api/users` | `users.manage` | List all users |
| POST | `/api/users` | `users.manage` | Create a user |
| PUT | `/api/users/:id/role` | `users.manage` | Change a user's role |
| PUT | `/api/users/:id/status` | `users.manage` | Enable/disable (can't disable self) |
| POST | `/api/users/me/change-password` | any | Self-service password change |
| GET | `/api/rules` | `rules.view` | List, `?status=&rule_type=` |
| GET | `/api/rules/:id` | `rules.view` | Full detail including config |
| POST | `/api/rules` | `rules.manage` | Create (always starts as `draft`) |
| PUT | `/api/rules/:id` | `rules.manage` | Update name/description/config/severity |
| POST | `/api/rules/:id/activate` | `rules.manage` | Draft/disabled → active |
| POST | `/api/rules/:id/disable` | `rules.manage` | Stops the rule from running (manually or on schedule) |
| POST | `/api/rules/:id/simulate` | `rules.view` | Dry run — returns matches, creates nothing |
| POST | `/api/rules/:id/run` | `rules.manage` | Runs for real — creates alerts (active rules only) |
| GET | `/api/alerts` | `alerts.view` | List, `?status=&severity=&entity_id=` |
| GET | `/api/alerts/:id` | `alerts.view` | Full detail |
| POST | `/api/alerts/:id/dismiss` | `alerts.action` | Requires notes |
| POST | `/api/alerts/:id/escalate` | `alerts.action` | Creates a `pending_approval` watchlist request, pre-filled from the alert |

## Role → permission matrix

| Permission | Admin | Fraud Manager | Analyst |
|---|:---:|:---:|:---:|
| View repository | ✓ | ✓ | ✓ |
| Create/edit entities | ✓ | ✓ | ✓ |
| Submit watchlist request | ✓ | ✓ | ✓ |
| Approve/reject watchlist request | ✓ | ✓ | — |
| Suspend/reactivate watchlist entry | ✓ | ✓ | — |
| View audit log | ✓ | ✓ | — |
| Manage users | ✓ | — | — |
| View detection rules | ✓ | ✓ | ✓ |
| Create/activate/disable/run rules | ✓ | ✓ | — |
| View alerts | ✓ | ✓ | ✓ |
| Dismiss/escalate alerts | ✓ | ✓ | ✓ |

## Installable as a PWA

The console can be installed as a standalone app (its own window, its own
icon, works offline for the UI shell) — click "⤓ Install App" in the top
bar once signed in. Full detail, including the deliberate security decision
around what does and doesn't get cached offline, is in
`docs/INTEGRATION-AND-DEPLOYMENT.md`.

## Connecting this to the marketing website

The login page links back to the marketing site, and every marketing page
now has a "Log In" link pointing here. See
`docs/INTEGRATION-AND-DEPLOYMENT.md` for the recommended subdomain
architecture (`app.yourdomain.com` for this, root domain for the marketing
site) and what changes before both go live.

## Scaling this beyond the MVP

This follows the same philosophy as the website: start with the simplest
thing that works, document the upgrade path, don't build it before you
need it.

- **Database:** SQLite (`better-sqlite3`) today. When you outgrow a single
  file — multiple servers, need for replication/backups — move to Postgres.
  Because every route goes through `db.js`'s prepared statements rather than
  scattering raw SQL everywhere, this is a contained change, not a rewrite.
- **Sessions:** currently stored in the same SQLite database. At real scale,
  move sessions to Redis so any server instance can validate any session —
  needed once you run more than one server process.
- **Deployment:** same hosts recommended for the website (Render, Railway,
  Fly.io, or a VPS) — see `03-hosting-and-scaling-guide/` in the main
  project package. This app needs a persistent volume for `data/zenza_fid.db`
  exactly like the website needs one for its submissions file.
- **Next module to build:** the Rule Trigger Engine is now live (see above).
  What's left from Phase 2 is the core-banking / external API integration
  layer — deliberately deferred until there's a real pilot bank to
  integrate with, since building against a hypothetical API tends to
  produce the wrong abstraction. Worth scoping properly once a pilot
  partner is in the picture, the same way every phase here has been scoped
  before starting.

## Security notes for before this touches real data

- **Change the default admin password immediately** (see above) — this is
  the one item on this list you still have to do yourself.
- Session cookies are `HttpOnly`, `SameSite=Lax`, and automatically get the
  `Secure` flag added when `NODE_ENV=production` is set — nothing to
  remember at deploy time, just set that environment variable on whatever
  host you deploy to.
- Login is rate-limited (8 attempts per IP per 15-minute window, `429`
  response with a `Retry-After` header beyond that) — see
  `server/middleware/rateLimit.js`. It's in-memory, which is fine for a
  single server instance; move it to Redis if you ever run more than one
  instance behind a load balancer.
- Login response timing is equalized for "no such user" vs. "wrong
  password" (a dummy password hash is always computed) — so response time
  can't be used to enumerate valid email addresses.
- Every API route requires a valid session at minimum, and write/sensitive
  operations require the specific permission for that action — verified
  route-by-route, not just asserted (see `03-zenza-fid-app/../QA-TESTING-REPORT.md`
  in the package root for the full audit trail).
- Basic security headers are set on every response (`X-Content-Type-Options`,
  `X-Frame-Options: DENY`, a `Content-Security-Policy` restricting scripts
  and styles to same-origin plus Google Fonts) — see `server/index.js`.
  This is also why there are no inline `<script>` blocks anywhere in
  `public/` — a strict CSP and inline scripts don't mix, so everything JS
  lives in its own file under `public/assets/`.
- Passwords are hashed with `scrypt` (Node's built-in, no external
  dependency) — this is a legitimate, modern choice, not a shortcut.
- SQL is 100% parameterized (prepared statements with `?` placeholders)
  everywhere, including the dynamic search/filter queries — verified by
  reading every `db.prepare()` call, not assumed.
- Frontend rendering escapes all user-controllable text before inserting
  it into the page (see `esc()` in `public/assets/app.js`) — verified for
  every field that accepts free text (names, notes, reasons), not just
  the obvious ones.
