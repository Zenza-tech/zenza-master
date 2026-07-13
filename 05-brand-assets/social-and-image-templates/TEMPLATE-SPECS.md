# Template Files — Specs & How to Use Them

Every file in this folder is an SVG opened directly in Figma, Illustrator, or
any vector editor. Each one is already set to the exact pixel dimensions
required for its platform, in the brand's dark navy background with the
node/network motif already in place, so you're designing *into* the brand
system rather than starting from a blank canvas.

**Important:** every guide element (safe zones, clear-space boxes, size
labels, dead-zone circles) is drawn in bright pink (`#FF3399`) and grouped
with an id starting in `guide-` — for example `id="guide-safezone"`. These
are instructions, not part of the design. **Delete every `guide-` group
before final export.**

---

## Files

| File | Dimensions | Use |
|---|---|---|
| `logo-lockup-canvas.svg` | 1200×800 | Construction grid for designing the logo mark + wordmark lockup. Shows clear-space requirements and a sample wordmark in the correct typeface/weight for reference. |
| `app-icon-template.svg` | 1024×1024 | Master app icon canvas. Shows both the iOS full-bleed square and the Android adaptive-icon safe zone (inner 66% circle) — keep the mark inside the circle so it isn't clipped on Android. |
| `favicon-size-reference.svg` | — (reference only) | Not a canvas to design in — shows every size you need to export once the icon is final: 16, 32, 48, 180, 192, and 512px. Export each from the finished app icon. |
| `og-link-preview-template.svg` | 1200×630 | The image that shows up when a Zenza FID link is shared on WhatsApp, LinkedIn, Slack, iMessage, etc. Keep all text inside the marked safe zone — some platforms crop the edges. |
| `social-linkedin-banner-template.svg` | 1584×396 | LinkedIn company page banner. Note the marked circle bottom-left — that's where the profile photo overlaps the banner on both desktop and mobile; keep important text out of it. |
| `social-x-header-template.svg` | 1500×500 | X (Twitter) profile header. Same avatar-overlap consideration, marked bottom-left. |
| `social-instagram-post-template.svg` | 1080×1080 | Standard square post template for Instagram/Facebook/LinkedIn feed posts. |
| `social-story-template.svg` | 1080×1920 | Instagram/TikTok/Facebook Stories template. Top and bottom ~220px are reserved as safe zones — the app's own UI (profile bar, reply field) sits over those areas. |

---

## Suggested next templates to build once the logo is final

These weren't pre-built because they depend on the finished logo, but are
worth planning for:
- **Email signature banner** (600×150 or similar — check your email
  provider's recommended size)
- **Pitch deck cover slide** (1920×1080, 16:9) — reuse the OG-image
  composition as a starting point
- **Business card** (print, 3.5×2in / 89×51mm at 300dpi) — low priority
  pre-launch, but easy to produce once the logo lockup exists
- **YouTube channel art** (2560×1440, with the same-idea safe-zone
  consideration as the social banners above)

---

## Color and type reminders while designing

See `../02-visual-identity.md` for full detail — the essentials:

- Background: `#0A1420` (dark navy) — all templates already use this.
- Primary accent: `#16B8A6` (teal).
- Secondary accent: `#E0A930` (amber) — use sparingly, as a highlight only.
- Headings: Space Grotesk, 600–700 weight.
- Body/supporting text: IBM Plex Sans.
- Small labels/data: IBM Plex Mono.

All three fonts are free on Google Fonts — no licensing to sort out.
