# Zenza Technology — Hosting, Scaling & Management Guide

This is the step-by-step path from "running on my laptop" to "live on the
internet, safe, and manageable" for the Zenza FID website. It's written for
someone who isn't a career sysadmin — each step says what to do, why, and
what it costs.

Follow the phases in order. You don't need to do Phase 4 before Phase 1 works.

---

## Phase 1 — Get a domain and decide where it will live

**1.1 Buy a domain name**
Register `zenzafid.com` (or your preferred name) through a registrar —
Namecheap, Google Domains/Squarespace Domains, or a Nigerian registrar like
Whogohost if you want local billing. Expect $10–15/year for a `.com`.
Consider also registering `zenzatechnology.com` for the parent company, even
if you don't build a site there yet — it protects the name.

**1.2 Pick a host for the server**
The website is a small Node.js app (`server.js`), not a static site, because
it also runs the database API. That means it needs somewhere that keeps a
Node process running, not just a folder of files. Good options, cheapest to
more capable:

| Host | Good for | Approx. cost |
|---|---|---|
| **Render** (render.com) | Easiest setup, free tier to start | Free → $7/mo |
| **Railway** (railway.app) | Similarly easy, generous free tier | Free → $5–10/mo |
| **Fly.io** | More control, still simple | Free → $5–10/mo |
| **A VPS** (DigitalOcean, Linode, Hetzner) | Full control, best value at scale | $4–6/mo |

**Recommendation:** start with **Render** or **Railway**. Both can deploy
directly from a GitHub repository with almost no configuration, and both
have a generous free tier that's enough for a pre-launch site.

---

## Phase 2 — Get the code online (GitHub + first deploy)

**2.1 Put the website folder in a GitHub repository**
- Create a free GitHub account if you don't have one.
- Create a new repository, e.g. `zenza-fid-website`.
- Upload the entire `01-website` folder's contents (everything inside it,
  not the folder itself) to the repository root.
- This gives you version history and a one-click connection to most hosts.

**2.2 Connect the host to the repository**
On Render or Railway: "New Project" → "Deploy from GitHub" → pick the
repository. Set:
- **Build command:** (leave blank — there's nothing to build)
- **Start command:** `node server.js`
- **Port:** the host will set a `PORT` environment variable automatically;
  `server.js` already reads `process.env.PORT`, so no code change is needed.

**2.3 Deploy and test**
Once deployed, the host gives you a URL like `zenza-fid.onrender.com`. Open
it and confirm all four pages load, the theme toggle works, and a test form
submission succeeds.

**2.4 Point your domain at it**
In your registrar's DNS settings, add the record your host tells you to add
(usually a `CNAME` pointing to something like `zenza-fid.onrender.com`, or an
`A` record with an IP address). Most hosts also handle HTTPS/SSL
automatically once the domain is connected — no separate certificate
purchase needed.

---

## Phase 3 — Make the data storage production-ready

The current database (`data/submissions.json`) is intentionally simple — a
single file. Two things matter once you're live:

**3.1 Check your host keeps files between deploys**
Some hosts wipe the filesystem on every deploy or restart. If that happens,
`data/submissions.json` would reset to empty. Look for a "persistent disk"
or "volume" option (Render and Railway both offer this — usually a small
monthly fee, $1–2/mo for a few GB) and attach it to the `data/` folder.

**3.2 Upgrade to a real database once you have real traffic**
The JSON file is fine for the first weeks of live traffic. When you're
regularly getting submissions and want proper querying/backups, move to
Postgres:
- Use a managed Postgres add-on from your host (Render, Railway, and Fly.io
  all offer one — usually free to start, a few dollars a month after).
- In `server.js`, replace the `readDB()`/`writeDB()` functions with calls to
  the Postgres client (the `pg` npm package). The two API endpoints
  (`POST`/`GET /api/submissions`) stay exactly the same, so none of the four
  HTML pages need to change.
- This is a task worth handing to a developer/freelancer if you're not
  comfortable with it yourself — it's a few hours of work, not a rebuild.

---

## Phase 4 — Lock down security before real people visit

Do these **before** sharing the live URL publicly:

1. **Password-protect `admin.html`.** Right now anyone with the URL can see
   every submission. Add HTTP Basic Auth in `server.js` (a well-documented,
   ~15-line addition), or move the admin view behind a login. Don't skip
   this — it's the one piece of this whole guide that's a real risk if
   ignored.
2. **Tighten CORS.** `server.js` currently allows requests from any origin
   (`Access-Control-Allow-Origin: *`), which is fine for local testing. Once
   you have a real domain, restrict it to that domain only.
3. **Add basic spam protection to the forms.** A simple honeypot field
   (a hidden input real users never fill in, but bots do) or a free service
   like Cloudflare Turnstile stops most automated spam without annoying
   real visitors.
4. **Set real email addresses.** Replace `hello@zenzafid.com`,
   `invest@zenzafid.com`, and `careers@zenzafid.com` in the HTML files with
   inboxes you actually control (see Phase 6).
5. **Turn on your host's HTTPS.** Confirm the padlock shows in the browser
   once your domain is connected — most hosts do this automatically, but
   verify it.

---

## Phase 5 — Keep it running (monitoring & backups)

- **Uptime monitoring:** a free tool like UptimeRobot or Better Uptime pings
  your site every few minutes and emails/texts you if it goes down.
- **Back up `data/submissions.json` (or your database) regularly.** If
  you're on the JSON file, a simple weekly download is enough at this stage.
  If you move to Postgres, most managed database add-ons include automatic
  daily backups — just confirm it's turned on.
- **Watch your host's usage dashboard** so you're not surprised by a bill —
  free tiers usually have limits on hours/requests per month.

---

## Phase 6 — Email, so the "Talk to Us" and "Show Interest" forms actually reach you

The forms currently open the visitor's email client addressed to
`@zenzafid.com` inboxes that don't exist yet. Set up real ones:

- **Google Workspace** (workspace.google.com) — $6–7/user/month, gives you
  `hello@zenzafid.com` etc. with the full Gmail interface, calendar, and
  Drive. Easiest for a small team.
- **Zoho Mail** — a cheaper alternative (free tier for a small number of
  users, paid plans from ~$1/user/month), good if budget is the main
  constraint right now.

Once set up, point your domain's MX records at whichever provider you
choose (they'll give you exact instructions), then update the `mailto:`
addresses in `welcome.html`, `investors.html`, and `careers.html` to match.

---

## Phase 7 — Growing beyond one site

As Zenza Technology takes on more products, a few habits keep this
manageable instead of turning into four unrelated codebases:

- **Reuse the design system.** `assets/theme.css` and the component patterns
  in it (`.card-grid`, `.row-index`, `.tag`, `.timeline`, the light/dark
  toggle) are written to be product-agnostic. Starting a new product site by
  copying `assets/` and swapping the page-specific content is faster and
  keeps every Zenza Technology property visually consistent — see
  `02-brand-guide/design-system-code/` in this package.
- **One GitHub organization, one repo per product.** Keeps access control
  and history clean as the team grows.
- **A shared password manager** (1Password or Bitwarden, both have team
  plans from a few dollars/user/month) for domain registrar, hosting, and
  email credentials — avoids the classic startup failure mode of one
  person holding every login.

---

---

## Phase 8 — Deploying the product app (zenza-fid-app) alongside this site

Everything above this point covers the Zenza Technology marketing site
(`zenza-tech-site`, formerly referred to as just "this site"). The actual
product — the fraud-intelligence console (`zenza-fid-app`) — is a separate
application with its own real database (entities, watchlist, audit log,
user accounts), and it should be deployed as its own service, not merged
into this one.

**The short version:**
- Put the product on its own subdomain: `app.zenzatech.com`, while this
  site stays on `zenzatech.com` itself.
- Deploy it the same way as this site (Render/Railway/Fly.io/VPS), but as a
  separate service with its own persistent volume for
  `data/zenza_fid.db` — losing that file means losing real
  fraud-intelligence records, so treat its backup discipline as more
  important than this site's.
- HTTPS is not optional for the product app the way it's merely
  recommended here — the app's "Install as PWA" feature requires HTTPS to
  function at all (browsers block service workers on plain HTTP everywhere
  except `localhost`).

Full detail — DNS setup, the subdomain architecture, and what the PWA
install experience needs — is in `docs/INTEGRATION-AND-DEPLOYMENT.md`
inside the `zenza-fid-app` package.

---

## Phase 9 — Zenza Inc.: the parent company site

There's a third site: `zenza-inc-site`, the holding company's own site,
which sits **above** everything in this guide, on the root brand domain.

```
zenzainc.com              → Zenza Inc. (holding company)
zenzatech.com              → Zenza Technology (this guide's main subject)
app.zenzatech.com           → the Zenza FID product console
```

Deploy `zenza-inc-site` exactly the same way as the Zenza Technology
site — it's static HTML, no database, no server-side logic, so it's
actually the simplest of the three to host (even a plain static host like
Netlify or Vercel works fine for it, no Node runtime required, unlike the
other two).

**One cross-linking step to do once all three domains are live:** open
`zenza-inc-site/index.html` and `zenza-tech-site`'s pages, and confirm the
`https://zenzatech.com` and `https://zenzainc.com` links actually resolve —
they're placeholders until the real domains are connected, same as every
other placeholder link called out earlier in this guide.

---

## Phase 10 — ZenVest: a second product, same site, different email identity

ZenVest is Zenza Technology's second product. Unlike Zenza FID, it does not
yet have its own product application to deploy — its three pages
(`zenvest-welcome.html`, `zenvest-investors.html`, `zenvest-careers.html`)
already live inside `zenza-tech-site`, deployed as part of that same
service. There's nothing extra to host for ZenVest today.

**Why its contact emails use a different domain than the site.** ZenVest's
pages use `@zenvest.africa` addresses (`hello@zenvest.africa`,
`careers@zenvest.africa`, `invest@zenvest.africa`) even though the pages
themselves are served from `zenzatech.com`. This mirrors the same pattern
already used for Zenza FID (`@zenzafid.com` addresses on pages served from
`zenzatech.com`) — each product keeps its own recognizable email identity,
independent of which domain is actually hosting its marketing pages. When
you set up real inboxes (Phase 6), you can either register `zenvest.africa`
as its own domain purely for email (no site needs to live there), or
simplify by moving these to `@zenzatech.com` addresses instead — both work
technically; it's a branding decision, not a hosting one.

```
zenzainc.com                → Zenza Inc.
zenzatech.com                 → Zenza Technology (portfolio hub + both products' pages)
app.zenzatech.com              → Zenza FID's product console (built, deployed separately)
(no subdomain yet)              → ZenVest — no product app built yet; will likely follow
                                  the same app.zenzatech.com pattern (e.g. a distinct path
                                  or its own subdomain) once one exists
```

**When ZenVest gets its own product app**, deploy it the same way Zenza FID's
was — its own service, its own persistent database volume, HTTPS required
if it becomes a PWA — following the exact same steps as Phase 8 above,
just for a different codebase.

---

## Rough cost summary (early stage)

| Item | Monthly cost (approx.) |
|---|---|
| Domains (zenzainc.com + zenzatech.com) | ~$2/mo (billed yearly) |
| Zenza Inc. site hosting (static, e.g. Netlify/Vercel free tier) | $0/mo |
| Zenza Technology site hosting | $0–7/mo |
| Product app hosting (separate service, same tier options) | $0–7/mo |
| Persistent storage add-ons (one per app with a database) | $2–4/mo |
| Email (Zoho, small team) | $0–5/mo |
| Uptime monitoring | $0 (free tier) |
| **Total to start, all three sites live** | **roughly $5–25/month** |

This stays cheap until you have real usage — which is exactly when it's
worth upgrading pieces one at a time, in the order this guide lays them out.
