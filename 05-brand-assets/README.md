# Zenza — Brand Assets

## Start here

1. **`01-brand-strategy.md`** — the company structure (Zenza Inc. →
   Zenza Technology → Zenza FID), mission, voice & tone, audiences.
2. **`02-visual-identity.md`** — colors, typography, and the finalized
   logo documentation (Section 3).
3. **`logos/`** — the actual editable logo files. Start here if you just
   need the logo right now.
4. **`design-system-code/`** — open `style-guide-preview.html` in a
   browser to see the Zenza Technology color/type/component system live.
5. **`social-and-image-templates/`** — canvas templates at the correct
   dimensions for social media, favicons, and app icons.

## The ZenVest brand variant — "Create Wealth Together"

ZenVest (Zenza Technology's second product) shares the exact same
component system as Zenza FID — same buttons, cards, tags, nav, timeline,
light/dark/auto toggle — but with a deliberately different accent: warm
gold and emerald instead of teal and navy. Same family, different feeling:
prosperity and growth instead of security and precision.

This isn't a separate stylesheet — it's four CSS custom-property overrides
in `theme.css`, applied by adding `data-brand="zenvest"` to a page's
`<html>` tag:

```html
<html lang="en" data-brand="zenvest">
```

| Token | Zenza FID (default) | ZenVest |
|---|---|---|
| Primary accent (dark mode) | `#16B8A6` teal | `#D4A73E` gold |
| Primary accent (light mode) | `#0E8C82` | `#9C7A1E` |
| Secondary accent (dark mode) | `#E0A930` amber | `#2E9E6B` emerald |
| Secondary accent (light mode) | `#C9922A` | `#1F7A52` |

`zenzatech-icon-transparent-gold.svg` in `logos/` is the gold-recolored
version of the ZenzaTech mark, used in ZenVest's nav bar (SVG icons use a
hardcoded stroke color rather than `currentColor`, so a matching gold
variant was generated rather than relying on CSS alone).

**See it live:** open `design-system-code/style-guide-preview.html` and
toggle "ZenVest" at the top — every component swaps color instantly, same
CSS, one attribute.

**Extending to a third product:** duplicate the pattern — pick a new accent
pair, add a `data-brand="yourproduct"` block to `theme.css` following the
ZenVest example above.

## The official ZenzaTech logo

This is the current, official mark for Zenza Technology — a circle
bisected by an extending horizontal line, paired with the `ZENZATECH`
wordmark and the mission tagline **"Innovate to Solve Problems."** It
replaces the earlier placeholder ZenzaTech mark from the first brand pass.

| File | Background | Use |
|---|---|---|
| `zenzatech-logo-navy.svg` | Navy | Full lockup, silver/white ink — matches the original found design most closely |
| `zenzatech-logo-navy-teal.svg` | Navy | Full lockup, teal ink — ties into the rest of the brand's teal accent system; used as the primary hero lockup on the Zenza Technology site |
| `zenzatech-logo-light.svg` | White | Full lockup, teal-dark ink — light mode |
| `zenzatech-logo-transparent-white.svg` / `-teal.svg` / `-ink.svg` | None | Full lockup, drop onto any surface |
| `zenzatech-icon-transparent-white.svg` / `-teal.svg` | None | Mark only, no wordmark — used for the nav bar, favicons, and the Zenza FID product app's PWA icons |
| `zenzatech-icon-navy-bg-teal.svg` | Navy | Mark only, filled background — app-icon style |

**Typeface note:** the wordmark uses **Michroma** (free on Google Fonts) —
its geometric, evenly-weighted letterforms are a close match to the
original found lockup. The tagline uses IBM Plex Mono, consistent with the
rest of the system.

**Where this is already live:** the Zenza Technology site's navigation and
hero (`02-zenza-tech-site/index.html`), the Zenza FID product pages' nav
bars, and every PWA icon in the Zenza FID app
(`03-zenza-fid-app/public/icons/`) — regenerated with this mark, replacing
the earlier placeholder icon set.

## The Zenza Inc. logo (separate mark)

Zenza Inc.'s own logo — the dashed-circle badge with the mirrored
reflection and "EST 2022" — is unrelated to the ZenzaTech mark above and
still the current logo for the holding company. See the `zenza-inc-*`
files in this same folder.

**Note:** the reference material also showed this same circle-line icon
used on older merchandise mockups labeled "ZENZA INC" (t-shirt, sign,
business card, app icon — all dated September 2022). If you'd like the
holding company to adopt this mark too instead of the dashed-circle badge,
say so and it's a quick change — right now the two companies are kept on
their two distinct marks as most recently confirmed.

## The rest of the logo suite

| File | Company | Background | Notes |
|---|---|---|---|
| `zenza-inc-logo-dark.svg` | Zenza Inc. | Black | |
| `zenza-inc-logo-light.svg` | Zenza Inc. | White | |
| `zenza-inc-logo-cream-full.svg` | Zenza Inc. | Cream | Full lockup with tagline — the primary/hero version |
| `zenza-inc-mark-transparent-black.svg` | Zenza Inc. | None | Black ink, drop onto any light surface |
| `zenza-inc-mark-transparent-white.svg` | Zenza Inc. | None | White ink, drop onto any dark surface |
| `zenza-tech-logo-*.svg` | Zenza Technology (superseded) | — | The first-pass ZenzaTech mark, kept for reference — use the `zenzatech-*` files above instead |

All files are plain SVG — open directly in Figma, Illustrator, Inkscape, or
even a text/code editor (it's readable XML). Every color, every line, every
piece of text is a separate, editable element — nothing is a flattened
image.

## Extending this to future companies

Zenza Media, Zenza Advertising, Zenza Branding & Design, and ZenX
(Zenza's renewable-energy company) will each want their own mark
eventually. The fastest path: duplicate one of the `zenzatech-logo-*.svg`
files, swap the wordmark text and the accent color, and keep the circle+
line mark and lockup structure as-is — that's what makes the whole
portfolio read as one family without every company looking identical.
