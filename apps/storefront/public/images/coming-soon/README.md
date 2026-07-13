# public/images/coming-soon — hero image placeholder

The coming-soon page's image area (`components/coming-soon/hero-visual.tsx`)
looks for one file:

    public/images/coming-soon/hero-placeholder.webp

- **If it exists**, it leads the image area (rendered with `next/image`).
- **If it is absent**, the page shows an intentional branded visual treatment
  (navy panel + signal trail) instead — never a broken image.

Scott must supply an **approved, royalty-free, collector/card-related** image
here (real hobby/product photography is preferred per Brand Guidelines v3).
Do not add copied Pokémon character artwork or fake product photography.

Recommended: a landscape `.webp`, roughly 1200×1200 or wider, optimised for web.
After adding the file, no code change is needed — the page picks it up.
