# public/brand — Holo Trail logo assets

`BrandLogo` (`components/brand/brand-logo.tsx`) uses the real approved PNG assets
below. If an asset ever fails to load it falls back to an accessible Barlow
Condensed text wordmark, so the storefront never breaks.

Assets in use (supplied by Scott):

| Path                                         | `BrandLogo` usage           |
| -------------------------------------------- | --------------------------- |
| `holotrailtcg-full-logo.png`                 | `variant="primary"` (light) |
| `holotrailtcg-full-logo-reverse.png`         | `variant="primary"` (navy)  |
| `holotrailtcg-text-logo.png`                 | `variant="wordmark"` (light)|
| `holotrailtcg-text-logo-reverse.png`         | `variant="wordmark"` (navy) |
| `holotrailtcg-icon-logo.png`                 | `variant="icon"` (light)    |
| `holotrailtcg-icon-logo-reverse.png`         | `variant="icon"` (navy)     |

Notes:

- "reverse" variants are for navy/contrast surfaces (`--ht-navigation` #121C30).
- If higher-resolution or SVG versions are produced later, replace the files at
  the same paths (or update the `LOGO_ASSETS` map in `brand-logo.tsx`).
- `placeholders/` holds legacy reference images from the asset migration; they
  are not wired into the coming-soon UI.
