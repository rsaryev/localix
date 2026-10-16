# Native workspace tabs

**Availability:** macOS desktop only.

Each native tab contains a complete workspace, with its own project, conversation, editor layout,
and Browser strip. The system window buttons share a row with the workspace breadcrumb; the native
tab bar appears below it.

## Create and select workspaces

In the macOS desktop app, **Command+T** opens a new native workspace tab in the current window. The
**Window** menu also provides **New Workspace Window**, next/previous workspace tab, **Move
Workspace Tab to New Window**, **Merge All Workspace Windows**, and a tab-bar toggle. The native tab
bar's **+** button opens another workspace tab.

Each native tab has its own selected project, conversation, editor grid and editor view state. Use
the project switcher inside a tab to choose its project. All tabs share one API runtime and
server-owned projects, conversations, settings and terminals. Opening the same conversation in
several workspaces does not duplicate its agent runtime.

## Move editor and Browser tabs

Native workspace tabs contain an entire workspace. Editor and terminal tabs sit inside it. Drag a
supported editor tab beyond the left or right edge of its window to move it to a new workspace
window. Drag above the window to move it to a new native workspace tab. Named destinations inside
the workspace provide the same actions, and the editor tab's context menu offers **Move to New
Window** and **Move to New Workspace Tab**.

The Browser's inner page tabs support the same drag destinations. Moving one page leaves the other
pages in the original Browser. Each native workspace saves its Browser strip independently.

Starting a drag immediately shows a provisional workspace that follows the cursor, including inside
the source window, without taking focus or intercepting mouse events. You can continue reordering
tabs in the same gesture. Releasing outside promotes that same prepared window; Escape or a drop
into the source disposes it. Provisional windows are excluded from saved workspace layouts. Dragging
from a fullscreen or maximized workspace creates a normal window at approximately half the display
size, subject to the workspace minimum size and available display area.

Before the destination interface is ready, a native preview shows a single snapshot of the visible
dragged pane, including the native Browser page. An inactive tab or conversation shows its own title
while loading, rather than another pane's content. The native window replaces the small tab drag
image and stays attached to the pointer.

## Close and restore workspaces

**Command+W** closes an editor tab inside the workspace. The red window button and
**Command+Shift+W** (**Window → Close Window**) request a save of pending writes, then hide the
entire native workspace group. Reopening Localix from the Dock or **Show Localix** in the menu bar
brings back the same tabs, order, selected workspace and routes. Each workspace reopens on the
conversation it last showed, in that conversation's project; if the conversation has since been
deleted, the workspace opens its project instead. The route is saved as soon as you open a
conversation, so a crash or force quit reopens it too. **New Workspace Window** creates a separate
fresh workspace.

Use a native workspace tab's close button or **Window → Close Workspace Tab** to remove that
workspace after a bounded save request. The last workspace remains hidden and reopenable.
**Command+Q** requests a save from every workspace and saves native groups for the next launch,
including groups whose windows are hidden. The save request has a time limit; an unresponsive
workspace may leave pending writes unsaved. Forced process termination does not guarantee the latest
grouping.

## Platform and shortcut limits

AppKit owns the titlebar and tab-bar geometry, including detached tabs and fullscreen. Native
workspace tabs are available only in the macOS desktop shell; browser, Windows and Linux clients
keep their editor grid. In macOS desktop, workspace-symbol search uses **Command+Option+Shift+O**
when its binding would otherwise use Command+T. File-search presets that use Command+T fall back to
Command+P; other overrides using Command+T are unassigned because AppKit reserves that key.

Saved window visibility is restored on launch. Older layouts without visibility information reopen
only the last active window group; the remaining groups stay hidden and available to reopen.

## Related guides

- [Workspace](workspace.md)
- [Keyboard shortcuts](keyboard-shortcuts.md)

## Source of truth

- [Native workspace menu](https://github.com/rsaryev/localix/blob/main/apps/desktop-tauri/src-tauri/src/workspace_menu.rs)
- [Editor and window close shortcuts](https://github.com/rsaryev/localix/blob/main/apps/desktop-tauri/src-tauri/src/menu.rs)
- [Workspace lifecycle](https://github.com/rsaryev/localix/blob/main/apps/desktop-tauri/src-tauri/src/workspace_lifecycle.rs)
- [Group visibility and reopening](https://github.com/rsaryev/localix/blob/main/apps/desktop-tauri/src-tauri/src/workspace_visibility.rs)
- [Saved group compatibility](https://github.com/rsaryev/localix/blob/main/apps/desktop-tauri/src-tauri/src/workspace_session_model.rs)
- [Bounded frontend flush](https://github.com/rsaryev/localix/blob/main/apps/desktop-tauri/src-tauri/src/frontend_flush.rs)
- [Drag previews](https://github.com/rsaryev/localix/blob/main/apps/desktop-tauri/src-tauri/src/workspace_drag_snapshot.rs)
- [Shortcut reservation](https://github.com/rsaryev/localix/blob/main/apps/ui/src/shared/lib/keybindings/resolve.ts)
