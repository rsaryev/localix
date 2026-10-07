# Use the workspace

The Localix workspace is a split tab grid for chat, files, terminals, diffs, source control,
previews, and workbench views. Use it to keep a session beside the files and runtime surfaces for
the same task.

**Availability:** The grid is a desktop/web surface. Headless clients use the same backend without
this layout.

![Source code and passing fixture tests beside the team conversation](../assets/screenshots/workspace/editor-grid--2026-10-08.png)

## Native workspace tabs on macOS

In the macOS desktop app, **Command+T** opens a new native workspace tab in the current window. The
**Window** menu also provides **New Workspace Window**, next/previous workspace tab, **Move
Workspace Tab to New Window**, **Merge All Workspace Windows**, and a tab-bar toggle. The native tab
bar's **+** button opens another workspace tab.

Each native tab has its own selected project, conversation, editor grid and editor view state. Use
the project switcher inside a tab to choose its project. All tabs share one API runtime and
server-owned projects, conversations, settings and terminals. Opening the same conversation in
several workspaces does not duplicate its agent runtime.

**Command+W** closes an editor tab inside the workspace. The red window button and
**Command+Shift+W** (**Window → Close Window**) flush and hide the entire native workspace group.
Reopening Localix from the Dock or **Show Localix** in the menu bar brings back the same tabs,
order, selected workspace and routes. **New Workspace Window** creates a separate fresh workspace.

Use a native workspace tab's close button or **Window → Close Workspace Tab** to remove that
workspace after its pending writes flush. The last workspace remains hidden and reopenable.
**Command+Q** flushes every workspace and saves native groups for the next launch, including groups
whose windows are hidden. Forced process termination does not guarantee the latest grouping.

AppKit owns the titlebar and tab-bar geometry, including detached tabs and fullscreen. Native
workspace tabs are available only in the macOS desktop shell; browser, Windows and Linux clients
keep their editor grid. In macOS desktop, workspace-symbol search uses **Command+Option+Shift+O**
when its binding would otherwise use Command+T. File-search presets that use Command+T fall back to
Command+P; other overrides using Command+T are unassigned because AppKit reserves that key.

## What you can do

All available plugin tools, **Usage & Spend**, and **Vault** are pinned to the left navigation rail
by default. The middle rail combines them into three groups: **Workspace** (development, data and
content), **Tools** (utilities, Usage & Spend, Vault, and uncategorized plugins), and **Games**. One
or two pinned tools in a group keep their individual buttons; three or more share a category menu.
Only pinned tools count toward this grouping. A category highlights when one of its views is active.

Open **All tools** (**…**) to browse the complete catalog and toggle the pin beside each tool. Pin
changes keep the menu open and persist on this device. Right-click an individual button to unpin or
move it. Pinned tools do not also appear in the recent-tools list; recently opened, unpinned tools
remain behind the recent-views disclosure button. **Manage plugins…** opens the plugins section in
Settings.

Category menus and All tools open on hover or press; moving into a hover-open menu keeps it open.
Only one rail menu opens at a time. Pressing a category keeps menus open as you move between
categories; pressing it again, selecting a tool, clicking outside, or Escape closes the menu. Long
lists scroll within a bounded panel, with Manage plugins fixed below the catalog.

| Outcome                        | Mechanism                                                                                                | Boundary                                                    |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Arrange work side by side      | Drag a tab to another group or an edge to move or split it                                               | Mobile shows only the focused group at one time             |
| Keep session tabs together     | Every tab belongs to the conversation it was opened in and shows only with that conversation             | Settings, Usage and agent profiles are app-wide             |
| Step into a sub-session        | Its chat opens as a tab beside its parent's; the files, terminals and Browser around it stay             | A sub-session has no workspace of its own; start a new chat |
| Restore a working layout       | The grid saves its split tree, active group, and restorable tabs locally                                 | Ephemeral and non-restorable tabs are omitted               |
| Reuse an open surface          | Browser, Problems, Activity and Search open once per chat; opening again reveals that chat's tab         | Another chat gets its own copy                              |
| Attach explicit context        | Type a supported reference or drag a linkable tab, result, message, or selection to composer             | Each source publishes a bounded structured binding          |
| Link eligible open-tab context | Mounted workbench tabs can publish visible, dismissible context candidates                               | Only registered bindings from visible Localix surfaces join |
| Review the send set            | The composer lists automatic and explicit context with status and estimated size                         | Server expansion at send time remains authoritative         |
| Use terminal output directly   | Recognized file links open the editor; URLs, command marks, quick fixes, and workflows remain actionable | Parsing and shell integration are capability-dependent      |
| Open workbench views           | Enabled plugins register file editors and workspace item types                                           | Disabled or unavailable contributions do not render         |

## How it works

The bottom status bar uses a 28 px height and offers separate **Claude Code** and **Codex** buttons.
The default order is Reset layout, Keep awake, Claude Code, then Codex. Each agent button starts its
CLI in the current chat's terminal. These are core shortcuts and remain available when the External
Agents plugin is disabled. Drag either button to reorder it or move it between the status bar and
rail; its context menu offers placement and unpinning. Open a chat before launching; the login shell
reports a missing CLI in its terminal. The top bar keeps Terminal, Browser and Event Center; the
command palette remains available through its shortcut.

### Groups and placement

The grid stores a tree of groups. Each leaf holds an ordered tab strip and one visible tab. Core
placement puts files, diffs, terminals, previews, settings, and full workbench views in the editor
area. Chat, source control, review, tasks, and problems use the auxiliary area.

Dragging a tab onto an edge creates a sibling group. Dragging it onto another tab strip moves it
into that group. Separators resize adjacent groups; double-clicking a separator gives its two sides
equal space. Maximizing a group hides the other groups without replacing the stored split tree.

Every group has a small panel button at the right end of its tab strip, level with the tabs. It
maximizes the group — the whole panel, whatever tab it shows — and restores the layout, the same as
`Cmd/Ctrl+J`. With a single group there is nothing to maximize over, so the button stays in place
but is disabled.

### Session scope and restoration

Every tab belongs to one session and appears only with it; a chat's [Kanban](task-board.md) board,
its Browser, Problems, Activity and Search tabs are among them. Each open names its session — the
chat a tool card, a link or a command belongs to — and a tab never takes the session of whichever
chat happens to be on screen. Only app-level tabs (Settings, Usage, an agent profile, and plugin
views registered as global) belong to no session and stay available in every chat. A saved layout
drops a session tab that names no session.

A session's workspace is its ROOT conversation's (`apps/ui/src/shared/lib/workspaceOf.ts`). A
sub-session of any kind — a delegated agent, a thread, a fork — has none of its own: what it opens
lands in its root's tabs and its root's Browser strip, still marked with the session that opened it,
and its chat is one more chat tab beside its parent's. Moving between them changes only the chat.
Showing a sibling's chat tab (a click, or closing the shown one) makes that conversation the active
one, as the sidebar would (`apps/ui/src/widgets/editor-grid/model/workspaceChats.ts`). Deleting a
sub-session closes its chat tab and leaves what it opened; deleting the root closes the workspace. A
conversation that needs a workspace of its own is a new chat.

Only the conversation on screen takes focus (`openPolicy`). What a sibling of the same workspace
opens — a sub-agent beside its parent, or the parent while you read a sub-session — joins the
workspace without coming forward, so several sub-agents at once do not take turns pulling the
workbench away. When a delegated run ends, its pages and its interactive terminals are closed
(`apps/api/src/features/chat/runtime/run/child-surfaces.ts`).

The grid writes restorable items and layout state to browser storage. Chat, files, previews,
terminals, source control, settings, and several global views opt into restoration. A terminal tab
reattaches to its backend PTY by id; a dead terminal id closes rather than creating a replacement
silently.

Terminal tabs close automatically when their processes finish, including shells, coding agents and
background jobs. A workspace-wide check also removes dead tabs in hidden conversations and restored
layouts after a restart or reconnect. Connection failures keep the tabs intact until the backend
confirms that their processes are gone. Finished terminals are also removed from the reopen history.

Recently used session scopes and tabs can remain mounted but hidden for faster switching. The
keep-alive lists are bounded; an older surface can remount when you return to it.

### Surface ownership

The grid arranges surfaces; the owning feature controls their behavior. The editor delegates
language actions to [LSP integration](lsp.md). Preview supplies the browser surface, while
[Visual Feedback](visual-feedback.md) owns source-mapped selection. Enabled plugins can contribute
workbench tabs or choose a file editor for matching files.

Terminals are PTY processes managed by the API and streamed into terminal tabs. Every terminal
belongs to the session that opened it and starts in that session's working directory; the API
refuses a terminal that names no session, so no pane runs unbound in the home directory. Source
control reads the working directory of the chat its tab or pill belongs to. Both follow that
directory when it is enabled.

### The browser

Each session has its own Browser work item with its own tab strip. A page opened in one session — by
you, by its agent, or as a dev-server preview — appears only in that session's Browser, and only
that session's agent sees it among its tabs. A tab shows a web page, the history list, or a new tab
waiting for an address. Browsing history is the one thing shared across sessions: it records the
pages you visited, and an entry opens in the Browser of the session you open it from.

| Control         | What it does                                                                       | Boundary                                                  |
| --------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------- |
| New tab         | Opens a tab with its address field focused, above the pages visited most recently. | Eight recent pages; **All history** opens the rest.       |
| History         | Opens one History tab: pages grouped by day, searchable, removable one by one.     | Keeps the 150 most recent pages, in this app only.        |
| Address field   | Loads a web address, a local host and port, a relative route, or a Google search.  | Idle it shows a readable address; editing, the exact URL. |
| Tab strip       | Drag a tab to reorder it; right-click for reload, pin, and close actions.          | The right-click menu is part of the desktop app.          |
| Browser toolbar | Reload, back and forward, frame size, dev-server ports, and the system browser.    | Back and forward follow a native page's own history.      |

In the desktop app an external site opens as a native system WebView, which looks and behaves like
the platform browser. A local dev server opens framed, which is what lets
[Visual Feedback](visual-feedback.md) reach into it. A page that cannot be opened is reported in the
Event Center rather than over the page.

### Explicit and automatic context

The composer accepts typed references for supported files, folders, diffs, commit history, projects,
sessions, terminals, tool calls, and plugin-owned resources such as the chat's Kanban cards
(`@resource:` → **Board**). Structured-only references cover selected snippets, transcript messages,
dragged tabs, and plugin-owned resources without inserting expanded blocks into the visible prompt.
File and folder references resolve in the directory the server assigns to the sending session, after
checking that you own it; browsing `@resource:` with a session you do not own is refused.

Eligible mounted tabs can publish live context candidates. Those candidates appear as automatic
context in the composer; explicit attachments take precedence over a duplicate automatic link. The
context popover shows the ordered send set, its source, expansion status, and estimated size. A user
can remove one item, dismiss an automatic tab link, or clear the set before sending.

The client performs a size preflight for feedback, while the API resolves references again at send
time. This keeps the visible transcript compact and avoids treating a stale preview as
authoritative.

### Addressable resource links

Resource URIs remain opaque to the core: the enabled provider or plugin owns expansion and the UI
destination that opens when the resource is followed. The same link can move through search,
composer context, agent activity, and workbench tabs without replacing the resource identity with a
detached text copy.

### Terminal as a working surface

Terminal tabs attach to server-owned PTYs and replay retained scrollback after a supported
reconnection. Recognized `file:line` output opens the file in the grid, while recognized URLs open
through the client platform boundary. Shell integration can add command outcome marks, prompt
navigation, sticky command headers, output-aware quick fixes, and copy or rerun actions.

The terminal confirms unsafe multiline paste when bracketed-paste handling cannot make it harmless.

## Configuration

Open **Settings → Shortcuts** to rebind configurable commands. The defaults below come from the
shared shortcut catalog. Stored chords are platform-neutral: `mod` resolves to Command on Apple
platforms and Control elsewhere, while `secondary` resolves to Control on Apple platforms and
Meta/Windows/Super elsewhere. Matching remains exact, so the non-primary modifier cannot trigger a
primary shortcut.

| Command                          | Default                   |
| -------------------------------- | ------------------------- |
| Go to file                       | `Cmd/Ctrl+P`              |
| Switch session                   | `Cmd/Ctrl+K`              |
| Toggle sidebar                   | `Cmd/Ctrl+B`              |
| Split focused group to the right | `Cmd/Ctrl+\`              |
| Maximize or restore a group      | `Cmd/Ctrl+J`              |
| Open a terminal                  | `Cmd/Ctrl+\``             |
| Focus next or previous group     | `Cmd/Ctrl+Alt+Down/Up`    |
| Cycle tabs in the focused group  | `Cmd/Ctrl+Alt+Right/Left` |
| Move between workspace parts     | `F6` / `Shift+F6`         |

## Limits

- The grid is not a filesystem-isolation boundary. Session tabs are separate UI state, but sessions
  can use the same working directory.
- On mobile, the stored split layout remains intact, but only the focused group is rendered at full
  width.
- Layout persistence is local browser storage. It does not synchronize between clients, and only tab
  kinds marked restorable return after reload.
- Each group keeps at most 12 file and live-change tabs. Opening more closes the oldest non-active
  capped tabs in that group.
- A disabled plugin can leave a saved tab pending until plugin activation resolves. Once the plugin
  is authoritatively unavailable, the grid removes that contributed tab.
- Editor diagnostics, completion, rename, code actions, and formatting require a matching language
  server. The grid itself does not provide those operations.
- After an agent write, patch, or edit the language server is asked for diagnostics and the tool
  waits up to 6 seconds for them. A project whose server twice in a row answers nothing within that
  window stops waiting for two minutes — the file is still pushed to the server — and resumes as
  soon as an answer arrives.
- When an agent's `write`, `edit`, or `apply_patch` finishes, every open editor of that file
  updates. This works even outside the session's watched folder, and for tabs owned by another
  session. A clean tab takes the new text and keeps the cursor and undo history. The changed lines
  are highlighted in the text and on the scrollbar until you next edit the file. A tab with unsaved
  edits shows the reconcile banner instead.
- In a local session, opening a file starts the watcher of the session's folder — the one the file
  tree uses — even when the tree was never opened.
- A message sent while a file tab is active includes the caret line and the file's current errors
  and warnings. A selection includes its exact `path:line:column` span. The agent's `file.open`
  location can select an exact span (`line`, `column`, `endLine`, `endColumn`) to show you what it
  means.
- **Fix with Agent** sends the diagnostic's `path:line:column`, its rule (such as `ts(2552)`), a
  numbered code window fenced in the file's language with a caret under the span, and any other
  problems in that window.
- A preview tab does not make Visual Feedback available. Source-mapped capture still requires a
  Localix preview with the probe connected.
- One message carries at most 20 structured context references. The composer warns as estimated
  expansion grows and blocks a send when it crosses the configured high-water boundary for the
  selected model context window.
- Context previews can fail or become stale. The send-time expansion is authoritative, and a linked
  live resource can still disappear or lose permission before use.
- Terminal command marks and output-aware actions depend on supported shell integration and parsed
  output. A dead or unreachable PTY can require an explicit replacement terminal.

## Related guides

- [Your first session](../getting-started/first-session.md)
- [Sessions and projects](sessions-and-projects.md)
- [Plugins](../extending/plugins.md)

## Source of truth

- [Surface registry](https://github.com/rsaryev/localix/blob/main/apps/ui/src/widgets/editor-grid/ui/registry.tsx)
- [Split rendering](https://github.com/rsaryev/localix/blob/main/apps/ui/src/widgets/editor-grid/ui/GridView.tsx)
  ·
  [apps/ui/src/widgets/editor-grid/ui/GroupView.tsx](https://github.com/rsaryev/localix/blob/main/apps/ui/src/widgets/editor-grid/ui/GroupView.tsx)
- [Placement policy](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/workspace-grid/model/placement.ts)
- [Scope and restoration](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/workspace-grid/model/scope.ts)
  ·
  [apps/ui/src/features/workspace-grid/model/persistence.ts](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/workspace-grid/model/persistence.ts)
- [Restorable surface contract](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/workspace-grid/model/capabilities.ts)
- [Tab operations and cap](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/workspace-grid/model/itemOps.ts)
- [Shortcut catalog](https://github.com/rsaryev/localix/blob/main/apps/ui/src/shared/lib/keybindings/catalog.ts)
  ·
  [platform chord engine](https://github.com/rsaryev/localix/blob/main/packages/kit/src/keyboard/chord.ts)
  ·
  [cross-platform contracts](https://github.com/rsaryev/localix/blob/main/apps/ui/src/shared/lib/keybindings/chord.test.ts)
- [Composer context state](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/chat/model/useContextRefs.ts)
- [Live tab context](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/workspace-grid/model/liveTabMessageContext.ts)
- [Context reference grammar](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/context-refs.ts)
- [Interactive terminal](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/terminal/ui/TerminalPane.tsx)
