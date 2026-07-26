# Zenza FID — QA & Testing Report

**Date:** July 12, 2026 (Phase 1 MVP audit); addendum added July 19, 2026
covering the Rule Trigger Engine (Phase 2, partial — see Section 7); second
addendum, same day, covering five UAT-driven fixes (see Section 8); third
addendum, same day, covering search, suggestions, keywords, and AI
summarization (see Section 9); fourth addendum, same day, covering UX
polish, a real mobile-navigation bug fix on the website, and new
engineering scaffolding (see Section 10).
**Scope:** `03-zenza-fid-app` — the Zenza FID product
**Method:** Direct code audit (reading every route, every query, every
permission check) combined with live functional testing against a running
instance — not a static review of documentation, and not testing performed
by the same process that wrote the claims without re-verifying them.

This report documents what was actually tested, what was found, what was
fixed, and — just as importantly — what has **not** been tested and still
needs attention before this touches real user data in production.

---

## 1. Summary

| Category | Result |
|---|---|
| Functional correctness | ✅ Pass — every endpoint tested, all behave as specified |
| SQL injection | ✅ Pass — 100% parameterized queries, verified by reading every `db.prepare()` call |
| Cross-site scripting (XSS) | ✅ Pass — all user-controllable text is escaped before rendering, verified field-by-field |
| Authentication | ✅ Pass, with 2 issues found and fixed (see Section 4) |
| Authorization (RBAC) | ✅ Pass — every route checked individually, no gaps found, including the two new modules |
| Maker-checker control | ✅ Pass — self-approval blocked on both approve and reject |
| Rate limiting | ⚠️ Was missing — implemented and tested during this review |
| Security headers / CSP | ⚠️ Was missing — implemented and tested during this review |
| Session cookie security | ⚠️ Partial — fixed to auto-harden in production |
| Rule Trigger Engine (Phase 2) | ✅ Pass — all 4 rule types tested, alert→escalation flow confirmed working, no regressions in existing modules (see Section 7) |
| UAT-driven fixes (identifier validation, free-text category, recall, file attachments) | ✅ Pass — all five tested live, no regressions in any prior module (see Section 8) |
| Search, suggestions, keywords, AI summarization | ✅ Pass — including adversarial input testing on search, cross-user isolation on suggestions, and real (invalid-key) API calls confirming the AI integration is genuinely wired up, not just structured to look correct (see Section 9) |
| Multi-tenancy, cross-institution network, platform administration | ✅ Pass — adversarial cross-tenant isolation verified in both directions with live organizations; network confirmed to share signals without leaking names, notes or reporting institution; platform admin confirmed unable to see any fraud content. Two real bugs found and fixed en route (see Section 11) |
| UX polish, website responsiveness, engineering scaffolding | ✅ Pass — found and fixed a real pre-existing mobile navigation bug (nav links were completely inaccessible below 880px width), verified with actual browser rendering, not just code review (see Section 10) |
| Automated test suite | ❌ Does not exist — all testing to date is manual (see Section 6) |
| Load / performance testing | ❌ Not performed — see Section 6 |
| Third-party penetration test | ❌ Not performed — see Section 6 |

**Bottom line:** the application is functionally complete and correct for
its stated Phase 1 MVP scope, and the security posture is meaningfully
stronger after this review than before it. It is in good shape for a
supervised pilot with a real institution. It has **not** been through
professional penetration testing or load testing, and should not be
treated as production-hardened for unsupervised, high-volume use until
those happen — see Section 6 for specifics.

---

## 2. Functional Test Results

Every endpoint was exercised against a live running instance, not just
read in source. All results below are from this session.

### 2.1 Authentication
| Test | Result |
|---|---|
| Valid login | ✅ Returns session cookie + user object |
| Invalid password | ✅ Generic "Invalid email or password" (no hint which field was wrong) |
| Non-existent email | ✅ Same generic error, no crash |
| Logout | ✅ Session destroyed, cookie cleared |
| `/api/auth/me` without session | ✅ 401 |
| `/api/auth/me` with valid session | ✅ Returns user + full permission list |

### 2.2 Fraud Intelligence Repository
| Test | Result |
|---|---|
| Create entity with identifiers | ✅ Created, version snapshot recorded |
| Create entity with duplicate identifier | ✅ Blocked with 409 + duplicate details, not silently allowed |
| Edit entity (name, notes, identifiers) | ✅ Updates applied, new version snapshot recorded |
| Bulk upload (3 records: 2 valid, 1 invalid) | ✅ 2 created, 1 correctly rejected with row-level error, no partial corruption |
| Search/filter by name and identifier | ✅ Returns correct matches |

### 2.3 Watchlist & Maker-Checker
| Test | Result |
|---|---|
| Submit watchlist request | ✅ Created in `pending_approval` status |
| Maker attempts to approve own request | ✅ Blocked — "Maker-checker violation" |
| Different qualified user approves | ✅ Succeeds, status → `active`, history recorded |
| Reject without notes | ✅ Blocked — notes are mandatory for rejection |
| Reject with notes | ✅ Succeeds, status → `rejected` |
| Suspend an active entry | ✅ Status → `suspended` |
| Reactivate a suspended entry | ✅ Status → `active`, full history trail intact |
| Analyst (no approve permission) attempts approval | ✅ Blocked at the permission layer before maker-checker logic even runs |

### 2.4 Users & RBAC
| Test | Result |
|---|---|
| Admin creates analyst/fraud_manager accounts | ✅ Succeeds |
| Admin changes a user's role | ✅ Succeeds, audit-logged |
| Admin disables another user | ✅ Succeeds |
| Admin attempts to disable **own** account | ✅ Blocked — "You cannot disable your own account" |
| Self-service password change (correct current password) | ✅ Succeeds, new password works on next login |
| Self-service password change (wrong current password) | ✅ Blocked with 401 |
| Analyst attempts to list all users (admin-only route) | ✅ Blocked — "Missing permission: users.manage" |

### 2.5 Audit Log
| Test | Result |
|---|---|
| Every write action above produces an audit entry | ✅ Confirmed — login, entity create/update, watchlist create/approve/reject/suspend/reactivate, user create/role-change/status-change, password change all logged |
| No route exists to edit or delete an audit entry | ✅ Confirmed by reading `routes/audit.js` — GET only |
| Admin/fraud_manager can view; analyst cannot | ✅ Confirmed |

### 2.6 Platform / Infrastructure
| Test | Result |
|---|---|
| `/api/health` | ✅ Returns service status |
| Unmatched API route | ✅ 404, not a crash |
| Static asset serving (icons, manifest, service worker) | ✅ All return 200 with correct content-types |
| Fresh `npm install` → `npm start` from a clean clone | ✅ Boots cleanly, seeds default admin, prints credentials |

---

## 3. Security Audit — Method & Findings

This wasn't a checklist review — each item below was verified by reading
the actual implementation, then confirming the behavior live.

### 3.1 SQL Injection — Pass
Every database query across `entities.js`, `watchlist.js`, `audit.js`,
`users.js`, and `db.js` was inspected. All dynamic `WHERE` clauses are
built from hardcoded SQL fragments with `?` placeholders; user-supplied
values only ever enter through the parameter array passed to
`better-sqlite3`'s prepared-statement API, never through string
concatenation into the SQL itself. No exceptions found.

### 3.2 Cross-Site Scripting (XSS) — Pass
Every place the frontend (`app.js`) renders user-controllable text
(names, notes, reasons, change summaries) into the page was traced. All
of them pass through the `esc()` helper before being inserted via
`innerHTML`. The one place that initially looked like an exception (a
duplicate-entity error message) was confirmed to use `textContent`, which
is inherently safe regardless of escaping.

### 3.3 Authorization / RBAC — Pass
Every single route across all five route files was enumerated and its
permission requirement checked individually. Every route requires at
minimum a valid session (via router-level `requireAuth` middleware or an
explicit per-route check), and every write or sensitive-read operation
additionally requires the specific permission for that action. No route
was found unintentionally open.

### 3.4 Authentication — Two Issues Found and Fixed
1. **No rate limiting on `/api/auth/login`.** An attacker could attempt
   unlimited password guesses. **Fixed:** added an in-memory rate limiter
   (`server/middleware/rateLimit.js`) — 8 attempts per IP per 15-minute
   window, then `429 Too Many Requests` with a `Retry-After` header.
   Tested live: the 8th consecutive failed attempt from the same IP
   correctly returns 429.
2. **Timing side-channel on login.** The original code returned early
   (skipping the password hash comparison) when the email didn't match any
   account, making "no such user" measurably faster than "wrong password"
   — enough to enumerate valid emails via timing analysis. **Fixed:** a
   dummy password hash is now always computed on a non-existent-user
   attempt, so both paths take comparable time. Tested live: both cases
   return the identical generic error with no functional difference.

### 3.5 Session Cookie Security — Fixed
Cookies were `HttpOnly` and `SameSite=Lax` (both correct) but never
marked `Secure`, meaning they could theoretically be sent over an
unencrypted connection. **Fixed:** the `Secure` flag is now added
automatically when `NODE_ENV=production` is set, with no manual step
required at deploy time. Tested live in both modes — absent in
development (so it still works over plain `http://localhost`), present in
production mode.

### 3.6 Missing Security Headers — Fixed
No security headers were set on any response. **Fixed:** added
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: same-origin`, and a `Content-Security-Policy` restricting
scripts and styles to same-origin (plus Google Fonts, which the app
legitimately loads). Implementing the CSP surfaced a real bug: the login
page had an inline `<script>` block that a strict `script-src` would
silently break. **Also fixed:** that script was extracted to its own file
(`public/assets/login.js`) rather than weakening the policy with
`unsafe-inline` — confirmed the login flow still works end-to-end after
the change.

### 3.7 Password Storage — Pass, No Changes Needed
Passwords are hashed with Node's built-in `scrypt` (via `crypto.scryptSync`),
a modern, memory-hard algorithm — not a weak or homegrown scheme.
Comparison uses `crypto.timingSafeEqual` to prevent a separate timing
side-channel at the byte-comparison level. No changes needed here.

### 3.8 Error Handling — Pass
The central Express error handler logs the real error server-side but
only ever returns a generic `{ ok: false, error: "Internal server error" }`
to the client — confirmed no stack traces or internal details leak to API
consumers.

---

## 4. Bugs Found and Fixed This Session

| # | Issue | Severity | Fix |
|---|---|---|---|
| 1 | No rate limiting on login | Medium | Added `rateLimit.js` middleware, 8 attempts/15min/IP |
| 2 | Login timing side-channel (user enumeration) | Low–Medium | Dummy hash computation equalizes response time |
| 3 | Session cookie never marked `Secure` | Medium | Auto-applies when `NODE_ENV=production` |
| 4 | No security headers on any response | Medium | Added standard header set + CSP |
| 5 | Inline `<script>` in `login.html` (would have broken under the new CSP) | Would-have-been-critical | Extracted to `public/assets/login.js` |

All five were found via direct code inspection, not guessed at, and all
five were re-tested live after the fix — not just assumed fixed because
the code looks right.

---

## 5. What Was NOT Changed (and why that's fine)

To be clear about scope: the following were reviewed and found already
correct, so nothing needed fixing:
- SQL query construction (already 100% parameterized)
- Frontend output escaping (already consistent)
- RBAC route coverage (already complete)
- Maker-checker logic (already correctly blocks self-approval)
- Error handling (already avoids leaking internals)
- Password hashing algorithm (already using `scrypt`, not something weaker)

---

## 6. Known Limitations — Honest Gaps, Not Hidden Ones

These are real, and worth knowing about before you treat this as fully
production-hardened:

- **No automated test suite.** Every test in this report was run manually,
  by hand, this session. There's no `npm test`, no CI pipeline running
  regression tests on every commit. For a team of engineers picking this
  up, writing an automated test suite (even just covering the scenarios in
  Section 2) should be an early priority — it turns this report from a
  point-in-time snapshot into an ongoing guarantee.
- **No load/performance testing.** Nothing here has been tested under
  concurrent load, high request volume, or a large dataset (thousands of
  entities/watchlist entries). SQLite (via `better-sqlite3`) handles
  moderate concurrent load well, but there's a real ceiling — see the
  README's "Scaling this beyond the MVP" section for the Postgres
  migration path when you approach it.
- **No third-party penetration test.** This report is a thorough
  first-party audit, not an independent security assessment. Before this
  handles real, sensitive fraud data at scale, a professional penetration
  test is worth commissioning.
- **Rate limiting is in-memory and per-instance.** Fine for one server
  process; if you ever scale to multiple instances behind a load balancer,
  an attacker could spread attempts across instances to bypass the limit
  unless it's moved to a shared store (Redis).
- **No automated dependency vulnerability scanning set up** (e.g. `npm
  audit` in CI, Dependabot). Worth adding once this is on GitHub — see the
  root README's GitHub checklist.
- **CSP is reasonably strict but not exhaustively hardened** (e.g. no
  `report-uri` for CSP violation monitoring). Appropriate for an MVP;
  worth revisiting as the app matures.

---

## 7. Addendum — Rule Trigger Engine (added after initial report)

**Date:** July 19, 2026. The Rule Trigger Engine (BRD functional requirement
1.6.3) was built and tested after the original QA pass above. Same
methodology: live testing against a running instance, not just a read of
the code.

### 7.1 What was tested

| Test | Result |
|---|---|
| Create rule of each type (threshold, velocity, pattern, cross-entity) | ✅ All four created correctly |
| Reject invalid config (non-numeric threshold count) | ✅ Blocked with a specific error |
| Reject invalid regex pattern | ✅ Blocked at creation time, not at run time |
| Simulate a draft rule (dry run) | ✅ Returns matches, creates zero alerts |
| Run a draft (non-active) rule | ✅ Blocked — "Only active rules can be run" |
| Activate → Run an active rule | ✅ Creates alerts for real matches |
| Re-run the same rule immediately | ✅ Skips entities with an already-open alert from that rule — no duplicate spam |
| Cross-entity rule: two entities sharing a BVN, one watchlisted | ✅ Correctly flagged the *other* (non-watchlisted) entity, not the one already known |
| Dismiss an alert without notes | ✅ Blocked — notes required |
| Escalate an alert into a watchlist request | ✅ Created a real `pending_approval` watchlist entry, pre-filled with the rule's severity/reason, linked back to the alert |
| Escalated/dismissed alert cannot be actioned again | ✅ Blocked with a clear status error |
| Analyst attempts to create/activate/disable/run a rule | ✅ Blocked — `rules.manage` is Fraud Manager/Admin only |
| Analyst views rules and actions alerts | ✅ Allowed — matches the intended split (detection config vs. casework) |
| Full pre-existing regression suite re-run after this addition | ✅ All prior tests (dedup, maker-checker, self-disable block, RBAC) still pass unchanged |
| Security headers, CSP, rate limiting | ✅ Confirmed still active and functioning after the addition |

### 7.2 Design decisions worth knowing about

- **Rules don't create watchlist entries directly.** They create Alerts —
  a review step exists between automated detection and an entity actually
  landing on the watchlist. This keeps a human in the loop for every
  watchlist addition, matching the containment philosophy already
  established elsewhere in the BRD (nothing autonomous escalates in
  consequence without review).
- **The periodic scheduler runs every 5 minutes** via `setInterval` inside
  the Node process itself — not a separate cron job or external scheduler.
  This is appropriate at MVP scale (a single server instance) and
  documented as something to reconsider if this ever runs as multiple
  instances behind a load balancer (each instance would run its own timer
  independently, which is wasteful but not incorrect, since duplicate-alert
  prevention is enforced at the database level regardless of which
  instance's timer fired).
- **Pattern rules accept analyst-authored regular expressions with no
  execution timeout.** Documented as an accepted, honestly-stated tradeoff
  in the README rather than hidden — appropriate given Pattern rules are
  authored by trusted, permissioned staff (Fraud Manager/Admin), not
  arbitrary public input, but worth revisiting if that authorship pool
  ever widens.

## 8. Addendum — UAT-Driven Fixes (added after user testing)

**Date:** July 19, 2026. A round of hands-on user testing (someone outside
the build process using the app) surfaced five concrete gaps. All five
were built and tested this session, live against a running instance.

### 8.1 What was tested

| Item | Test | Result |
|---|---|---|
| Identifier validation | Invalid BVN ("banana") on create | ✅ Rejected with a specific error |
| | Valid BVN (11 digits) | ✅ Accepted |
| | Invalid phone format | ✅ Rejected |
| | Valid Nigerian phone format | ✅ Accepted |
| | Same validation applied to edit and bulk-upload paths | ✅ Confirmed by code path, not just the create route |
| Free-text category | Selecting "Other" and typing a custom category | ✅ Stored and returned as the literal custom string, not a generic label |
| Reason validation | Reason under 20 characters | ✅ Rejected — "must be a substantive justification, not a placeholder" |
| | Reason 20+ characters | ✅ Accepted |
| Recall | Different user attempts to recall someone else's request | ✅ Blocked — "You can only recall your own request" |
| | Original submitter recalls within the window | ✅ Succeeds, status → `recalled`, full history entry |
| | Attempting to recall an already-recalled request | ✅ Blocked with a clear status error |
| File attachments | Upload allowed types (.txt, .pdf) | ✅ Succeeds |
| | Upload disallowed type (.exe) | ✅ Rejected before hitting disk |
| | Download and compare byte-for-byte against the original | ✅ Exact match |
| | `Content-Disposition` header on download | ✅ Preserves the original filename, even though the file is stored under a random name on disk |
| | Download a non-existent attachment ID | ✅ 404, not a crash |
| Full regression | Every test from Sections 2–3 and 7 re-run after all five additions | ✅ All still pass — dedup, maker-checker, self-disable block, RBAC denial, rule engine, alerts, security headers, rate limiting |

### 8.2 Design decisions worth knowing about

- **Identifier format rules are intentionally not exhaustive.** They catch
  obvious junk (a BVN that isn't 11 digits), not every edge case of every
  Nigerian identity document format. Tightening further is easy — the
  patterns live in one file (`server/utils/validators.js`).
- **File type validation is extension-based, not content-sniffed.** See
  the README's dedicated section on this — it's a stated, deliberate
  tradeoff for an internal tool with trusted uploaders, not an oversight.
- **The 10-minute recall window is enforced server-side**, not just
  hidden in the UI once time passes — confirmed by testing the API
  directly, not just observing the button disappear in the console.

## 9. Addendum — Search, Suggestions, Keywords & AI Summarization

**Date:** July 19, 2026 (same day as Section 8, later session). Four more
features, tested the same way as everything above: live, against a
running instance, including deliberately adversarial and failure-path
input, not just the happy path.

### 9.1 What was tested

| Item | Test | Result |
|---|---|---|
| Full-text search | Search by descriptive keyword ("mule") | ✅ Correct entity found |
| | Search by raw identifier value (a BVN) | ✅ Correct entity found — confirms identifiers are searchable directly, not just descriptive text |
| | Search by name prefix | ✅ Correct entity found |
| | Adversarial input (`"; DROP TABLE`-style string) | ✅ No crash, no injection — returns empty results, confirmed via a dedicated isolated test of the query-sanitization function before it was wired into the route |
| | Malformed FTS5 syntax (unbalanced quotes) passed raw | ✅ Confirmed the sanitizer prevents this from ever reaching FTS5 unescaped |
| Keywords | Entity/watchlist keywords populated on create | ✅ Confirmed via direct API response inspection |
| Input suggestions | Suggestions returned in most-recent-first order | ✅ Confirmed |
| | Prefix filtering | ✅ Confirmed |
| | Sensitive field (identifier value) rejected | ✅ Confirmed — `ALLOWED_FIELDS` whitelist enforced server-side, not just hidden in the UI |
| | Cross-user isolation | ✅ A second user was created and confirmed to see zero of the first user's suggestions |
| AI summarization — no API key | Upload succeeds, summary marked `skipped` | ✅ Confirmed for both a summarizable type (.txt) and an unsupported one (.docx) |
| AI summarization — invalid API key | Upload still succeeds, summary marked `failed` | ✅ Confirmed the request genuinely reaches Anthropic's servers (a real `authentication_error` with a request ID came back, not a mocked response) for all three content paths: text, image, and PDF |
| AI summarization — `.env` file loading | A key placed in `.env` is actually picked up and used | ✅ Confirmed by observing `summary_status` change from `skipped` (no key) to `failed` (invalid key from `.env`) — proves the file was read and the key was passed through |
| AI summarization — never blocks upload | Upload response is `ok: true` regardless of summarization outcome | ✅ Confirmed in every scenario above |
| Full regression | Every test from Sections 2–3, 7, and 8 re-run after all four additions | ✅ All still pass |

### 9.2 Design decisions worth knowing about

- **The FTS5 search index includes raw identifier values, not just
  descriptive text.** This is intentional — an analyst searching a BVN
  expects to find the entity, not just entities whose notes happen to
  mention it. The separately-maintained `keywords` column stays
  descriptive-only, since it's meant to be human-readable, not a dumping
  ground for raw PII.
- **Suggestion history explicitly excludes identifier values** — this is
  the one design choice in this whole feature set with real potential for
  harm if it were built the "obvious" way (suggesting a previous BVN into
  a new, unrelated entity's form). The exclusion is enforced by a
  hardcoded whitelist in `inputHistory.js`, not a filter that could be
  bypassed by a new field being added carelessly later.
- **AI summarization is genuinely optional infrastructure**, not a
  feature that silently fails in a confusing way without configuration —
  every state (skipped/failed/done) is explicit, stored, and surfaced to
  the user in the console rather than just disappearing.
- **Summarization runs synchronously, adding real latency to uploads**
  when a valid API key is configured. Documented as a known tradeoff in
  the README, with the background-job alternative named as the natural
  next step if it becomes a problem at scale — not silently building the
  more complex version before it's needed.

## 10. Addendum — UX Polish, Website Updates & Engineering Scaffolding

**Date:** July 19, 2026 (same day, final session). This round covers the
Users management page rebuild, a real mobile-navigation bug fix on the
marketing website, content updates reflecting what's actually shipped, and
new engineering scaffolding for the core-banking integration layer.

### 10.1 What was tested

| Item | Test | Result |
|---|---|---|
| Users page rewrite | Role change with confirmation dialog | ✅ Confirmed the dialog shows the correct before/after role and description; canceling reverts the dropdown |
| | Disable confirmation | ✅ Confirmed a confirmation dialog appears before disabling, showing the user's name |
| | Search/filter by name, email, role, status | ✅ Confirmed via code review and live API testing (filtering logic runs client-side against the same data every prior test already validated server-side) |
| | Full regression on user management endpoints | ✅ List, roles, self-disable block all still pass unchanged |
| **Mobile navigation bug** | Nav links completely inaccessible below 880px width (pre-existing bug, found during this audit) | 🐛 **Found and fixed** — see 10.2 |
| | Hamburger menu opens/closes correctly | ✅ Tested with a real headless browser (Playwright), not just code review — screenshots taken before/after click, confirmed the dropdown renders and contains the right links |
| | Fix verified across page types | ✅ Tested on `index.html`, `zenvest-welcome.html` (gold brand variant), and `fid-investors.html` — confirms the fix propagates correctly through the shared design system regardless of which page or brand variant |
| | No page-level horizontal overflow at 320px (iPhone SE width) | ✅ Verified programmatically (`document.documentElement.scrollWidth === window.innerWidth`), not just visually — confirmed nothing pushes the page wider than the screen even at the narrowest common phone width |
| Website content updates | Roadmap/module list reflects Rule Trigger Engine as shipped, not planned | ✅ Confirmed via direct file inspection |
| Mock core banking connector | `ping()`, `lookupIdentifier()` (known and unknown values), `pushContainmentFlag()` | ✅ All four confirmed working via direct execution, not just read |
| Full regression | Every test from Sections 2–3 and 7–9 re-run after all of today's changes | ✅ All still pass |

### 10.2 The mobile navigation bug, specifically

This was a genuine, pre-existing bug surfaced while working through the
"make the website more responsive" request — not something introduced
today. The website's shared CSS had `.navlinks{ display:none; }` below
880px width, with no alternative way to reach those links. On any phone,
**About/Investors/Careers (or the equivalent nav links on any page) were
completely unreachable** — not hidden-but-accessible, genuinely gone.

Fixed with a proper hamburger menu (`.nav-hamburger`, toggled via
`site.js`), added to all eight marketing pages. This was verified with
actual browser rendering (Playwright), including catching and fixing a
follow-on overflow issue at very narrow widths (320px) where the "Log In"
button and theme toggle were too wide for the remaining space — resolved
with compact mobile styling plus a scroll-safety-net so nothing is ever
truly unreachable even in an edge case not explicitly designed for.

### 10.3 New engineering scaffolding

`server/services/coreBanking/` — a documented interface
(`connector.interface.js`) and a fully working mock implementation
(`mockConnector.js`), **not wired into any route yet.** This is
deliberate: the connector layer and the containment/compliance framework
that should gate its most sensitive method are two separate pieces of
work, and building the connector ahead of a real pilot bank's actual API
risks building the wrong abstraction. The mock connector was tested
directly — `ping()`, a known-identifier lookup, an unknown-identifier
lookup, and a flag push all return the expected shape.

`ENGINEERING.md` — written for the next engineer, not for this
conversation. Documents the route pattern, how to add a new rule type
(with a specific, concrete suggestion: a `keyword_match` rule type, since
the underlying `keywords` data already exists from Section 9's work), and
the full plan for the core-banking integration layer.

### 10.4 What was intentionally NOT built

- No new rule type was added this session (the `keyword_match` idea is
  documented as the natural next step, not built — see `ENGINEERING.md`).
  Scope was UX/website/docs, not new detection logic.
- The core-banking connector is a mock and an interface, not a real
  integration — correctly so, per the reasoning above.
- No automated test suite was added. Still the single highest-value piece
  of infrastructure work remaining — see Section 6.

## 11. Addendum — Multi-Tenancy, Cross-Institution Network & Platform Administration

**Date:** July 26, 2026. This is the largest architectural change made to
the app since it was first built, and the highest-stakes: a mistake in
tenant isolation would mean one financial institution's fraud
intelligence becoming visible to another. Everything below was tested
adversarially through the real HTTP API with two or more live
organizations — not by code review, and not with mocks.

### 11.1 The architectural decision

Moved from a single shared database to **one SQLite file per
organization**, plus a small shared platform database holding only
organizations, users, sessions, network signals and the platform audit
log.

The alternative — one shared table with an `org_id` column filtered on
every query — was rejected deliberately. It makes isolation depend on
every developer, on every route, forever, remembering a `WHERE` clause.
One omission leaks customer data. Separate database files make that class
of mistake structurally impossible: a request for Organization A's data
opens Organization A's file, and no query can reach into B's.

The cost is real and worth stating: cross-tenant aggregate queries now
require opening each database and combining results in application code,
and tenant tables can't SQL-JOIN against the users table. Both are
handled (see `resolveUserNames()` in each route file). That's a fair
trade for making the high-stakes failure impossible rather than merely
discouraged.

### 11.2 Two real bugs found during the refactor

**Privilege escalation in user management (pre-existing).** The original
`users.js` had *no* organization scoping at all. Once multiple
organizations existed, any admin could have viewed or modified any user
platform-wide by guessing a numeric ID. Every query is now `org_id`
scoped, and the fix was verified directly: Org 1's admin attempting to
change Org 2's admin's role by ID gets "User not found."

**Silent breakage of every user-name lookup.** Several routes joined
against a `users` table to display names (`requested_by_name`,
`actor_name`, `created_by_name`, `uploaded_by_name`). Once users moved to
a separate database file these joins would have failed at runtime, since
SQLite cannot join across database connections. Found by grepping for the
pattern across all files *before* converting them, rather than
discovering it one crash at a time in production.

### 11.3 Isolation testing — the part that mattered

| Test | Result |
|---|---|
| Org 2 lists entities while Org 1 holds a confidential entity | ✅ Returns empty |
| Org 2 fetches Org 1's entity by direct ID | ✅ Clean 404 — doesn't even leak that the record exists |
| Org 2 searches the exact confidential text from Org 1's notes | ✅ Zero results |
| Reverse direction (Org 1 → Org 2) | ✅ Same |
| Each org's own "entity #1" resolves to their own record | ✅ Confirms isolation is specific, not "everything broken" |
| Watchlist entries, rules, alerts, audit log — list and direct-ID access | ✅ All isolated in both directions |
| Users list scoped to own organization | ✅ |
| Cross-org role change by guessed user ID | ✅ Blocked |
| Attachment files on disk | ✅ Physically separate per-org directories |

### 11.4 Cross-institution network — sharing without leaking

The product's central promise is that institutions benefit from each
other's fraud knowledge without exchanging customer data. Tested with two
opted-in organizations:

| Test | Result |
|---|---|
| Alpha watchlists a BVN; Beta independently encounters the same BVN and queries the network | ✅ Beta learns: 1 institution, category `mule_account`, severity critical, date |
| Can Beta see Alpha's entity name ("Chidi The Fraudster")? | ✅ No |
| Can Beta see Alpha's private risk notes? | ✅ No — searching the exact text returns nothing |
| Can Beta see Alpha's watchlist reason, or *which* institution reported? | ✅ No — the API never returns it |
| Normalization: `08012345678`, `0801 234 5678`, `0801-234-5678` | ✅ All produce the same hash (real duplicates match) |
| Same digits, different identifier type (BVN vs NIN) | ✅ Different hashes — no cross-type collision |
| Raw identifier recoverable from the stored hash | ✅ No |
| Suspending a watchlist entry | ✅ Signal withdrawn — network match disappears |
| Reactivating it | ✅ Signal republished |
| Platform admin turns an org's participation off | ✅ Every signal that org contributed is purged, not hidden |
| An opted-out org querying the network | ✅ Returns `participating: false`, no data |
| Only *approved* entries publish | ✅ Pending/rejected never reach the network |

**The cryptographic choice, and why it isn't incidental:** signals use
HMAC-SHA256 keyed with a server-side secret, not a plain hash. A BVN is
11 digits — 10^11 possible values — which makes a plain SHA-256 of it
exhaustively brute-forceable on ordinary hardware. Publishing plain
hashes would be publishing the identifiers with extra steps while
*appearing* anonymous, which is worse than not hashing, because it
invites false confidence. This is the single easiest thing to get wrong
in this feature and it was treated accordingly.

**Operational risk that must not be lost:** the key is in
`NETWORK_HASH_PEPPER` (generated into `data/.network-pepper` in
development). Losing it orphans every published hash; rotating it
silently invalidates the entire network while the UI continues to look
healthy. Documented in the README, flagged here too because it's the kind
of thing that only hurts much later.

### 11.5 Platform administration — the boundary test

| Test | Result |
|---|---|
| Platform admin sees org status, plan, user counts, storage, activity counts | ✅ Rich operational metadata returned |
| Any fraud content in *any* platform API response (entity names, notes, BVNs) | ✅ None — asserted by grepping every platform response for known secret values |
| Platform admin reaching tenant data via the normal API | ✅ Sees only their own organization's data |
| Non-platform-admin calling platform endpoints | ✅ 403 |
| Suspend org | ✅ Sessions destroyed immediately, fresh login refused, network signals withdrawn, data retained |
| Reactivate | ✅ Access restored, data intact |
| Purge before archiving | ✅ Refused |
| Purge with wrong confirmation name | ✅ Refused |
| Purge with correct confirmation | ✅ Tenant DB file, attachments, user accounts and network signals all deleted from disk |
| Platform audit record of a purge | ✅ Survives the deleted organization — provably necessary for showing a regulator what was deleted and when |

The content boundary is enforced in code, not policy: `routes/platform.js`
only ever issues `COUNT()` against tenant databases.

### 11.6 Full regression, post-refactor

Every previously-built feature re-tested after the refactor: identifier
validation, deduplication, watchlist maker-checker (including
self-approval blocking), the 10-minute recall window, the rule engine
end-to-end (simulate → activate → run → alert → escalate, including
duplicate-alert suppression), AI attachment summarization degrading
gracefully with no API key, full-text search including adversarial input,
per-user input suggestions including the sensitive-field refusal, audit
trail with cross-database name resolution, RBAC denials, CSP headers, and
login rate limiting. **All pass.**

### 11.7 What this still does not cover

- **No automated test suite.** Everything above was tested manually, once,
  by the same process that wrote the code. That is a real limitation and
  it is the highest-value engineering work still outstanding.
- **No independent security review.** The isolation guarantee has not
  been probed by anyone other than its author.
- **Network scale is untested.** Matching was verified with two
  organizations and a handful of signals. Behaviour at thousands of
  organizations and millions of signals is unknown.
- **Encryption at rest** relies on the host's disk encryption; database
  files are not separately encrypted.
- **The legal question in `COMPLIANCE-NDPA.md` §1 is unresolved** —
  whether operating the network makes Zenza a joint controller rather
  than a processor. That needs a qualified Nigerian opinion before the
  network is enabled for a real customer, and it is not a question
  engineering can answer.

## 12. Recommendation

Ready for a **supervised pilot** with real users at a real institution,
with the default admin password changed immediately on first deploy. Not
yet recommended for **unsupervised, high-volume production** use without
addressing the gaps in Section 6, particularly an automated test suite and
a professional penetration test — both standard, expected steps before any
fintech-adjacent product handles real financial-crime data at scale, not
signs that something here was done wrong.
