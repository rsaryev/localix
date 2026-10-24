---
name: build-mini-app
description:
  Build a Localix mini app — its mini-app.json, guide.md, icon, native backend with register(ctx),
  ui/register.tsx screens, agent tools, commands, store media, tests, packing and catalogs. Use when
  creating, changing, checking or publishing a Localix mini app, inside Localix or in a checkout of
  the Localix repository.
---

# Build a Localix mini app

A **mini app** is Localix's own application format: screens for the person, a native backend, agent
tools over Localix's APIs, a guide for the agent and commands with pickers. It is not a Claude Code
plugin, and the two share nothing. A folder is one or the other: never put `.claude-plugin/`,
`skills/` or hooks in a mini app, and never put `mini-app.json` in a plugin. A folder with both
loads nothing.

**Trust:** a mini app's native backend runs unsandboxed in the Localix API process. One the agent
builds starts enabled, so keep its tools honest about their effects.

## Where you are

| Situation                                         | How you build                                                                                             |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Inside Localix (the `mini_app_build` tool exists) | Call `mini_app_build`; the host scaffolds, checks, builds and reloads under `~/.localix/mini-apps/<name>` |
| Plain Claude Code in a Localix checkout           | Copy `mini-apps/template` to `mini-apps/<name>` and use the repository's scripts                          |

Inside Localix, the person can also run `/mini-app create <what it should do>`, which starts a turn
that requires `mini_app_build`. After editing files yourself, `/mini-app reload` rebuilds the
person's own mini apps and reloads every mini app.

## The folder

```text
my-app/
  mini-app.json      name, version, apiVersion, category, backend, commands, settings
  guide.md           what the agent needs to know to use the app
  guide/             longer guide pages that guide.md links
  icon.svg           the app's icon in the store, the rail and its Mac app
  screenshots/       what the store page shows
  backend/index.ts   register(ctx): tools, hooks, backend, channels, memory
  ui/register.tsx    the screens
  shared/            code the backend and the UI both import
  README.md          optional: the store page's About
```

Every path in `mini-app.json` is relative to the folder and stays inside it.

## `mini-app.json`

The manifest is strict: unknown keys are refused, a plugin's `skills` or `hooks` among them.

| Field                         | Meaning                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `name`                        | Required. Letters, numbers, dashes or underscores; namespaces its tools and commands             |
| `version`, `description`      | Required. `version` is semver and the only thing updates compare                                 |
| `displayName`                 | The name people see; also `author`, `homepage`, `repository`, `license`, `keywords`              |
| `apiVersion`                  | Positive integer, currently `1`. Newer blocks loading; omitting it warns                         |
| `category`                    | One of `development`, `data`, `content`, `utilities`, `games`                                    |
| `surfaces`                    | Defaults to `['agent']`; add `workbench` for a screen                                            |
| `backend`                     | Native entrypoint(s) exporting `register(ctx)`; `mini_app_build` writes it, leave it alone there |
| `guide`                       | Defaults to `./guide.md`                                                                         |
| `config`                      | Settings delivered through `ctx.config`                                                          |
| `commands`                    | Map keyed by command name; see [Commands](#commands)                                             |
| `icon`, `screenshots`, `tags` | Store media; see [Store media](#store-media)                                                     |
| `views`                       | Up to 6 sandboxed HTML views, each `{ id, title, file, icon?, agentDescription? }`               |
| `promptSections`              | Up to 3 `{ title, content }` of static prompt text                                               |
| `contributions`               | Typed declarations, such as a native agent (`kind: "agent"`)                                     |
| `fileAssociations`            | File types for desktop packaging; inert for an installed app                                     |
| `private`                     | Keeps an authoring scaffold out of packaging                                                     |

A minimal manifest:

```json
{
  "name": "calorie-counter",
  "version": "0.1.0",
  "description": "Logs meals and their calories.",
  "apiVersion": 1,
  "category": "utilities",
  "backend": "./backend/index.ts"
}
```

A `config` option takes `type` (`string`, `number`, `boolean`, `directory` or `file`),
`description`, `required`, `secret`, `default`, `title`, `multiple`, `min` and `max`. A `secret`
value is only masked in API responses; use the vault host service when a backend needs a real
secret.

## `guide.md`

Plain Markdown for the agent: which tool does what, when to use it, and what to tell the person. The
prompt lists each enabled mini app in one line; the agent reads the guide with `mini_app_guide`
before it first uses the app. A tool's description says what it does; the guide says when to use it.
Put long material in pages under `guide/`.

## The backend

`backend/index.ts` exports `register(ctx)`. Import SDK types with `import type` from
`@localixai/mini-app-sdk/backend`; runtime values (`z`, `defineTool`, config, helpers, paths,
logging, UI intents) come from `ctx`.

```ts
import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { MiniAppContext } from '@localixai/mini-app-sdk/backend'

export function register({ z, defineTool, dataDir }: MiniAppContext) {
  return {
    tools: [
      defineTool({
        name: 'log_meal',
        activeVerb: 'Logging a meal',
        description: 'Record a meal the person ate, with its items and estimated calories.',
        inputSchema: z.object({ items: z.array(z.string()), calories: z.number() }),
        mutates: true,
        classify: () => ({ effect: 'host' }),
        async execute(_toolCallId, input) {
          const entry = { at: new Date().toISOString(), ...input }
          await appendFile(join(dataDir, 'meals.jsonl'), `${JSON.stringify(entry)}\n`)
          return { content: `Logged ${input.calories} kcal.` }
        },
      }),
    ],
  }
}
```

`register` may return:

| Field      | Effect                                                                         |
| ---------- | ------------------------------------------------------------------------------ |
| `tools`    | Model-facing tools; names cannot shadow built-ins                              |
| `hooks`    | Message and tool lifecycle hooks, each capped at five seconds                  |
| `backend`  | Routes, resource and search providers, context providers, completions, streams |
| `channels` | Long-running messaging bridges                                                 |
| `memory`   | One external memory provider                                                   |

Rules that keep a backend correct:

- Every tool declares its effect with `classify` (for example `host` for the app's own data), or a
  read-only session refuses even its reads. `execute` takes the call id, then the input.
- `register(ctx)` runs more than once: keep what a person creates under `ctx.dataDir` (one chat's
  data under `ctx.sessionStorage`), and a warm service at module scope.
- `ctx.host` and most of its services are optional; check before calling.
- An installed backend has no repository dependencies: use relative and built-in modules, or bundle
  dependencies and point `backend` at the bundle.
- Watch files with `ctx.watchPath`, never `node:fs.watch`.
- Return `isError: true` only for a call that did nothing because the model got it wrong. A lookup
  that finds nothing is a plain answer. A tool whose repeated identical input changes state declares
  `behaviorHints: { idempotentHint: false }`.
- Never take who acted from model or client input; use `ctx.agents.list` or
  `context.session.speaker`.
- A UI action can start an agent turn with `ctx.host.wake`, as the bundled games do.

## The screens

A native workbench lives in `ui/register.tsx` (found by convention) and needs `workbench` in
`surfaces`. Build every control from the host kit, `@localixai/kit/<id>`, and colour with host
tokens; never import `@/…`, which the UI build refuses. Icons come from `lucide-react`. In the
template, act through `send()` from `ui/usePolledSnapshot.ts`, keep state in `openJsonStore` from
`backend/store.ts`, and re-read what the agent wrote with `useStoreSnapshot` and `createStoreFeed`.
Inside Localix, look at the result with the `browser` tool at `mini-app:<name>` when it is
available, and say so when it is not.

## Commands

A command is declared under `commands` and runs as `/<app>:<command>`:

```json
{
  "commands": {
    "log": {
      "description": "Log a meal",
      "prompt": "Log this meal with log_meal: $ARGUMENTS",
      "argumentHint": "<what you ate>",
      "featured": true
    }
  }
}
```

Each is `{ prompt, description?, args?, argumentHint?, featured?, activateTools? }`. The `prompt`
takes `${name}` for each declared argument, and `$ARGUMENTS` and `$1` as in Claude Code. `args` adds
chips and pickers: `text` or `choice`, static `options` or an `optionsScript`, and an optional
`{ arg, equals }` condition. `featured` shows it first in the slash menu; `activateTools` switches
on up to eight deferred tools while it runs.

## Store media

| Field         | Rule                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `icon`        | Required to publish. `.svg` (recommended), `.png` or `.webp` of at least 512×512, or `.ico`; square; at most 256 KB; an SVG holds no script |
| `screenshots` | At most 10 `{ path, caption? }`: `.png`, `.jpg`, `.jpeg` or `.webp`, at most 5 MB, never downscaled                                         |
| `tags`        | At most 8 lower-case words joined by dashes (`board-game`)                                                                                  |
| `homepage`    | An `https://` address                                                                                                                       |

The first-party icon standard: a 1024 grid, a 896-wide tile with a 64 margin and corner radius 196,
filled top to bottom from `#121215` to `#09090b`, with a glyph about 400 wide in `#e7e6e6` at a fine
stroke. Start from the template's `icon.svg` and replace the glyph. `mini_app_build` and
`/mini-app reload` report media problems in their **store media** step without failing the build;
packing refuses a missing or invalid icon.

## Tests and checks

Inside Localix, `mini_app_build` checks template residue, style, routes, message context, the
backend and UI builds, types and the app's `*.test.ts`/`*.test.tsx` files, and publishes only when
all pass. With no test files the test step passes without a run, so write tests for the feature.

In a checkout, run `bun test mini-apps/<name>`; in the app's folder, the template's scripts:
`bun run test`, `bun run type-check:tests` and `bun run build`. Follow the repository's
`docs/internals/testing.md`.

## Pack and publish

```bash
bun run pack:mini-apps --only <name> --publisher "<you>" --out dist/catalog
bun run pack:mini-apps --source ~/.localix/mini-apps/<name> --publisher "<you>"
```

The first packs an app in `mini-apps/` exactly as a Localix release does; the second packs an app
Localix built, after `/mini-app reload`. The output folder holds `mini-app-catalog.json`, one
archive per app and its store media. Upload all of it to one place, such as a GitHub release, and
people add the catalog's URL from the store's **Add catalog…** or with
`/mini-app catalog add <url>`. To ship an update, raise `version`, pack again and replace the hosted
files; new content under the same version reaches no one. Raise `apiVersion` to require a newer
Localix.

## Read more

In the Localix repository:

- `docs/extending/mini-apps.md`: the manifest, the native module contract and host services
- `docs/extending/mini-app-ui.md`: workbench UI and the host kit
- `docs/extending/build-with-the-agent.md`: `/mini-app create` and `mini_app_build`
- `docs/extending/mini-app-publishing.md`: store media, catalogs, hosting and updates
- `mini-apps/template/README.md` and `scaffold.json`: the template every mini app forks
