# Design System Code — Reuse for Future Zenza Products

This folder contains the actual CSS and JS that power the Zenza FID website
— not a copy or a reference, the real source. Two ways to use it:

## 1. As a live reference for the designer

Open `style-guide-preview.html` in any browser (just double-click it — no
server needed for this one page). It renders every color, type style, and
UI component pulled directly from `theme.css`, with the Light/Dark/Auto
toggle working exactly as it does on the live site. This is the fastest way
to see the whole system at a glance, and it will always be accurate because
it's reading the same file the website reads.

## 2. As a starting point for a new product

When Zenza Technology builds its next product, copy `theme.css` and
`site.js` into that product's `assets/` folder as-is. Every future page can
then use the same building blocks already documented on the style guide
page — buttons (`.btn-primary`, `.btn-ghost`), cards (`.card-grid`, `.card`),
row lists (`.row-index`, `.row-item`), tags (`.tag.c-teal`, `.c-amber`,
`.c-red`, `.c-slate`), the timeline component, and the light/dark toggle —
without redesigning any of it from scratch.

To give a new product its own identity while staying visually part of the
Zenza Technology family, the lightest-touch option is to swap only the
`--teal` and `--amber` accent values in `theme.css` for a different hue
while keeping every other token the same — the whole component library
picks up the new accent color automatically, everywhere it's used.

**This is no longer just a suggestion — it's exactly how ZenVest (Zenza
Technology's second product) was built.** See the `[data-brand="zenvest"]`
block near the end of `theme.css` for the real, working example: four
color overrides, applied via one HTML attribute, and every button/card/tag
across ZenVest's three pages picked it up with zero other changes. Use that
block as the literal template for the next product's brand variant.

## Files in this folder

| File | Purpose |
|---|---|
| `theme.css` | All design tokens (colors, type, spacing) + every shared component |
| `site.js` | Theme toggle logic + scroll-reveal + nav active-state |
| `style-guide-preview.html` | Visual reference — open in a browser |
