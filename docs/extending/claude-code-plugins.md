# Install Claude Code plugins

Localix plugins use one format: a `plugin.json` at the plugin root. A Claude Code plugin is
supported as an import. When you install one, Localix converts it into a native plugin and records
where it came from. Discovery and loading never read the Claude Code layout.

## What you can do

| Outcome                                  | How                                                                     |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| Install a Claude Code plugin from GitHub | `/plugin install owner/repo`                                            |
| Install from a git URL or a local folder | `/plugin install https://…/repo.git` or `/plugin install /path/to/dir`  |
| Install from npm via a marketplace entry | Add a Localix marketplace whose entry has an npm source                 |
| Install for one project only             | Add `--project`; installs default to `~/.localix/plugins` for all chats |

A Claude Code marketplace, a repository whose only catalog is the Claude Code `marketplace.json`,
cannot be added. Localix answers: "This is a Claude Code marketplace; install its plugins
individually with /plugin install <owner/repo or path>". Point `/plugin install` at the plugin's own
folder or repository instead.

## How it works

The importer runs on the staged copy before validation, so a plugin that fails to convert never
becomes visible. It writes a native `plugin.json` and keeps the original Claude Code manifest folder
unchanged.

| Claude Code input                                                      | Native result                                                                     |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Plugin manifest in the Claude Code folder                              | Root `plugin.json` with `origin: { format: "claude-code", source, version }`      |
| `commands` / `agents` listing paths                                    | The same paths plus `defaultDirs: { commands: false }` (Claude Code replace rule) |
| `commands` / `agents` as a single string                               | A one-item array                                                                  |
| `skills`                                                               | Unchanged; the default `skills/` directory is still scanned                       |
| `userConfig`, `sensitive: true`                                        | `config`, `secret: true`                                                          |
| `experimental.monitors` (inline array)                                 | `monitors`                                                                        |
| `hooks`, `hooks/hooks.json`                                            | Unchanged; hook event names are the native event names                            |
| `mcpServers`, `.mcp.json`                                              | Unchanged                                                                         |
| `lspServers`, `.lsp.json`                                              | Unchanged                                                                         |
| `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`, `${user_config.KEY}` | Unchanged; these are the native substitution variables                            |

Notes about pieces that do not carry over are added to the install result's warnings. Settings
labels the plugin **imported** and skips authoring reminders such as a missing license.

### Existing installs

At startup Localix converts, once, plugins installed before the importer existed:

1. Plugins in the Default project folder (`~/.localix/workspace/.localix/plugins`) move to
   `~/.localix/plugins`, and their saved state moves to the global scope. Chats in the Default
   project run in per-chat folders, so that location was never visible to them. If a global plugin
   has the same name, the copy stays where it is and the log says so.
2. Every Claude Code-layout plugin under `~/.localix/plugins` or a project's `.localix/plugins` gets
   a native `plugin.json` written next to its original manifest.

The migration deletes nothing, logs each step, and does nothing on later starts.

A marketplace registered earlier whose catalog is Claude Code-only stays listed.
`/plugin marketplace list` shows it as unsupported with the hint above; remove it with
`/plugin marketplace remove <name>`.

## Compatibility

Checked against the Claude Code plugins reference (manifest schema, path behavior rules, hooks, MCP,
LSP, user configuration, and channels).

| Claude Code feature                                                                                                                       | Status in Localix                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Metadata: `name`, `displayName`, `version`, `description`, `author`, `homepage`, `repository`, `license`, `keywords`                      | Supported                                                        |
| `commands` (Markdown with frontmatter, nested folders namespace as `dir:name`)                                                            | Supported                                                        |
| `agents` (Markdown with frontmatter)                                                                                                      | Supported as plugin roles, at most 8 per plugin                  |
| `skills`, root `SKILL.md`                                                                                                                 | Supported                                                        |
| `hooks`: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop, SubagentStart, SubagentStop, PreCompact, Notification, SessionEnd | Supported                                                        |
| Other hook events                                                                                                                         | Not dispatched; listed in the install warnings                   |
| `mcpServers`, `.mcp.json`                                                                                                                 | Supported                                                        |
| `lspServers`, `.lsp.json`                                                                                                                 | Supported over stdio; see [Language servers](../features/lsp.md) |
| `userConfig` with `sensitive`                                                                                                             | Supported as `config` with `secret`                              |
| `experimental.monitors` (inline array)                                                                                                    | Supported; a path string is not converted                        |
| `dependencies`                                                                                                                            | Supported for marketplace installs                               |
| `outputStyles`                                                                                                                            | Not supported; dropped with a warning                            |
| `experimental.themes`                                                                                                                     | Not supported; dropped with a warning                            |
| `channels`                                                                                                                                | Not supported; dropped with a warning                            |
| Claude Code marketplaces (`/plugin marketplace add`)                                                                                      | Not supported; install each plugin by its source                 |
| Claude Code install cache and `installed_plugins.json`                                                                                    | Not read                                                         |

## Limits

- Conversion happens once, at install or first start. Editing the Claude Code manifest afterwards
  has no effect; reinstall with `/plugin update <name>` or edit `plugin.json`.
- A plugin folder without any manifest is a native plugin already: its default component folders
  load as they are, and nothing is recorded as imported.
- A Default project chat has no project folder, so `--project` there fails with a hint to install
  globally.

## Related guides

- [Plugins](plugins.md)
- [Hooks and slash commands](../features/hooks-and-commands.md)
- [Language servers](../features/lsp.md)

## Source of truth

- [Claude Code importer](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/import-claude-code.ts)
- [Startup migration](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/legacy-install-migration.ts)
- [Importer tests](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/import-claude-code.test.ts)
