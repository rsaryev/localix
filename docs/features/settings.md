# Settings

Settings opens as a workspace pane. Application settings and agent profiles share the same layout: a
grouped sidebar at wide pane widths and a section picker in a narrow split. Application search finds
individual controls across sections and opens the owning group, including advanced controls.

## Settings map

| Group       | Section                         | Controls and destinations                                                                                | Applies to                                                                             |
| ----------- | ------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Personal    | Preferences → Appearance        | Theme, interface font, code font, font size, live code preview                                           | Theme stays on this device; font preferences use synchronized UI settings              |
| Personal    | Preferences → Recent views      | Recent views: collapsed, expanded, hidden                                                                | This browser or desktop webview                                                        |
| Personal    | Preferences → Notifications     | Interruption condition, waiting count or Windows taskbar indicator; terminal protocol under Advanced     | This browser or desktop webview; app icon indicators require desktop support           |
| Personal    | Preferences → Spend alerts      | Metered session spend threshold in US dollars                                                            | Local alert preference; subscription cost is excluded                                  |
| Personal    | Editor → Editing                | Auto save, preview tabs, follow agent edits                                                              | Auto save and preview tabs are local; following agent edits uses synchronized settings |
| Personal    | Editor → On save                | Format, trim trailing whitespace, insert final newline                                                   | Synchronized save policy for all projects                                              |
| Personal    | Editor → Code display           | Git scrollbar markers, bracket colors, word wrap, render whitespace                                      | Markers and bracket colors are synchronized; wrap and whitespace display stay local    |
| Personal    | Editor → Annotations            | Inline Git blame, inlay hints                                                                            | Git blame is synchronized; inlay hints stay local                                      |
| Personal    | Shortcuts                       | Base keymap, command search, editable chords, conflicts, reset                                           | Keyboard commands; interaction keys are reference-only                                 |
| Workspace   | Agents                          | Agent registry, project selection, create, open profile, availability                                    | Global or project agent definitions                                                    |
| Workspace   | Capabilities → Tools            | Tool availability by category                                                                            | The selected agent’s rules; the default assistant is selected initially                |
| Workspace   | Capabilities → Skills           | Create, edit, availability, curator, archive, restore                                                    | Shared skill files; availability belongs to the selected agent                         |
| Workspace   | Capabilities → MCP              | Add servers, transport, connection status, tool availability                                             | Shared server connections and the selected agent’s rules                               |
| Workspace   | Capabilities → Plugins          | Install, configuration, availability, marketplaces                                                       | Shared plugin installations and the selected agent’s rules                             |
| Workspace   | Capabilities → Permission rules | Ordered rules, argument patterns, allow/ask/deny, apply, restore defaults                                | The selected agent                                                                     |
| Workspace   | Project                         | Project selector, display name, project instructions, delete                                             | The selected project                                                                   |
| Application | System → Application            | Updates, terminal command, storage usage, reviewed conversation removal, retention, replay setup         | This installation and local conversation storage                                       |
| Application | System → Access & context       | Private/local research URLs, context exclusion paths                                                     | Runtime settings for all agents and projects                                           |
| Application | System → Diagnostics            | Scope, refresh, validation, resolved models, tool policy, permissions, values and provenance, extensions | Read-only resolved runtime configuration                                               |

Choose an editor-style preset in **Shortcuts → Base keymap**. The
[keymap inventory](keyboard-shortcuts.md) lists compatible commands, platform differences, and
source references for all 17 choices.

## Agent settings

Open an agent from **Settings → Agents**, an agent mention, or its identity in a conversation. Its
profile is a workspace tab, so it can sit beside the conversation it belongs to. The profile uses
the same navigation, section surfaces, field sizes, and spacing as application settings.

| Group        | Section                   | Controls                                                   | Saving                                                                       |
| ------------ | ------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Agent        | Definition → Identity     | Name, title, description; live derived monogram            | Save changes; the name is fixed after creation                               |
| Agent        | Definition → Model        | Model preference, reasoning effort, inherit session model  | Save changes; the picker manages provider connections separately             |
| Agent        | Definition → Instructions | Standing instructions in Markdown                          | Save changes                                                                 |
| Agent        | Definition → Limits       | Hierarchy priority, maximum turns                          | Save changes; blank maximum turns means unlimited                            |
| Capabilities | Tools                     | Category groups and individual tool availability           | Each switch applies immediately                                              |
| Capabilities | Skills                    | Availability, shared skill authoring, archive and restore  | Switches apply immediately; authoring has explicit save actions              |
| Capabilities | MCP                       | Server and tool availability, shared connection management | Switches apply immediately; server configuration has an explicit save action |
| Capabilities | Plugins                   | Availability, shared installation and configuration        | Switches apply immediately; configuration has an explicit save action        |
| Capabilities | Permission rules          | Ordered policy for the agent                               | Apply commits the staged list                                                |

An unsaved definition stays in the form when switching to another section of the same profile and
back. Paired fields align their labels, help, controls, and errors; they stack when their own
container is narrow. The action row remains reachable while scrolling and wraps in narrow panes.
Read-only definitions explain their owner, and controls follow the same field policy as the server.
Restoring a built-in definition fills the draft for review; it does not write until saved.

Write shared project conventions in **Project → Project instructions**. There is no personal profile
or global response-style form. A forward database migration removes retired personal data while
retaining UI and runtime settings.

Provider connections, model defaults and workload routing are owned by the
[model selection and details panel](providers.md). Credentials live in the Vault. Theme selection is
available in Preferences → Appearance.

## Access and context

**System → Access & context** keeps global research access visible independently of the agent
selected in Capabilities. Private/local URL access is an installation-wide runtime preference.

Context exclusions are root-relative path prefixes, one per line. Apply validates, trims and
deduplicates them. They affect file context expansion for every project; project-specific exclusions
also apply. They do not prohibit file tools. Use agent permission rules for tool access decisions.

## Saving and states

Synchronized settings use the existing user settings service. Local preferences stay in the browser
or desktop webview and do not become agent instructions. Ordinary switches and selectors apply
immediately. Project text fields save on blur. Record editors have explicit save actions and show
errors beside the relevant field or action. A running save reports its activity and locks its
actions.

A registry shows an empty state only after a successful load. Failed loads offer Retry and retain
their problem in the Event Center. Diagnostics is read-only. Storage removal first counts affected
conversations, then asks for confirmation; automatic removal is disabled until configured.

## Source of truth

- [Section order and groups](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/settings/model/settingsNavigation.ts)
- [Search catalog](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/settings/model/settingsIndex.ts)
- [Shared workspace layout](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/settings/ui/SettingsWorkspace.tsx)
- [Shared section geometry](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/settings/ui/SettingsScaffold.tsx)
- [Paired field grid](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/settings/ui/SettingsFieldGrid.tsx)
- [Settings synchronization](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/settings/model/settingsStore.ts)
- [Runtime settings contract](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/user/contracts.ts)
