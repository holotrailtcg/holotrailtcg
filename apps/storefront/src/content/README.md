# content

Replaceable page copy and configuration lives here, kept out of components so
wording can change without touching UI code. Import via the `@content/*` alias.

Rules:

- No business logic — data and copy only.
- Generic UI components must not embed page-specific copy; pass it in from here.
- Stage 2A intentionally ships no page copy; this folder is prepared for later
  stages (e.g. the coming-soon page).
