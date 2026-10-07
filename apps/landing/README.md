# @localixai/landing

Marketing + documentation site for **localix.ai**. A standalone Vite + React app that **reuses the
product's design system** (it never forks the look):

- `src/styles.css` imports `apps/ui/src/app/index.css` by relative path, so every color token, font,
  keyframe and base reset is the single source the chat workspace uses.
- The page declares a dark theme in `index.html`; it does not offer the workspace's theme switcher.
- The hero uses the product's `BirdStage` component through the `@ui` alias, with the shared logo.

## Auto-collected docs

Public navigation is explicit. `docs/public-nav.json` lists the exact pages, order, sections, and
feature categories that the site may publish. `apps/landing/scripts/build-docs.mjs` validates that
manifest and emits a small navigation module plus one lazy content module per page under
`src/generated/`. Unlisted implementation notes remain in the repository without leaking into search
or the sitemap. Opening a deep link loads only that page body; the first search loads all public
page modules and retains exact full-text search semantics. Generation runs through the `predev` and
`prebuild` hooks.

Product screenshots are evidence, not mockups. `apps/landing/scripts/build-shots.mjs` includes only
dated 1600×1000 PNGs or their native 2×/3× captures from the canonical
`docs/assets/screenshots/<feature>/` tree. Missing captures remain documented gaps and are not
presented as product proof on the homepage.

## Commands

```bash
bun run dev        # dev server on http://localhost:5173 (regenerates docs first)
bun run build      # type-check + production build to dist/
bun run docs:gen   # regenerate the docs manifest, lazy page modules, and sitemap
bun run shots:gen  # validate and index real product screenshots
```

From the repo root: `bun run dev:landing` / `bun run build:landing`.

## Deploy

The site uses browser routes. Production builds emit a page-specific static HTML shell for every
generated `/docs/<slug>` route, so canonical URLs, descriptions, and social metadata are available
before JavaScript runs. The static page uses the same header, rails and article column as the
client. A public JSON bootstrap keeps that article visible while the interactive Markdown chunk
loads; subsequent pages reserve their geometry with kit skeletons. The included host configs map
only known generated docs pages; an unknown docs URL remains a real 404 instead of silently
rendering the home page.

Configs included:

- **Netlify** — `netlify.toml` (base `apps/landing`, publish `dist`).
- **Vercel** — `vercel.json`.
- **Docker/nginx** — `Dockerfile` (build from the repo root:
  `docker build -f apps/landing/Dockerfile -t localix-landing .`).

Point the `localix.ai` DNS at whichever host you choose; the production OG/meta tags already
reference `https://localix.ai/`.

## Markdown rendering

The docs client and static build use `@localixai/markdown`, the same grammar as the workspace.
`src/pages/docs/markdownComponents.tsx` owns repository links, capture resolution and code blocks;
`docsNav.tsx` owns navigation grouping. Typography and rails stay in the landing stylesheet.

See [Shared Markdown](../../docs/extending/markdown.md) for live examples and package ownership.

The documentation offers a focus mode and text-size menu. Its shared site header uses the same black
ground as the landing; code blocks reuse the kit glass material and syntax palette.
