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

## What's actually implemented

| Area | What it does |
|---|---|
| **Auth** | Server-side sessions via httpOnly cookies (not localStorage/JWT-in-browser-storage) — the more secure default for this kind of app |
| **Repository** | Create/search/edit bad-actor profiles with multiple identifiers (BVN, NIN, email, phone, account, device); duplicate-identifier detection blocks accidental re-creation; every edit is snapshotted to version history |
| **Watchlist** | Submit → pending approval → approved/rejected by a *different* user with the right role; suspend/reactivate active entries; entries with an expiry date auto-expire when read |
| **RBAC** | Enforced at the API layer via permission checks on every route — the frontend also hides actions a user can't perform, but the real enforcement is server-side |
| **Audit Log** | Every create/update/approve/reject/login/logout writes an audit entry — actor, action, resource, timestamp, IP — viewable (not editable) by Admin/Fraud Manager |
| **Users** | Admin can create accounts, change roles, and enable/disable accounts (no hard delete — preserves audit integrity); every user can change their own password |

## What's deliberately NOT in this MVP

Per the BRD's phased roadmap, these are later phases, not missing bugs:
- Rule Trigger Engine (Phase 2)
- Relationship / Link Analytics (Phase 3)
- AI Risk Scoring (Phase 4)
- Cross-Bank Hashed Intelligence Network (Phase 4 / Enterprise add-on)
- Core banking / external API integrations (Phase 2)
- Containment & Compliance Controls / Auto-Pilot Mode (Phase 4)

## Architecture

```
server/
  index.js            Express app entry — mounts routes, serves the frontend
  db.js               SQLite schema, seed data (roles/permissions/default admin)
  middleware/
    auth.js            Session cookies + RBAC permission checks
    audit.js            The one function every write action logs through
  routes/
    auth.js, entities.js, watchlist.js, audit.js, users.js

public/                Frontend — plain HTML/CSS/JS, no build step, no framework
  login.html
  console.html          App shell (sidebar + topbar + view container)
  assets/
    theme.css            Shared design system (same one the marketing site uses)
    site.js               Theme toggle (Light/Dark/Auto) + scroll reveal
    app.css               Product-specific styles (tables, modals, badges)
    app.js                 All application logic — routing, API calls, rendering

data/
  zenza_fid.db           SQLite database file (created on first run)
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
| GET | `/api/audit` | `audit.view` | Filterable, paginated, read-only |
| GET | `/api/users` | `users.manage` | List all users |
| POST | `/api/users` | `users.manage` | Create a user |
| PUT | `/api/users/:id/role` | `users.manage` | Change a user's role |
| PUT | `/api/users/:id/status` | `users.manage` | Enable/disable (can't disable self) |
| POST | `/api/users/me/change-password` | any | Self-service password change |

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
- **Next module to build:** per the BRD roadmap, Phase 2 is the Rule Trigger
  Engine and core-banking API integration layer — worth discussing scope
  before starting, the same way we scoped this phase.

## Security notes for before this touches real data

- Change the default admin password immediately (see above).
- This MVP does not yet implement rate limiting on `/api/auth/login` —
  worth adding before any real deployment, to slow down credential-stuffing
  attempts.
- Session cookies are `HttpOnly` and `SameSite=Lax` but not yet marked
  `Secure` — that flag should be added once this runs behind HTTPS (it's a
  one-line change in `server/middleware/auth.js`).
- Passwords are hashed with `scrypt` (Node's built-in, no external
  dependency) — this is a legitimate, modern choice, not a shortcut.
