# Native workspace tabs

**Availability:** macOS desktop only.

The system window buttons sit beside the workspace breadcrumb in one compact row. Native workspace
tabs appear below it, leaving the editor and embedded browser clear of the controls.

Press **Command+T** to open another workspace in the current window's native tab bar. Each tab has
its own selected project, conversation and editor layout. Choose its project with the project
switcher. The tabs share one Localix API runtime.

Use **Window → New Workspace Window** to open a separate window. The Window menu can also select the
next or previous workspace tab, detach a tab, merge workspace windows and show or hide the native
tab bar. The tab bar's **+** button opens another workspace tab.

**Command+W** closes the focused editor tab. The red window button and **Command+Shift+W** (**Window
→ Close Window**) save pending writes and hide the entire workspace group. Reopen it from the Dock
or **Show Localix** in the menu bar to resume the same tabs in the same order, with the same
selected workspace. **New Workspace Window** always creates a fresh workspace.

The native tab's close button and **Window → Close Workspace Tab** close only that workspace;
closing the last workspace hides it until you reopen Localix. **Command+Q** flushes all workspaces
and saves their groups, order, selected tabs and routes before quitting, including hidden groups.
Restoration covers a clean quit or window hide, not a forced process termination.

For storage, shared-runtime behavior and shortcut conflicts, see
[Native workspace tabs on macOS](workspace.md#native-workspace-tabs-on-macos).
