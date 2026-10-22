# Plugins and mini apps

Localix extensions come in two layers. A **plugin** is what the agent uses, in the Claude Code
plugin format: the same folder loads in Claude Code and in Localix. A **mini app** is what the
person uses in Localix: screens, a backend, agent tools over Localix's own APIs, and pickers for its
commands. A mini app contains its plugin; a plugin knows nothing about mini apps.

## The two layers

| Layer    | Manifest                     | Contents                                                                                                                                                                                                                                                               | Who reads it            |
| -------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Plugin   | `.claude-plugin/plugin.json` | Skills, commands, agents, hooks (`hooks/hooks.json`), a hooks module, MCP servers (`.mcp.json`), LSP servers (`.lsp.json`), monitors, `bin/`, `userConfig`, `dependencies`.                                                                                            | Claude Code and Localix |
| Mini app | `.localix-app/app.json`      | A backend (`register(ctx)`: agent tools, routes, subsystems, Localix hooks, channels, memory), a native UI (`ui/register.tsx`), sandboxed views, prompt sections, typed contributions, file associations, settings, and Localix presentation of its plugin's commands. | Localix only            |

A folder may hold both manifests. Claude Code ignores `.localix-app/`, the backend and the UI, so
copying a mini app's folder into Claude Code installs its plugin. Localix reads both and serves them
as one extension under one name.

```text
chess/
  .claude-plugin/plugin.json   the plugin: name, version, description
  skills/play-chess/SKILL.md   the plugin's skill
  .localix-app/app.json        the mini app: category, backend, settings
  backend/index.ts             register(ctx): the board's routes and the agent's chess tool
  ui/register.tsx              the board
```

### Rules

1. **One direction.** Nothing in a plugin names a mini app or a Localix API. The mini app names its
   plugin (the one in its folder, which has the same name) and any other plugins it needs
   (`dependencies`, resolved and enabled with it like a plugin's dependencies).
2. **The plugin format is Claude Code's.** Localix reads `.claude-plugin/plugin.json` and the
   component folders in place, with Claude Code's defaults: listed `commands`, `agents`,
   `outputStyles` replace their default folder; `skills` add to it; `hooks`, `mcpServers` and
   `lspServers` merge with their default files. A part Localix does not run is reported in the
   plugin's validation, never silently dropped.
3. **Localix fields live in the mini app.** `apiVersion`, `category`, `surfaces`, `private`, a
   native backend, views, prompt sections, contributions and file associations are mini-app fields.
   A plugin manifest that carries one gets a validation warning, as Claude Code warns about an
   unknown key.
4. **Commands keep one prompt.** A command's prompt is the plugin's (`commands/<name>.md`). The mini
   app may describe how Localix offers it: argument chips and pickers (`args`), `featured`,
   `activateTools`. A named argument fills `$name` in the prompt, as Claude Code's `arguments`
   frontmatter does.
5. **One name.** A mini app and the plugin in its folder share a name; components stay namespaced by
   the plugin's name (`/chess:play-chess`), exactly as in Claude Code.
6. **Settings.** The plugin's `userConfig` and the mini app's `config` are one settings form; a key
   both declare is the plugin's.

## Kinds of extension

| Kind     | Has                                   | Examples                                              |
| -------- | ------------------------------------- | ----------------------------------------------------- |
| Plugin   | `.claude-plugin/plugin.json` only     | Any Claude Code plugin; a skills-only extension.      |
| Mini app | `.localix-app/app.json` (and plugin)  | Chess, Kanban, Reader, Code Review (command pickers). |
| Legacy   | A root `plugin.json` with both layers | Extensions written before the split; still loaded.    |

Only a mini app with a screen (a rail viewlet) can be installed as a Mac app
([plugin apps](plugin-apps.md)).

## Where the code lives

| Part                       | Home                                                        | Knows about                                  |
| -------------------------- | ----------------------------------------------------------- | -------------------------------------------- |
| Claude Code plugin format  | `packages/claude-plugin` (`@localixai/claude-plugin`)       | Claude Code's documented format only; zod.   |
| Mini app manifest          | `packages/plugin-sdk/src/manifest/app.ts` (`/app-manifest`) | Plugin names; Localix's extension contracts. |
| Reading a folder           | `apps/api/src/features/plugins/layout/`                     | Both formats; composes one runtime manifest. |
| Loading, catalog, enabling | `apps/api/src/features/plugins/` (unchanged by the split)   | The composed manifest.                       |

The loader, catalog, capability rules and UI keep working on one composed manifest per extension.
`layout/compose.ts` is the one place that maps the two manifests onto it, so a later change that
gives plugins and mini apps separate records has one seam to cut.

## Migration

- Bundled extensions ship in the new layout. Each root `plugin.json` was split once with
  `splitLegacyManifest` (`apps/api/src/features/plugins/layout/split.ts`), the inverse of
  `compose.ts`.
- A Claude Code plugin installs in place: no native `plugin.json` is written next to it any more.
  Folders imported by earlier versions carry both files; the `.claude-plugin/` manifest wins.
- A legacy root `plugin.json` keeps loading. `/plugin create` writes the new layout.

## Not yet

- **Hooks modules (mods).** `hooks/hooks.json` `modules` are reported as not run. Localix's own
  JavaScript hooks remain a mini-app backend feature until a mods runtime exists.
- Output styles, themes, workflows, plugin `settings.json` and channels are reported as unsupported.
- Claude Code marketplaces (`.claude-plugin/marketplace.json`) are still refused; install their
  plugins one by one.
