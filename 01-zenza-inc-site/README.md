# Zenza Inc. — Website

The holding company's own site. Static HTML, no server, no database, no
build step — the simplest thing in this whole package to run or edit.

## What's in here

```
index.html    The entire site — hero, philosophy, company portfolio, footer
assets/
  zenza-inc-logo-cream-full.svg          Primary logo lockup (cream background, with tagline)
  zenza-inc-mark-transparent-black.svg    Mark only, for light backgrounds
  zenza-inc-mark-transparent-white.svg    Mark only, for dark backgrounds
```

## Running it locally

There's nothing to install or start. Just open `index.html` directly in a
browser — double-click it, or drag it into a browser window.

If you'd rather serve it properly (closer to how it'll behave once hosted,
e.g. for testing relative links), any static file server works:

```bash
npx serve .
# or
python3 -m http.server 8080
```

## Editing this page

Everything is in the one `index.html` file — the CSS is inline in a
`<style>` block at the top rather than a separate stylesheet, since this
page intentionally does **not** share the teal/navy design system used by
Zenza Technology and its products. It has its own palette (cream, black,
white) reflecting the actual Zenza Inc. logo — see
`../05-brand-assets/02-visual-identity.md` for the full color/type
reference if you're extending this page.

## Where this fits

This is the top of the site hierarchy — the only page in the whole package
with links pointing *down* into Zenza Technology (`zenzatech.com`) rather
than sideways to a sibling product. See the root `README.md` for the full
domain structure.

## Before hosting this live

- The `https://zenzatech.com` links throughout this page are placeholders
  until that domain is actually deployed — see
  `../06-hosting-and-scaling-guide/`.
- `hello@zenzainc.com` in the footer is a placeholder inbox — replace with
  a real one before launch.
