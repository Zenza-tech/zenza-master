# ZenVest — Materials

ZenVest is Zenza Technology's second product — an open financial ecosystem
for credit, investment, and real estate ("Create Wealth Together"). Unlike
Zenza FID, ZenVest does not yet have a built product application — these
are the materials that exist at this stage: the strategic document, a
partner-specific leave-behind, and a standalone pitch page.

## What's in here

```
ZenVest_Ecosystem_Prospectus.docx          The full strategic document — partner tracks,
                                             risk framework, revenue model, roadmap
ZenVest_x_Ver_Technology_Summary.docx       A condensed, Ver Technology-specific leave-behind,
                                             pulled from the prospectus
standalone-partner-landing-page/            A single-page pitch site, usable independently of
                                             the main ZenzaTech website (e.g. for a direct link
                                             in an email or a QR code on a printed deck)
```

## How this relates to the rest of the package

- **`02-zenza-tech-site/`** has ZenVest's *permanent* home within the company
  site — `zenvest-welcome.html`, `zenvest-investors.html`, and
  `zenvest-careers.html`, reachable from the ZenzaTech portfolio hub
  alongside Zenza FID.
- **This folder** has ZenVest's *standalone* materials — things you hand
  directly to one person or one company (a document, a leave-behind, a
  single link) rather than something reached by browsing the company site.

Both draw from the same source of truth (the Ecosystem Prospectus) and are
built to stay consistent with it — see the note on tagline sync below.

## Known open item: "Create Wealth Together"

The tagline "Create Wealth Together" is live across the website
(`02-zenza-tech-site/zenvest-*.html`) and the standalone landing page in
this folder, but has **not yet been added to the Ecosystem Prospectus
document itself** — it was introduced after the prospectus was written.
Decide whether it belongs in the formal document (e.g. worked into the
Executive Summary or Section 1 framing) or is meant to stay website-only
marketing language, and update the `.docx` accordingly if so.

## Known open item: partner-specific pitch coverage

The prospectus's Section 4 (separate offers/asks for credit, investment,
and real estate partners) is fully represented on the standalone landing
page (`standalone-partner-landing-page/index.html`, via its tabbed Partner
Tracks section), but **not** on `02-zenza-tech-site/zenvest-investors.html`
— that page currently covers market opportunity, the model, revenue, and
roadmap, without the partner-by-partner breakdown. If the company-site page
should carry the full pitch too (so a visitor never has to leave the main
site to see it), that's a straightforward addition — bring the same tabbed
component from the standalone landing page into `zenvest-investors.html`.

## What still doesn't exist yet

- A built ZenVest product application (the equivalent of `03-zenza-fid-app/`)
  — this is future work, once partner integrations are further along.
- A dedicated `app.zenzatech.com`-style subdomain for ZenVest — the
  hosting guide (`06-hosting-and-scaling-guide/`) has a placeholder note on
  this for when it's needed.
