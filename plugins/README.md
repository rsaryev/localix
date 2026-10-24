# Plugins

The Claude Code plugins built into Localix. Each folder here is one plugin in Claude Code's format
(`.claude-plugin/plugin.json`, `commands/`, `skills/` and the rest), with no Localix code and no
`mini-app.json`. Mini apps are a separate product and live in
[`mini-apps/`](../mini-apps/README.md); see
[plugins and mini apps](../docs/internals/plugins-and-mini-apps.md).

| Plugin                                    | What it adds                                                                  |
| ----------------------------------------- | ----------------------------------------------------------------------------- |
| [`localix-mini-apps`](localix-mini-apps/) | A skill and commands that teach an agent to build, pack and publish mini apps |

## How they ship

- **In Localix:** the desktop build copies every plugin here into `resources/builtin-plugins/`
  (`scripts/stage-builtin-plugins.mjs`, called by `apps/desktop-tauri/scripts/prepare-sidecar.mjs`),
  and `bun run dev` stages them for the dev API through `LOCALIX_BUILTIN_PLUGINS_DIR`. Localix lists
  each one as Built-in (source `builtin`): on by default, switchable off, never uninstalled or
  updated on its own. A change here reaches people with the next Localix release, and the dev API
  after a restart of `bun run dev`.
- **In Claude Code:** the repository's
  [`.claude-plugin/marketplace.json`](../.claude-plugin/marketplace.json) lists them as the
  `localix` marketplace, which Localix also registers on first start:

  ```bash
  claude plugin marketplace add rsaryev/localix
  claude plugin install localix-mini-apps@localix
  ```

## Add one

1. Create `plugins/<name>/.claude-plugin/plugin.json` with a `name`, `version` and `description`,
   and the components in Claude Code's default folders. Raise `version` with each change: it is how
   Claude Code users get the update.
2. Add its entry to `.claude-plugin/marketplace.json` with `"source": "./plugins/<name>"`
   (`scripts/stage-builtin-plugins.test.ts` fails until every plugin here is listed).
3. Load it in Claude Code with `claude --plugin-dir plugins/<name>`, or run `bun run dev` and find
   it under Settings → Capabilities → Plugins → Built-in.

See [Claude Code plugins](../docs/extending/plugin-updates.md#built-in-plugins).
