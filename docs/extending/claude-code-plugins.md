# Install Claude Code plugins

Localix reads a Claude Code plugin in place: `.claude-plugin/plugin.json` and its component folders
load as they are, with no conversion, and the same folder keeps working in Claude Code. Use this
page to install one and to see which Claude Code features run in Localix.

## What you can do

| Outcome                                  | How                                                                     |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| Install a Claude Code plugin from GitHub | `/plugin install owner/repo`                                            |
| Install from a git URL or a local folder | `/plugin install https://…/repo.git` or `/plugin install /path/to/dir`  |
| Install from npm via a marketplace entry | Add a Localix marketplace whose entry has an npm source                 |
| Install for one project only             | Add `--project`; installs default to `~/.localix/plugins` for all chats |
| Drop a folder in                         | Copy it under a plugin root and run `/plugin reload`                    |

A Claude Code marketplace, a repository whose only catalog is `.claude-plugin/marketplace.json`,
cannot be added. Localix answers: "This is a Claude Code marketplace; install its plugins
individually with /plugin install <owner/repo or path>". Point `/plugin install` at the plugin's own
folder or repository instead.

To give a plugin screens, a backend or agent tools over Localix's APIs, add a mini app beside it;
see [Build a plugin or a mini app](plugins.md).

## How it works

Discovery reads the manifest and component folders with Claude Code's rules. A folder without a
manifest is a plugin named after the folder when it has a component folder such as `skills/` or
`commands/`. Settings → Capabilities → Plugins labels it **Claude Code plugin** and skips authoring
reminders such as a missing license.

| Claude Code rule                                     | In Localix                                                                         |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Listed `commands` / `agents` paths                   | Replace the default `commands/` / `agents/` folder                                 |
| Listed `skills` paths                                | Add to the default `skills/` folder                                                |
| `hooks`, `mcpServers`, `lspServers`                  | Merge with `hooks/hooks.json`, `.mcp.json`, `.lsp.json`; the default file first    |
| `userConfig`, `sensitive: true`                      | The plugin's settings form, masked when sensitive                                  |
| `${VAR}` in an MCP server's config                   | Expands from the environment, as in Claude Code                                    |
| `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`     | The plugin's folder and its data folder                                            |
| `${user_config.KEY}`                                 | The setting's value                                                                |
| Command `arguments` frontmatter                      | Names positional arguments; `$name` takes each value, beside `$ARGUMENTS` and `$1` |
| Names Anthropic reserves (`claude-…`, `anthropic-…`) | Load, as Claude Code loads Anthropic's own plugins                                 |

**Boundary:** in a remote MCP server's `url` and `headers`, a variable whose name looks like a
credential (`TOKEN`, `SECRET`, `API_KEY`, `PASSWORD`, …) reads as empty unless the plugin's settings
supply it; a stdio server inherits the environment anyway.

Hooks on these events run: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`,
`PostToolUseFailure`, `Stop`, `SessionEnd`, `SubagentStart`, `SubagentStop`, `PreCompact` and
`Notification`. `PostToolUseFailure` runs in place of `PostToolUse` when a tool throws, and its
context is added to the failed result. See [Hooks and commands](../features/hooks-and-commands.md).

### Earlier installs

Versions before this one converted a Claude Code plugin at install and wrote a root `plugin.json`
beside it. That file is now ignored, and the `.claude-plugin/` manifest is read. Plugins installed
into the Default project's folder (`~/.localix/workspace/.localix/plugins`), which its chats never
saw, still move to `~/.localix/plugins` once at startup, with their saved state. A plugin of the
same name already there keeps both copies where they are, and the log says so.

A marketplace registered earlier whose catalog is Claude Code-only stays listed.
`/plugin marketplace list` shows it as unsupported with the hint above; remove it with
`/plugin marketplace remove <name>`.

## Compatibility

Checked against the Claude Code plugins reference. A part Localix does not run is reported in the
plugin's validation, never dropped silently. In October 2026 every plugin in Anthropic's
`claude-code` and `claude-plugins-official` repositories loaded without an error.

| Claude Code feature                                                                                                  | Status in Localix                                                |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Metadata: `name`, `displayName`, `version`, `description`, `author`, `homepage`, `repository`, `license`, `keywords` | Supported                                                        |
| `commands` (Markdown with frontmatter, nested folders namespace as `dir:name`)                                       | Supported                                                        |
| `agents` (Markdown with frontmatter)                                                                                 | Supported as plugin roles, at most 8 per plugin                  |
| `skills`, root `SKILL.md`                                                                                            | Supported                                                        |
| `hooks` on the events listed above                                                                                   | Supported                                                        |
| Other hook events (`PermissionRequest`, `StopFailure`, `UserPromptExpansion`, …)                                     | Reported in validation; not dispatched                           |
| Hooks modules (`modules` in `hooks/hooks.json`, a mod)                                                               | Reported; not run yet. The file's `hooks` still run              |
| `mcpServers`, `.mcp.json`                                                                                            | Supported                                                        |
| `lspServers`, `.lsp.json`                                                                                            | Supported over stdio; see [Language servers](../features/lsp.md) |
| `userConfig` with `sensitive`                                                                                        | Supported                                                        |
| `monitors`, `experimental.monitors`, `monitors/monitors.json`                                                        | Supported; `on-skill-invoke` monitors do not start yet           |
| `bin/`                                                                                                               | Supported: on the PATH of the agent's shell and monitors         |
| `dependencies`                                                                                                       | Supported for marketplace installs                               |
| `outputStyles`, `themes`, `workflows`, plugin `settings.json`, `channels`                                            | Reported; not used                                               |
| Claude Code marketplaces (`.claude-plugin/marketplace.json`)                                                         | Refused; install each plugin by its source                       |
| Claude Code install cache and `installed_plugins.json`                                                               | Not read                                                         |

## Limits

- A plugin whose components live only in a Claude Code marketplace entry, such as the `*-lsp`
  plugins, has none of them when installed from its folder, because that catalog is not read.
- A Default project chat has no project folder, so `--project` there fails with a hint to install
  globally.
- Enabling a plugin with hooks, MCP servers or `bin/` executables lets it run local code.

## Related guides

- [Build a plugin or a mini app](plugins.md)
- [Hooks and slash commands](../features/hooks-and-commands.md)
- [Language servers](../features/lsp.md)

## Source of truth

- [The Claude Code plugin format](https://github.com/rsaryev/localix/tree/main/packages/claude-plugin/src)
- [Reading it as Localix's runtime manifest](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/layout/claude-code.ts)
- [Composing a plugin and its mini app](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/layout/compose.ts)
- [Unsupported hook events and modules](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/manifest-load.ts)
- [MCP variable expansion](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/ext/user-config-substitute.ts)
- [Marketplace refusal](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/claude-code-marketplace.ts)
- [Layout tests](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/claude-code-layout.test.ts)
