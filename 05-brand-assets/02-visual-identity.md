# Zenza Technology — Visual Identity

These are not suggestions to choose from — this is the system already live
on the website. The designer's job is to extend it into a logo, social
presence, and marketing materials that feel like they belong to the same
product, not a separate design pass done later.

---

## 1. Color palette

The site runs in two modes (light/dark), and every color has a defined
counterpart in both. Use the exact hex values below — don't eyeball them
from a screenshot.

### Dark mode (default)

| Token | Hex | Use |
|---|---|---|
| Background | `#0A1420` | Page background |
| Background (alt) | `#0F1D2E` | Secondary surfaces |
| Panel | `#122436` | Cards, hovered rows |
| Text | `#DCE3EA` | Body text |
| Text (dim) | `#8B96A8` | Secondary/supporting text |
| Heading | `#F3F5F7` | Headings, high-emphasis text |
| **Teal (brand primary)** | `#16B8A6` | Buttons, primary accents |
| Teal (text variant) | `#2DD4C4` | Small text/links on dark backgrounds |
| **Amber (brand secondary)** | `#E0A930` | Secondary accents, highlights |
| Amber (text variant) | `#F0C068` | Small text on dark backgrounds |
| **Red (alert/enterprise accent)** | `#C9503A` | Warnings, "enterprise" tier tags |
| Red (text variant) | `#E07056` | Small text on dark backgrounds |
| Slate | `#6B7A8F` | Neutral tags (e.g. "intern") |

### Light mode

| Token | Hex | Use |
|---|---|---|
| Background | `#FFFFFF` | Page background |
| Background (alt) | `#F5F6F8` | Secondary surfaces |
| Panel | `#F0F2F4` | Cards, hovered rows |
| Text | `#2B333D` | Body text |
| Text (dim) | `#5B6675` | Secondary/supporting text |
| Heading | `#0B1420` | Headings |
| **Teal** | `#0E8C82` | Buttons, primary accents |
| Teal (text variant) | `#0B7A70` | Small text/links on light backgrounds |
| **Amber** | `#C9922A` | Secondary accents |
| Amber (text variant) | `#9C6E15` | Small text on light backgrounds |
| **Red** | `#B23D28` | Warnings, "enterprise" tags |
| Red (text variant) | `#9C3220` | Small text on light backgrounds |

**Why teal-and-amber:** teal reads as trustworthy/technical without being a
generic "fintech blue"; amber is used sparingly as a signal color (alerts,
highlights, secondary CTAs) — think of it as the color of attention, used
the way a highlighter is used, not a wash. Red is reserved for the
"enterprise/highest stakes" tier and warnings — it should never dominate a
layout.

**For the designer:** logo, favicon, and primary social avatar should
default to using the **dark-mode teal (`#16B8A6`)** as the primary brand
color, since it's the more distinctive of the two modes and will be the
default most people see first. Provide a light-mode-compatible variant
(`#0E8C82`) for use on white backgrounds (letterhead, printed materials).

---

## 2. Typography

Three typefaces, each with one job — don't introduce a fourth without
updating this document and the website together.

| Role | Typeface | Weights used | Where |
|---|---|---|---|
| **Display / Headings** | Space Grotesk | 500, 600, 700 | All headings, logo wordmark candidate |
| **Body** | IBM Plex Sans | 400, 500, 600, 700 | All paragraph text, buttons, nav |
| **Utility / Data** | IBM Plex Mono | 400, 500 | Labels, tags, stats, eyebrows, timestamps |

All three are free/open-source (Google Fonts), so there's no licensing cost
for print materials, social graphics, or a future mobile app.

**Type personality:** Space Grotesk gives headings a slightly technical,
geometric character without being cold — it's confident without shouting.
IBM Plex Mono for small labels reinforces the "intelligence/data" feeling of
the product (it's the same family used for things like case IDs and
timestamps in the product itself). Keep this pairing in any new materials —
it's a meaningful part of how the brand reads as credible to a technical
buyer while staying approachable to a general one.

---

## 3. Logo — finalized

Unlike the rest of this document, the logo is no longer a brief — Zenza
Inc.'s logo already exists (the founder's original design) and has been
recreated as an editable vector, with a companion Zenza Technology mark
built on the same template. Both live in `04-brand-assets/logos/`.

**The template, shared by both marks:**
- A dashed circle enclosing a bold wordmark, underlined
- A faint mirrored reflection of the wordmark beneath it, fading out —
  the signature visual trick that makes this logo distinctive rather than
  a generic circular badge
- A subline beneath the circle anchoring the mark to its place in the
  company structure

**Zenza Inc.** — `ZENZA INC.` wordmark, subline `EST 2022`, in black,
white, or cream depending on background. This is the parent mark: neutral,
editorial, not tied to any one product's color story.

**Zenza Technology** — same template, recolored into the brand's teal
(`#16B8A6` on dark, `#0E8C82` on light), wordmark `ZENZA TECH`, subline `A
ZENZA INC. COMPANY` — the subline itself encodes the hierarchy directly
into the logo lockup, which is deliberate: anyone who sees the Zenza Tech
mark on its own still sees which company it belongs to.

**Files provided** (all SVG — infinitely scalable, editable in
Figma/Illustrator/Inkscape without any loss of quality):

| File | Use |
|---|---|
| `zenza-inc-logo-dark.svg` | Zenza Inc., black background |
| `zenza-inc-logo-light.svg` | Zenza Inc., white background |
| `zenza-inc-logo-cream-full.svg` | Zenza Inc., cream background, full lockup with tagline — the primary/hero version |
| `zenza-inc-mark-transparent-black.svg` / `-white.svg` | No background — drop onto any color |
| `zenza-tech-logo-dark.svg` | Zenza Technology, navy background |
| `zenza-tech-logo-light.svg` | Zenza Technology, white background |
| `zenza-tech-logo-navy-full.svg` | Zenza Technology, full lockup with tagline |
| `zenza-tech-mark-transparent-teal.svg` / `-white.svg` | No background — drop onto any color |

**What still needs a designer's hand:** these are faithful, precise vector
recreations of the existing design — correct proportions, correct type,
correct color — but a designer should still review kerning/optical spacing
by eye, and this template is the natural starting point (not necessarily
the final word) for the remaining companies as they launch: Zenza Media,
Zenza Advertising, Zenza Branding & Design can each get the same treatment
in their own accent color once their identity is ready to lock in.

**Practical notes carried over from the original brief:**
- Legible at 16×16px (already confirmed via the generated favicon set — see
  `zenza-fid-app/public/icons/`).
- Works as a single-color mark (the transparent variants) as well as on a
  filled background.
- Works in both light and dark contexts by design — that's the point of
  having dark/light/transparent variants of every mark.

---

## 4. Imagery style (photos, illustrations, icons)

- **No stock-photo clichés.** Avoid generic "hooded hacker," "handshake over
  a desk," or "abstract binary code" imagery — none of it is specific to
  what Zenza actually does, and this category of image is an instant signal
  of a templated brand.
- **If using photography:** real environments over posed stock — offices,
  African cities, banking halls — feels more credible than generic global
  stock photography. Until real photography exists, prefer the abstract
  network/node motif (already used in the website's hero animation) over
  any photography at all.
- **Iconography:** simple, single-weight line icons (not filled/glyph style)
  to match the restrained, technical feel of the type system. If you need a
  starting icon set, Lucide (lucide.dev, free/open-source) matches this
  style well and is already compatible with the website's tech stack.
- **The node/network motif** (dots connected by thin lines, one occasionally
  highlighted) is the site's existing signature visual — reuse it
  deliberately across marketing materials rather than introducing a new
  visual metaphor. See the animated hero on `investors.html` for the
  reference implementation.

---

## 5. Do's and Don'ts summary

**Do:**
- Keep teal as the dominant brand color everywhere.
- Use amber sparingly, as a highlight, never as a dominant background.
- Keep generous white space / dark space — the brand should never feel
  cluttered.
- Use monospace type for anything that reads as "data" (numbers, labels,
  dates).

**Don't:**
- Don't introduce a gradient-heavy, glossy "AI startup" aesthetic — it
  undercuts the "trustworthy, serious" positioning.
- Don't use red as a primary/dominant color anywhere — it's reserved for
  alerts and the "highest tier" accent only.
- Don't stretch, recolor outside the palette, or add drop shadows/bevels to
  the logo once finalized.
