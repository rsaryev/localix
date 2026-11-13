# The site

The landing page and the docs of Localix Studio, published at studio.localix.ai, as a folder of
the product's repository. It was made from the llx-sitekit
template (its commit `6d1d483`) and keeps the template's layout, so [AGENTS.md](AGENTS.md) here
holds for every change in this folder.

```sh
cd site
bun install
bun --bun run dev      # http://localhost:5173
bun --bun run check    # the layers, the types, the build, the docs' standard
```

## What is whose

| Path | Owner | |
| --- | --- | --- |
| `content/` | the site | `site.ts` (name, address, the build to download), `landing.ts` (the landing's words, the window's stills and the demo), `docs/nav.ts` (the docs' table of contents), `theme.css` (the accent) |
| `public/` | the site | the icons, the link-preview picture and its source `og-card.html`, the stills in `shots/`, the demo in `films/`, `llms.txt`, `robots.txt`, `_headers`, the API catalog |
| `../docs/` | the product | the docs themselves, and `public-nav.json`, the list of the pages the site publishes |
| `CHANGELOG.md` | the product | a link to the repository's own changelog, which the landing's releases are read from |
| `src/`, `scripts/`, the configs | the template | change one only where the site cannot say it in `content/` |

## What differs from a site cloned from the template

- **It has no repository of its own.** `content/site.ts` says so with `sourceDir: 'site'`, which
  `sourceUrl` in `src/shared/config/index.ts` puts into a page's "Edit on GitHub" and into a
  docs link to a repository file.
- **Its docs are the repository's**, in `../docs`, where the app and the contributors read them
  too. `content/docs/nav.ts` names that folder (`dir`) and turns `docs/public-nav.json` into the
  template's groups. A page in a folder is reached at its path with `--` for the slash
  (`docs/features/delegation.md` at `/docs/features--delegation`), the addresses the site has
  always had; a picture of the docs is served at its path under `/docs/`.
- **It runs on Bun**, as the whole repository does: `bun.lock`, no `package-lock.json`.
- **Its workflow is the repository's**, `.github/workflows/landing.yml` (Website Deploy): a
  workflow in a folder never runs, so the template's three are not here.
- **What it adds to the template**, each the template's way, with a specimen on `/kit`:
  - `features/clip`: a short silent clip, in the hero (`hero.clip`) or beside a card;
  - the roster's `limit` (`docs.limit` in `landing.ts`), for docs too many to list whole;
  - docs in a folder outside the site (`DocsConfig.dir`), in folders of their own.
- **`npm run sync` does not apply.** It merges the template's branch into a repository's root,
  and `package.json` names no template to merge from.
  Until the template can sync into a folder, an update of the template is carried over by hand:
  its `CHANGELOG.md` lists what changed and what a site has to change.

## Publishing

Website Deploy is run by hand, and by the release workflow once a release is published: the
check, then `dist/`, with the third-party notices of what it ships, to the Cloudflare Pages
project `localix-studio`.
