# Zenza — The Complete Package

Everything for the Zenza company structure, in one place: the holding
company, the technology company, both of its products, the brand system
tying them all together, and how to host it all live.

## The structure

```
Zenza Inc.                          (holding company)
 └── Zenza Technology                 (tech subsidiary — "Innovate to Solve Problems")
       ├── Zenza FID                    (product 1 — fraud intelligence, built & PWA-enabled)
       └── ZenVest                       (product 2 — "Create Wealth Together," pre-MVP)
```

Zenza Inc. is the parent holding company, deliberately separate from its
subsidiaries and their investors. Zenza Technology is the company under it
that builds software — Zenza FID is live and in active development;
ZenVest is its second product, currently at the strategy and partner-pitch
stage.

## What's in this package

```
01-zenza-inc-site/              The holding company's own site — static, no backend needed
02-zenza-tech-site/               Zenza Technology's site — company hub + both products' full
                                   page tracks (about/investors/careers each), one company-wide
                                   careers page
03-zenza-fid-app/                  The built Zenza FID product (login, repository, watchlist,
                                    audit, installable as a PWA)
04-zenvest-materials/               ZenVest's strategy document, a partner-specific summary, and
                                     a standalone partner-pitch landing page — no product app yet
05-brand-assets/                     Logos (editable SVG) for both Zenza Inc. and Zenza
                                      Technology, the shared design system, and the ZenVest
                                      brand variant documentation
06-hosting-and-scaling-guide/         Step-by-step: local → live, for everything above, together
```

## Recommended domain structure

```
zenzainc.com                → 01-zenza-inc-site
zenzatech.com                 → 02-zenza-tech-site (portfolio hub + both products' pages)
app.zenzatech.com              → 03-zenza-fid-app (Zenza FID's product console)
(none yet)                      → ZenVest has no product app to deploy yet — see
                                   06-hosting-and-scaling-guide, Phase 10
```

## Running everything together, locally

Each of the two Node apps defaults to a different port, so you can run
both at once without a conflict:

| App | Command | Default port |
|---|---|---|
| `02-zenza-tech-site` | `npm start` | `3000` |
| `03-zenza-fid-app` | `npm start` | `4000` |

`01-zenza-inc-site` doesn't need a server — just open its `index.html`
directly. With all three running, you can click through the full real
flow: Zenza Inc. → Zenza Technology → either product → (for Zenza FID)
the actual product console.

## Putting this on GitHub

This package is structured to work as a single monorepo — one repository
holding the holding-company site, the Zenza Technology site, the Zenza FID
app, and ZenVest's materials together. That's a deliberate recommendation
for this stage: everything shares one design system (`05-brand-assets/`),
cross-links constantly, and is small enough that one repo is easier to
manage than four. Split into separate repos later if/when each product
gets its own dedicated team with an independent release cadence — nothing
here would need restructuring to make that split when the time comes.

**Before your first push:**
- A root `.gitignore` is already included, covering `node_modules/`,
  runtime database files, `.env` files, and OS/editor cruft — confirm it's
  actually in your repo root (dotfiles are easy to lose in a manual
  copy/zip, which is exactly what happened once already while assembling
  this package — caught and fixed, but worth double-checking on your end
  too before the first commit).
- Each of `02-zenza-tech-site` and `03-zenza-fid-app` also has its own
  `.gitignore`, redundant with the root one but useful if you ever split
  either into its own repository later.
- Run `git status` right after your first `git add .` and scan the output
  for anything that shouldn't be there (a stray `node_modules`, a `.db`
  file) before your first commit — a five-second check that saves a much
  more annoying history-rewrite later.

## Where to start

1. **Just want to see it running?** Each of `01-zenza-inc-site`,
   `02-zenza-tech-site`, and `03-zenza-fid-app` has its own README with
   local setup steps. `01-zenza-inc-site` is plain HTML (open `index.html`
   directly); the other two need `npm install && npm start`.
2. **Handing this to a designer?** Send `05-brand-assets/` — it's
   self-contained, starts with its own README, and includes editable
   logos for both companies plus the ZenVest brand variant.
3. **Talking to a specific ZenVest partner (e.g. a credit, investment, or
   real estate company)?** `04-zenvest-materials/` has what you need —
   the full strategic document and a template for a partner-specific
   one-pager.
4. **Ready to go live?** Start with `06-hosting-and-scaling-guide/`.

## What's real vs. what's a placeholder

- Both websites and the Zenza FID product app are fully built and tested
  — not mockups. Every server was started fresh and every page verified
  to return successfully before packaging.
- The logo files in `05-brand-assets/logos/` are real, editable vector
  assets — for Zenza Inc. (the original design you provided, recreated
  precisely) and for Zenza Technology (the circle-and-line mark you found
  and asked to adopt, in both its default teal and ZenVest's gold variant).
- ZenVest does not have a built product application yet — what exists is
  the strategic groundwork (the Ecosystem Prospectus, partner materials,
  and its pages within the Zenza Technology site). Building the actual
  ZenVest application is future work, the same way Zenza FID's app was
  built after its own BRD was finalized.
- Cross-links between sites (`zenzainc.com`, `zenzatech.com`,
  `app.zenzatech.com`) and contact emails (`@zenzafid.com`,
  `@zenvest.africa`, `@zenzatech.com`) are placeholders until those domains
  and inboxes actually exist — each README flags exactly where to update
  them.

## Two known open items, carried over from the last review

These were caught by directly cross-referencing the website against the
ZenVest Ecosystem Prospectus, and are documented in more detail in
`04-zenvest-materials/README.md`:

1. **The "Create Wealth Together" tagline** is live on the website but not
   yet written into the Ecosystem Prospectus document itself.
2. **The partner-by-partner pitch** (credit/investment/real estate
   specific offers) is fully present on the standalone landing page in
   `04-zenvest-materials/`, but not yet on `zenvest-investors.html` inside
   the main Zenza Technology site.

Neither is broken — both are open decisions about where content should
live, flagged rather than silently resolved one way.

## Company

**Zenza Inc.** — EST 2022 — "Dreaming my ideas and concepts into reality."
**Zenza Technology** — "Innovate to Solve Problems."
**ZenVest** — "Create Wealth Together."
