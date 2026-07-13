# Zenza Technology — Website + Local Database

This is the Zenza Technology company site — a portfolio hub plus a
dedicated page track for each product it builds. It currently covers two
products (Zenza FID and ZenVest), structured so a third, fourth, or fifth
product slots in the same way without restructuring anything that exists.

## Site structure

```
Zenza Inc. (zenzainc.com)                              — separate site, links here
   │
   └── Zenza Technology (zenzatech.com)                  — index.html, this folder
          │
          ├── careers.html                                 — company-wide roles, routes to product-specific hiring
          │
          ├── Zenza FID product track
          │     ├── fid-welcome.html                          — the story
          │     ├── fid-investors.html                        — business model & funding ask
          │     └── fid-careers.html                          — product-specific hiring
          │           └── app.zenzatech.com                      — the live product (separate app, see zenza-fid-app/)
          │
          └── ZenVest product track
                ├── zenvest-welcome.html                       — the story ("Create Wealth Together")
                ├── zenvest-investors.html                     — business model & funding ask
                └── zenvest-careers.html                       — product-specific hiring
```

`index.html` is the company portfolio hub — company story, both products
featured as cards, and a route into company-wide careers. It is **not**
product-specific the way it used to be; it introduces Zenza Technology as a
company first, then lets the visitor choose a product.

## What's in this folder

```
index.html              ZenzaTech company hub — story + product portfolio
careers.html             Company-wide hiring — routes to each product's own careers page
fid-welcome.html          Zenza FID — story
fid-investors.html        Zenza FID — business model & investor briefing
fid-careers.html           Zenza FID — hiring
zenvest-welcome.html      ZenVest — story
zenvest-investors.html     ZenVest — business model & investor briefing
zenvest-careers.html        ZenVest — hiring
admin.html               Local view of every form submission (no auth — dev only)
assets/
  theme.css               Shared design system — colors, type, components, light/dark mode,
                           AND the ZenVest brand variant (see below)
  site.js                 Shared behavior: theme toggle, scroll reveal, nav state
  zenzatech-*.svg          ZenzaTech company logo/icon (teal, the default brand)
  zenza-tech-*.svg          Earlier logo pass, kept for reference — use the zenzatech-* files
server.js                Node.js server: serves the pages + the database API
package.json
data/submissions.json     Every form entry lands here
```

## One design system, two brand feels

Zenza FID and ZenVest are visually part of the same family — same
typography, same component library (buttons, cards, tags, timelines, the
light/dark/auto toggle) — but ZenVest carries a deliberately different
accent: warm gold and emerald ("Create Wealth Together") instead of Zenza
FID's teal and navy (security, trust, technical precision).

This is implemented as a **brand variant** in `assets/theme.css`, applied
by adding `data-brand="zenvest"` to a page's `<html>` tag:

```html
<html lang="en" data-brand="zenvest">
```

Every existing component automatically picks up the new colors — nothing
about the button, card, or tag CSS itself had to change. There's also a
scoped `.brand-zenvest` class for previewing the palette inside a single
element on an otherwise teal-branded page (used on the portfolio hub's
ZenVest product card).

**Adding a third product later:** duplicate this pattern — pick a new
accent pair, add a `data-brand="yourproduct"` block to `theme.css`
following the ZenVest example, and build that product's three pages the
same way `zenvest-*.html` were built from the `fid-*.html` template.

## Running it locally

Requires [Node.js](https://nodejs.org) v16 or newer.

```bash
cd zenza-tech-site
node server.js
```

Then open **http://localhost:3000/** — you'll land on the ZenzaTech
company hub. All nine pages are linked from there.

## How the database works, and what gets recorded

Same lightweight JSON-file database used throughout the Zenza Technology
site family — see the main project's hosting guide for the scaling path
(SQLite, then Postgres) when this outgrows a single file.

| Page | Form | `formType` |
|---|---|---|
| fid-welcome.html | Questions & Recommendations | `welcome_contact` |
| fid-careers.html | Show Interest | `career_interest` |
| fid-investors.html | CTA buttons (Request Data Room / Book a Call) | `investor_cta` |
| zenvest-welcome.html | Questions & Recommendations | `zenvest_contact` |
| zenvest-careers.html | Show Interest | `zenvest_career_interest` |

`admin.html` filters by both page and form type across every product —
open it locally to see everything that's come in, from either product,
in one place.

## Before hosting this live

Same checklist as every other Zenza Technology property:
- `admin.html` has no authentication — don't deploy it publicly as-is.
- Placeholder emails (`hello@zenzatech.com`, `careers@zenzafid.com`,
  `hello@zenvest.africa`, `careers@zenvest.africa`, etc.) need to become
  real inboxes before launch.
- The `app.zenzatech.com` link on Zenza FID's pages is a placeholder until
  that subdomain is actually deployed — see `zenza-fid-app/docs/
  INTEGRATION-AND-DEPLOYMENT.md` for the full deployment architecture.
- ZenVest does not yet have a live product app the way Zenza FID does —
  its pages currently link to `mailto:` addresses only. When ZenVest's
  own product is built, it should follow the same `app.zenzatech.com`
  subdomain pattern (e.g. a distinct path or subdomain per product).
