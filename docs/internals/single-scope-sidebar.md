# Workspace scope and sidebar

The workspace sidebar shows the sessions of one project at a time. Use this contract when changing
routed navigation, session selection, sidebar projection, or per-scope workspace restoration.

## Terminology

| Term              | Meaning                                                               | Boundary                                                   |
| ----------------- | --------------------------------------------------------------------- | ---------------------------------------------------------- |
| Workspace scope   | One project id. `null` only before the route resolves one.            | Controls the routed roster and project-scoped settings.    |
| Session scope     | The active session id used by the editor-grid visibility filter.      | Controls session tabs, not project membership.             |
| Global grid scope | The reserved `@global` grid scope, for app-level kinds only.          | Settings, Usage, the Store; never a session's tab.         |
| Routed location   | Scope, session, and optional rail section encoded in the URL.         | It becomes authoritative after workspace hydration.        |
| Scope memory      | Best-effort local state restored when returning to a workspace scope. | Memory seeds navigation; it does not replace the live URL. |

## What you can do

| Action                             | Mechanism                                                                | Boundary                                                         |
| ---------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Switch between projects            | Use the breadcrumb or **Switch workspace** palette.                      | The switch navigates to a bare scope, then resolves its session. |
| Browse the active workspace roster | The sidebar projects root sessions matching `activeProjectId`.           | Title filtering is scope-local.                                  |
| Open a result from another scope   | Session navigation carries the target session's project id.              | `selectSession()` does not repair a mismatched scope.            |
| Follow forks, threads, and workers | Child sessions aggregate beneath their owning root chat.                 | Workers are not separate workspace scopes.                       |
| Start a chat in the current scope  | Sidebar, breadcrumb, shortcut, and palette actions pass the route scope. | Empty drafts can be reused by non-sidebar entry points.          |
| Restore where a scope was left     | Local storage remembers its session, section, and desktop sidebar state. | Storage failures degrade to defaults.                            |
| Keep session tabs separated        | The grid shows the active session's items plus app-level items.          | Singleton tabs are one per session, opened with an explicit id.  |

## How it works

### Route to store

The URL carries workspace identity through `/project/:projectId/...`. Navigation helpers build those
paths, and `useUrlStoreSync()` applies the route to the chat store in project- then-session order.

| Stage              | Mechanism                                                                        | Boundary                                                       |
| ------------------ | -------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Pre-render restore | `restoreShellFrame()` loads the last cached project frame before React mounts.   | This temporary projection is reconciled after route hydration. |
| Scope navigation   | `switchProject()` writes a bare scope path.                                      | UI handlers do not call `selectProject()` directly.            |
| Scope reduction    | `selectProject()` records the project and resolves its remembered valid session. | A route naming a session selects that session afterward.       |
| Session navigation | `goToSession()` combines the session id with an explicit project when supplied.  | Omitting the project keeps the current route scope.            |
| Legacy link        | `/chat/:id` resolves membership from the hydrated session summary and redirects. | A missing summary returns to the neutral route.                |

`selectSession()` updates session focus without writing `activeProjectId`. Routed callers therefore
must navigate with the destination session's project id. Tests cover both mismatch directions so a
session detail cannot silently move the workspace scope.

### Sidebar projection

`useSidebarSessions()` starts from the complete session summary list, then keeps root chats whose
project membership matches the active workspace scope. It sorts that list, applies the local title
filter, and derives nested forks, threads, and workers for the tree renderer.

The message-history search is separate. It sends a debounced query to the server-side search and can
return sessions from another workspace scope; selecting a hit navigates with that session's project
id.

### Breadcrumb and grid

`UnifiedBreadcrumb` derives `scope / root session / descendants` from the active session chain.
Scope and session segments expose inline choices, while deeper segments navigate among related
sessions.

The grid uses the active session id as `activeScope` — for VISIBILITY only. Which scope a tab lives
in is never taken from it: every open names its session, and `resolveOpenScope`
(`entities/workspace-grid/model/scope.ts`) stamps that session, or `@global` for an app-level kind,
and refuses a session kind that names none. Session-scoped items are visible only in their scope,
while items stamped `@global` remain visible. Every tab body reads its own session from
`useWorkItemSessionId()`, provided by the grid around each body. That grid scope is a different
thing from the project workspace scope the sidebar uses — same word, different axis.

## Configuration

### Routes

| Route pattern                               | Meaning                               |
| ------------------------------------------- | ------------------------------------- |
| `/project/:projectId/:sessionId?/:section?` | One project workspace scope.          |
| `/chat/:sessionId?/:section?`               | Legacy input redirected after lookup. |

### Remembered state

| Storage key                  | Value                                                  | Boundary                                           |
| ---------------------------- | ------------------------------------------------------ | -------------------------------------------------- |
| `localix_active_project_id`  | Last project scope.                                    | Used by cold-start shell restoration.              |
| `localix_active_session_id*` | Last active session, per project.                      | An id is reused only while it remains valid.       |
| `localix_workspace_location` | Rail section and desktop sidebar open state per scope. | Mobile sidebar state stays transient.              |
| `localix_editor_view_state`  | Caret and top line keyed by session and path.          | LRU-capped at 300 entries; not an editor snapshot. |

All storage helpers tolerate unavailable, corrupt, or partial local storage.

### Navigation controls

| Control                   | Default action                              |
| ------------------------- | ------------------------------------------- |
| Sidebar scope title       | Opens **Switch workspace**.                 |
| `mod+alt+p`               | Opens the project quick-switcher.           |
| `mod+k`                   | Opens the session switcher.                 |
| Sidebar or breadcrumb `+` | Creates a chat in the current routed scope. |

`mod` is Command on macOS and Control on other supported desktop platforms. Keybindings can be
changed in Settings.

## Limits

- The URL is authoritative after hydration, but the pre-render shell snapshot writes a temporary
  `activeProjectId` so the first frame is not empty.
- `selectSession()` deliberately does not validate that the selected session belongs to the active
  workspace scope. Correct navigation depends on callers carrying the session's project id.
- Sidebar title search covers the active workspace only. Cross-workspace discovery requires the
  separate message-history search.
- Per-scope rail-section and sidebar-open restoration is desktop-only. The mobile drawer remains a
  transient overlay.
- Global grid items are shared across session changes and read no session. A singleton (Browser,
  Problems, Activity, Search) is one tab per session; a restored layout drops a session tab saved
  without a session.
- Workspace memories use browser local storage and do not synchronize between clients or machines.
- This design changes navigation and projection, not the server session schema. Membership remains
  the session's stored project id.

## Related guides

- [Sessions and projects](../features/sessions-and-projects.md)
- [Workspace](../features/workspace.md)

## Source of truth

- [Route grammar and builders](../../apps/ui/src/shared/routing/routes.ts)
- [Routed navigation](../../apps/ui/src/shared/hooks/useRoutedNavigation.ts)
- [URL-to-store synchronization](../../apps/ui/src/pages/chat/model/useUrlStoreSync.ts)
- [Project scope reducer](../../apps/ui/src/entities/chat/model/projectActionsSlice.ts)
- [Pre-render shell restoration](../../apps/ui/src/entities/chat/model/restoreShellFrame.ts)
- [Sidebar projection](../../apps/ui/src/entities/chat/model/useSidebarSessions.ts)
- [Workspace location memory](../../apps/ui/src/entities/chat/model/workspaceLocation.ts)
- [Grid visibility rule](../../apps/ui/src/entities/workspace-grid/model/scope.ts)
- [Unified breadcrumb](../../apps/ui/src/entities/chat/ui/UnifiedBreadcrumb.tsx)
- [Scope source-of-truth tests](../../apps/ui/src/entities/chat/model/scopeSourceOfTruth.test.ts)
