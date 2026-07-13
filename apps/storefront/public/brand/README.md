# public/brand — Holo Trail logo assets

`BrandLogo` (`components/brand/brand-logo.tsx`) looks for the SVG assets below.
Until they exist, it renders an accessible Barlow Condensed text wordmark, so
the storefront never breaks.

Scott must add the **real** approved logo files (do not reconstruct them from
screenshots or the guidelines) at exactly these paths:

| Path                          | Use                                            |
| ----------------------------- | ---------------------------------------------- |
| `public/brand/logo-primary.svg` | Full logo for light/cream surfaces           |
| `public/brand/logo-on-navy.svg` | Full logo for navy / dark-contrast surfaces  |
| `public/brand/logo-icon.svg`    | Square icon / app mark                        |
| `public/brand/wordmark.svg`     | Wordmark only                                 |

Guidance:

- Prefer SVG for crisp scaling.
- Keep transparent backgrounds.
- `logo-on-navy.svg` should read clearly on `--ht-navigation` (#121C30).
- After adding assets, no code change is needed — `BrandLogo` picks them up.
