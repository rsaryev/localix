# AGENTS.md

Instructions for AI coding agents working on this repository.

llx-sitekit is a template: a landing page and docs site that product sites are cloned from and
keep merging. Read `content/docs/structure.md` before a change; it is short.

## Rules

- **Know whose file it is.** `content/`, `public/` and `README.md` are a site's own. `src/`,
  `scripts/` and the root's configs are the template's. In a site (the remote `template` exists),
  change the template's half only when asked to: prefer `content/theme.css`, a content file, or a
  new slice, since a file both sides changed is a conflict at the next sync. In the template, a
  change reaches every site, so keep it general: no product's name or copy in `src/`.
- **Feature-Sliced Design, strictly.** Layers: `app` → `pages` → `widgets` → `features` →
  `entities` → `shared`. Import only downward, never between slices of one layer, and only
  through a slice's `index.ts`. `npm run lint` checks it; never work around it.
- **Tokens only.** A colour, a font, the radius and the gutter are custom properties of
  `src/shared/styles/global.css` and `syntax.css`; the lint refuses a hex colour in any other
  stylesheet. Styles are plain CSS beside the component, with class names that start with the
  component's own.
- **The docs stay static.** Nothing a browser loads may import `entities/doc`. A docs page gets
  only `src/app/entry-docs.ts`.
- **Content is data.** Copy never lives in a component: a landing section is a field of
  `LandingContent` in `src/shared/config/types.ts`, a widget, and a line in
  `src/pages/landing/LandingPage.tsx`.
- **A component has a specimen.** Anything added to `src/shared/ui`, `features/` or `widgets/`
  is shown on the kit page (`src/pages/kit/Components.tsx`); a new token is listed in
  `src/pages/kit/tokens.ts` and in `content/docs/theming.md`.
- **Accessible by construction.** Text at least 4.5:1 on its ground (the kit page measures it),
  everything pressable a link or a button with the one focus ring, targets at least 36 px,
  nothing moving under `prefers-reduced-motion`, no sideways scroll at 390 px.
- No file over 300 lines. Comments say why. English only.
- **Docs follow the standard.** A page of `content/docs/` is a file named in lower-case words
  joined by hyphens, one `#` title, a paragraph after it (its description), sections `##` then
  `###` with no level skipped, and its name once in `content/docs/nav.ts`. Link to another page
  by its file (`deploy.md#github-pages`). The build refuses anything else and makes the menu,
  the index, the search, the sitemap, `llms.txt` and the landing's list from it: never write
  one of those by hand.
- **Workflows are the template's.** `.github/workflows/` holds `check.yml`, `deploy.yml`
  (GitHub Pages, once on) and `sync.yml` (the template's updates as a pull request). Pin an
  action by its major version, give a job only the permissions it uses, and run `actionlint`
  on a change. Never commit to `main` from a workflow, and never put a secret in one.

## How to

| Task | Where |
| --- | --- |
| Change what the site says | `content/site.ts`, `content/landing.ts`; the types in `src/shared/config/types.ts` say every field. |
| Add a docs page | A file in `content/docs/`, its name in `content/docs/nav.ts`. See `content/docs/writing-docs.md`. |
| Change a colour or a shape | `content/theme.css` in a site; `src/shared/styles/global.css` in the template. |
| Add a section to the landing | A field of `LandingContent`, a widget in `src/widgets/`, a line in `LandingPage.tsx`, a specimen on the kit page, a paragraph in `content/docs/landing.md`. |
| Add a release | A `## x.y.z` heading in `CHANGELOG.md` (a date may follow: `## 1.2.0 - 2026-01-31`); the landing's list reads it at build time. |
| Take the template's updates | `npm run sync` in a site; `CHANGELOG.md`'s **Migration** notes say what to change. |
| Publish | Push to `main`. See `content/docs/deploy.md`. |

## Before you say it is done

```sh
npm run check
```

A failure names the file and the rule; fix what it names, never the check. Then look at what you changed at a phone's width (390 px) and a laptop's: `npm run dev`, the
landing, a docs page, and `/kit`. The checks do not see the page. In the template, add a line to
`CHANGELOG.md`, with a **Migration** note when a site has to change its content.
