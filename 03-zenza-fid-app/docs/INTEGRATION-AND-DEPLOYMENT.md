# Integrating the Product with the Website, and Deploying Both

This covers three things: how the marketing site and the actual product
relate to each other, what's needed to host both live together, and what
makes the product installable as a PWA (Progressive Web App).

---

## 1. How the two pieces fit together

You now have three tiers under one company structure:

```
zenzainc.com            → Zenza Inc. — the holding company (separate site, separate tone)
zenzatech.com            → Zenza Technology — this marketing site (zenza-fid-site), a Zenza Inc. company
app.zenzatech.com         → the product console (zenza-fid-app) — this document's focus
```

Zenza Inc. is the parent holding company — a separate site with its own
identity, covering the portfolio of companies it's building (Zenza
Technology today, others in development). This document focuses on the
relationship between the two tiers you'll deploy most often:

You now have two separate applications:

| | Marketing site (`zenza-fid-site`) | Product app (`zenza-fid-app`) |
|---|---|---|
| What it is | Welcome/About, Investors, Careers pages | The actual fraud-intelligence console — login, repository, watchlist, audit |
| Audience | Visitors, investors, candidates | Your fraud/compliance team, logged in |
| Tech | Static HTML + a tiny Node server for form storage | Full Node/Express app with a real database, auth, RBAC |
| Data | Form submissions (contact, career interest) | Fraud intelligence — entities, watchlist, audit log |

They're deliberately **separate applications** — different purposes,
different security postures, different people using them. The right way to
connect them in production is **not** to merge them into one codebase, but
to put them on **two subdomains of the same domain**:

```
zenzatech.com          → the marketing site (zenza-fid-site)
app.zenzatech.com       → the product console (zenza-fid-app)
```

This is the same pattern almost every SaaS company uses (e.g., a marketing
site at `stripe.com` and the actual product at `dashboard.stripe.com`). It
keeps the public-facing site fast and simple, keeps the product's security
boundary clean (cookies/sessions scoped to `app.zenzatech.com` only), and
lets you deploy, scale, and update each independently.

### What's already wired up

- Every page on the marketing site (`index.html`, `welcome.html`,
  `investors.html`, `careers.html`) now has a **"Log In"** button in the top
  navigation, linking to `https://app.zenzatech.com`.
- The product's login page links back to `https://zenzatech.com`.

**Before going live, update these placeholder URLs** to match your real
domain if it's not `zenzatech.com` — they're plain links in the HTML
(`<a href="https://app.zenzatech.com">Log In</a>`), easy to find and edit in
each file's `<nav>` section.

---

## 2. Deploying both together

Follow the same phased approach as `HOSTING-AND-SCALING-GUIDE.md` (in the
website package), once for each app. The short version:

1. **Two separate deployments, one Git repo each** (or two folders in one
   monorepo, deployed as separate services — either works). Don't try to
   run them as one process; they have different purposes and different
   scaling needs.
2. **DNS:** point your root domain (`zenzatech.com`) at the marketing site's
   host, and add a subdomain record — a `CNAME` for `app` pointing at
   wherever the product app is hosted (Render/Railway/Fly.io/VPS, same
   options as the website).
3. **HTTPS on both.** Most hosts issue this automatically per-domain once
   DNS is connected — confirm the padlock shows on both
   `zenzatech.com` and `app.zenzatech.com` before treating either as live.
4. **Persistent storage on the app, not just the site.** The product's
   SQLite database (`data/zenza_fid.db`) needs the same "attach a
   persistent volume" step the website's `data/submissions.json` needs —
   see Phase 3 of the hosting guide. This one matters more: losing the
   product's database means losing real fraud-intelligence records, not
   just contact-form submissions.
5. **Separate environment variables per app.** Each app reads its own
   `PORT` from the hosting platform; no shared configuration needed between
   them.

### Why HTTPS matters more for the app than the site

Service workers (what makes the PWA installable — see below) **refuse to
register over plain HTTP** in every modern browser, except on `localhost`
for local development. If `app.zenzatech.com` isn't served over HTTPS, the
"Install App" feature silently won't work. This is one more reason the
product app needs real hosting with a real certificate before you consider
it launch-ready, not just "technically online."

---

## 3. PWA — what's implemented and what it means

The product console (`zenza-fid-app`) is now installable as a Progressive
Web App. Concretely:

- **`manifest.json`** — tells the browser the app's name, icon, and that it
  should open in its own window (`display: standalone`) rather than a
  browser tab when installed.
- **App icons** — generated at every required size (16px through 512px,
  plus a "maskable" variant for Android's adaptive icon shapes), using the
  brand's node-mark motif.
- **`sw.js` (service worker)** — makes the app shell (HTML/CSS/JS) load
  instantly on repeat visits and work even with a flaky connection.
- **An "Install App" button** appears in the console's top bar once the
  browser decides the app is installable (Chrome/Edge on desktop and
  Android show this automatically; Safari/iOS requires "Add to Home
  Screen" from the share menu instead — Apple doesn't support the
  `beforeinstallprompt` API).

### A deliberate security decision: what does NOT get cached

Fraud-intelligence data is sensitive. The service worker is written so that
**every `/api/*` request always goes to the network — never cached, never
served from a stale copy.** Only the static app shell (the empty UI, not
any actual case data) is cached for offline speed. If you're offline, the
app opens instantly but shows a clear "you're offline" message on any
action that needs data — it will never show you yesterday's cached
watchlist as if it were current. This is the right tradeoff for a
compliance-relevant tool, even though it means less offline functionality
than a typical consumer PWA.

### Testing installability

1. Run the app locally (`npm start`) and open `http://localhost:4000` in
   Chrome or Edge — `localhost` is exempt from the HTTPS requirement, so you
   can test the full install flow before deploying anywhere.
2. Sign in. You should see the "⤓ Install App" button appear in the top bar
   within a second or two.
3. Click it, confirm the install prompt — the app now opens in its own
   window, with its own icon, separate from your browser.
4. On mobile (once deployed with HTTPS), Android/Chrome will offer an
   automatic "Add to Home Screen" banner; iOS/Safari users need to use the
   Share button → "Add to Home Screen" manually — this is an Apple platform
   limitation, not something fixable from the web app side.

### One thing to remember on every future deploy

Bump `CACHE_VERSION` at the top of `public/sw.js` (e.g. `v1` → `v2`)
whenever you change anything in `public/`. Without this, users who already
installed the app may keep seeing a stale cached version of the login page
or console shell until they manually clear it — the version bump forces
the service worker to fetch fresh files.

---

## 4. Suggested next step

Once both are live on real subdomains with HTTPS confirmed, the natural
follow-up is deciding what "logged out" vs "logged in" looks like across
the two — e.g., should someone who's already signed into the app and visits
`zenzatech.com` see a different nav state ("Go to Console" instead of "Log
In")? That's a small enhancement worth doing once both are actually
deployed and you can test the real cross-subdomain behavior, rather than
guessing at it now.
