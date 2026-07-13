# components/coming-soon

Coming-soon feature components (Stage 2B). These compose the Stage 2A shared
primitives — they do not redefine standard controls.

- `newsletter-form.tsx` — the page's single client island (form state + a11y).
- `hero-visual.tsx` — server component; image area with a branded fallback.

Page copy lives in `content/coming-soon.ts`; the form's submission seam lives in
`lib/newsletter`. See [docs/coming-soon.md](../../../../../docs/coming-soon.md).

Do not add newsletter backend logic, analytics or route gating here — those are
Stage 2C/2D/2E.
