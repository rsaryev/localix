# The mini app format: manifest, guide, commands, store media

## `mini-app.json`

The manifest is strict: unknown keys are refused, a plugin's `skills` or `hooks` among them.

| Field                         | Meaning                                                                                                          |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `name`                        | Required. Letters, numbers, dashes or underscores; namespaces its tools and commands                             |
| `version`, `description`      | Required. `version` is semver and the only thing updates compare                                                 |
| `displayName`                 | The name people see; also `author`, `homepage`, `repository`, `license`, `keywords`                              |
| `apiVersion`                  | Positive integer, currently `2` (the app layer). Newer blocks loading; omitting it warns                         |
| `category`                    | One of `development`, `data`, `content`, `utilities`, `games`                                                    |
| `surfaces`                    | Defaults to `['agent']`; add `workbench` for a screen                                                            |
| `backend`                     | Native entrypoint exporting `register(ctx)`; the source stays `./backend/index.ts`, the package names the bundle |
| `guide`                       | Defaults to `./guide.md`                                                                                         |
| `config`                      | Settings delivered through `ctx.config`                                                                          |
| `commands`                    | Map keyed by command name; see [Commands](#commands)                                                             |
| `icon`, `screenshots`, `tags` | Store media; see [Store media](#store-media)                                                                     |
| `views`                       | Up to 6 sandboxed HTML views, each `{ id, title, file, icon?, agentDescription? }`                               |
| `promptSections`              | Up to 3 `{ title, content }` of static prompt text                                                               |
| `fileAssociations`            | File types for desktop packaging; inert for an installed app                                                     |
| `private`                     | Keeps an authoring scaffold out of packaging                                                                     |

A minimal manifest:

```json
{
  "name": "calorie-counter",
  "version": "0.1.0",
  "description": "Logs meals and their calories.",
  "apiVersion": 2,
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
prompt lists each enabled mini app in one line; the agent reads the guide with `MiniAppGuide` before
it first uses the app. A tool's description says what it does; the guide says when to use it. Put
long material in pages under `guide/`.

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
stroke. `mini-app icon [folder] --glyph '<path d="…"/>'` draws a 24×24 glyph on that tile.
`mini-app check` reports media problems in its **store media** step without failing the build;
packing refuses a missing or invalid icon.
