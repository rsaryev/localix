# Build workbench UI

A mini app's workbench UI is a built ES module artifact that the API serves and the running
workbench loads, replaces and unloads without reloading the app. Use this page to create a mini app
of your own, reach the host through its UI kit, and understand how an edit reaches the screen.

## Terminology

| Term           | Meaning                                                                                                   | Boundary                                                          |
| -------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| UI artifact    | `dist/ui/` in a mini app's folder: an entry, hashed chunks, styles, a manifest.                           | Built by the app from the mini app's `ui/` sources.               |
| Revision       | A hash of every artifact file, carried in the mini app record.                                            | Moves when the UI changed, not when the backend or docs did.      |
| UI kit         | `@localixai/kit/<id>`: the host's explicit public component surface.                                      | Public components; SDK services are separate host ports.          |
| Shared module  | React, `@localixai/mini-app-sdk` and the kit, taken from the host at runtime.                             | Every other dependency is bundled into the artifact.              |
| Mini app kit   | What each release ships to build mini apps: template, shared-module exports, theme CSS, validation tools. | `resources/mini-app-kit` and the release's `mini-app-kit.tar.gz`. |
| Frame / domain | The template's fixed shell versus the part a copy replaces.                                               | The frame imports no domain module.                               |

## What you can do

| Task                           | Mechanism                                                       | Boundary                                                             |
| ------------------------------ | --------------------------------------------------------------- | -------------------------------------------------------------------- |
| Create a mini app              | `/mini-app-authoring:create <what it should do>`                | The mini-app-authoring plugin; in Localix or Claude Code.            |
| Check, build and install it    | `mini-app check`, then `mini-app install`                       | Leftovers, style, builds, types, the mini app's tests.               |
| Look at it and use it          | The agent's `Browser` tool with `url: "mini-app:<name>"`        | snapshot, take_screenshot, steps, console; no evaluate.              |
| Use a host control             | Import it from `@localixai/kit/<id>`                            | Typed by its real props; an `@/…` import fails the build.            |
| Draw a graph or a board        | `Canvas` from `@localixai/kit/canvas`                           | The host's camera and edge; never bundle `@xyflow/react`.            |
| Take any app link              | `readMessageBindingDrag`, `linksInText` (`kit/context-links`)   | A drop or a pasted `@session:…`/`localix://…` is the same link.      |
| Show an app link               | `ContextBindingPreview` from `@localixai/mini-app-sdk/ui`       | The host draws it: a file, a session, a message, a tool call's card. |
| Act on the mini app's state    | `send()` from the frame's `ui/usePolledSnapshot.ts`             | The route answers with the new state.                                |
| Hear what the agent wrote      | `useStoreSnapshot` + `createStoreFeed` (frame)                  | A nudge per store write in one scope; re-read via the route.         |
| Follow a live stream           | `createRealtimeFeed`, `useRealtimeFeed` (`ui/realtime-feed`)    | One subscription per key; resubscribes after a reconnect.            |
| Complete what is typed         | `useMiniAppTextInputCompletion` + `textInputCompletionSurfaces` | Surface id `<app>.<field>`; open tabs are added by the host.         |
| Keep what the user creates     | `openJsonStore` from the frame's `backend/store.ts`             | Under `ctx.dataDir`; one change at a time per file.                  |
| Keep what one chat creates     | `ctx.sessionStorage.resolveDataDir(userId, sessionId)`          | Removed with the chat and every session beneath it.                  |
| Keep tabs in their workspace   | The default work-item scope (`'session'`)                       | Scoped instances stay in their root workspace.                       |
| Know the tab's own chat        | `useWorkItemSessionId()` from `ui/work-item-session`            | The only session a tab acts for; the SDK has no active session.      |
| React to file changes          | `useMiniAppWorkspaceChanges` (`ui/runtime-hooks`)               | One chat, coalesced; poll only when source coverage is unavailable.  |
| Use icons                      | Import from `lucide-react`                                      | Bundled per icon from the mini app kit.                              |
| See an edit in the running app | Install again; the mini app is swapped in place                 | An open tab re-renders; the app is never reloaded.                   |

Open HTTP and HTTPS links with `miniAppExternal.open(url)` from
`@localixai/mini-app-sdk/ui/runtime`: the active conversation's Browser by default, the system
browser with `true` as the second argument, for flows such as OAuth. Mail and phone links use the
system handler; web links fall back to it when no conversation workspace is ready. System handoffs
retain the host's confirmation policy.

```text
/mini-app-authoring:create Show GPU temperature and fan speeds, and warn me above 85 °C
```

The whole text after the command is the request. The agent names the mini app (lower-kebab-case,
such as `gpu-monitor`) and runs `mini-app create`, which copies the
[System Overview reference template](https://github.com/rsaryev/localix/tree/main/mini-apps/template)
from the mini app kit into a new folder — the current project unless another folder is named — and
refuses a folder that already exists. To change a mini app, ask in chat; the agent checks and
installs it again.

The reference copy builds and passes its tests before its domain is changed. Its frame reaches the
domain only through the entries — `ui/Workspace.tsx`, and `createRoutes` and `register` in
`backend/index.ts` — so deleting the domain never breaks the frame.

For a new copy, `mini-app create` prints a numbered order of work — read the entries and the
patterns it needs, replace the domain, test, check, install, look, report — followed by the
contracts copies have broken before: the tool signature (`execute(_toolCallId, input)`,
`executionMode: 'sequential'` for a change), state kept with `openJsonStore`, actions through
`send()`, notifications through `toast`, and the published message context. `scaffold.json` names
the files in the reference that show each pattern (an acting tool, a state-changing route, a form
driven by `send`, a value derived with `useNow`), and the kit's digest lists the core controls with
their props.

`mini-app check` reports template residue first. It names every System Overview file, identifier,
and a missing test still in a copy. A fresh copy fails this step by design; its first report is the
to-do list. `mini-app install` refuses a copy until every step passes.

The other checks cover the host's design tokens (the same rules the repository guard applies to the
app), palette colours, and native controls such as `<button>` where the kit has a control. They also
cover the manifest (with Localix's own validation, carried in the kit), routes, store media, backend
and UI builds, types, and the mini app's tests. The report lists each failed step and its problems;
build and type diagnostics include file locations when available. Between checks, the plugin's edit
hook reports the style, route and message-context problems in each file the agent edits.

The type check uses a `tsconfig.json` the check writes into the mini app, mapping each importable
module to the declarations the mini app kit ships: the SDK and the workspace packages its
declarations import, React, `zod`, `hono`, `lucide-react`, Bun and Node, and the UI kit. The
editor's language server reads the same file, so the diagnostics an agent sees after an edit match
the build. The compiler is TypeScript's JavaScript build, run on the app's Bun in a child process,
so it works on every platform the app ships to.

Kit declarations are generated at staging from the host sources: each component's own props, the
element attributes it forwards, and the host types it names. They are then compiled with nothing
skipped, and a module that does not compile falls back to its export names.

## See and drive a mini app

A mini app's view renders inside the workbench, not in a page with a URL. The `Browser` tool
addresses it as `mini-app:<name>`: `open` records the target, and every command for it is claimed by
the workbench, which opens the mini app's tab (its rail viewlet, or its only work-item kind) and
runs the command against that panel with the same actuator a page probe uses, scoped to the panel.

A session view belongs to the named session's root workspace. A command from the agent targets that
workspace's tab; when the person is in another chat, the command is refused with that reason instead
of reading the other chat's view, and the agent reads the mini app's state with the app's tools.

| Action                          | On a mini app view                                                                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `snapshot`, `take_screenshot`   | The panel's tree and picture, named after the view; the desktop app copies the picture from the screen, so a large view costs no DOM re-render. |
| `steps` (click, type, press, …) | As on a page; selectors and Tab order stay inside the panel.                                                                                    |
| `console`                       | The mini app's own errors: its uncaught errors and console calls, and render crashes.                                                           |
| `evaluate`, `viewport`          | Refused: `evaluate` would run inside the Localix app, not in a page the mini app owns.                                                          |

An open mini app tab's context tells the agent this address, so "take a screenshot of the app" and
"click Pods in DevOps" need no guessing.

## How it works

1. The app builds a user mini app itself, from the mini app kit it ships: the backend into
   `dist/backend/index-<hash>.mjs` (a new file per build; the mini app's `backend` is pointed at it,
   so a running module is never replaced under the app) with `hono`, `zod` and
   `@localixai/mini-app-sdk/backend` taken from the kit, the UI into `dist/ui/`, and the tests run
   on the Bun binary the app ships. First-party mini apps are built the same way at staging, except
   that a release leaves their UI source maps out; a user mini app's artifact keeps its maps.
2. The API reads the artifact manifest into the mini app record's `ui` field and serves the files
   under `/rpc/mini-apps/<name>/ui/`, confined to `dist/ui/`. A mini app that did not ship with the
   app is served only once the user enabled it, the same consent as a native backend.
3. The workbench runtime converges on the capability snapshot. A new revision is imported first,
   styled, and then swapped: the mini app's old contributions are removed from every registry and
   the new ones registered. A mini app that left the enabled set is unloaded. An open tab of the
   mini app re-reads its registration on the swap and remounts under the new one, so it shows the
   new build at once and a tab that had crashed recovers; other mini apps' tabs keep their state.
4. Shared imports read the host's instance. React is available synchronously; SDK and kit modules
   are awaited. Other permitted imports go through the bundler's resolver.

A build that fails keeps the artifact that last built; the mini app's backend and tools keep
running. The host checks resolved imports against the mini app, the shipped kit, and installed
packages before publishing. Generated output paths and `tsconfig.json` cannot follow symlinks
outside the mini app. When a UI build succeeds, one previous revision's hashed chunks remain
available for lazy imports already requested by an open tab.

### A tab that belongs to one chat

Work items default to session scope; `scope: 'global'` is the app-level exception. Session tabs are
placed in the root conversation's workspace. Child sessions share that workspace; display scope does
not merge their server-side data ownership.

- Reopening the same scoped instance reveals its tab; distinct instance ids can create multiple
  tabs. Another root workspace gets its own instance rather than moving the existing tab.
- `useWorkItemSessionId()` reads context derived from the tab's display scope. For a session tab
  this is the root workspace's session. Use it explicitly in requests; it does not follow the chat
  on screen or recover a child id from an open payload.
- Every open names its chat: `openWorkItem({ …, scope })`, `openFile({ sessionId, … })`,
  `openDiff({ sessionId, … })`, `openPreview({ sessionId, … })`, `composer.insert({ sessionId, … })`
  and the terminal calls. The host refuses a session tab that names none.
- A tool opens a chat's tab by putting the session in its URI. The anchor that resolves the URI
  returns it as `session`, and the tab opens in that chat even if the person has switched away. A
  bare URI opens in the chat the link was followed from.
- Deleting the chat closes its tab. The host also removes the mini app's data for that chat
  (`ctx.sessionStorage`).

`scope: 'global'` is for an app-level surface that reads no session at all. It is visible in every
chat, `useWorkItemSessionId()` is `null` inside it, and it opens with `scope: null`. A surface that
sends to a chat, opens a chat's files or calls its backend for a chat is a session kind.

Instance ids passed to `miniAppWorkspace.openWorkItem` must begin with the registered owner's name
and a colon, such as `my-app:report-42`. The host rejects another namespace. Use the hook's session
context, not the opaque `item.scope`, for session requests.

That data lives under `ctx.sessionStorage.resolveDataDir(userId, sessionId)`. The routes (boot-time
backend) and each run's tools both carry it, and both resolve the same folder for a session:

- **Deletion.** Deleting a chat removes its folder for every mini app, and the folder of every
  session beneath it, whether or not the chat is filed in a project. A startup sweep removes any
  folder whose session is gone.
- **Which session to pass.** In a route, `c.env.sessionId`; the host sets it only after checking the
  user owns the session. In a tool, `context.session.id`.
- **A session that no longer exists.** `resolveDataDir` rejects rather than recreating its folder.

The bundled games are built this way. Tic-Tac-Toe, Checkers, Chess and Battleship each keep one
board per chat, played against the agent in that chat.

An open board hears the agent's move instead of polling for it. Every `openJsonStore` write nudges
the views that follow its folder over the realtime socket: `createStoreFeed` in the backend,
`useStoreSnapshot` in the view (frame tag `c`, commands `<app>:store.subscribe`). The folder is
resolved with the socket's own user, so a view can follow only a chat that user owns. The nudge
names the mini app and the chat, never the state, so the view re-reads through its route.

The view polls at its own cadence until native watcher coverage is confirmed and while the socket is
down. A healthy feed has no periodic read. The shared SDK `createStoreChangeFeed` covers committed
store writes and external file edits; `useStoreSnapshot` lives in `ui/store-snapshot`. After a
reconnect it re-reads once, because a nudge sent while the socket was down is lost.

### A live stream of your own

For any other live data, the backend registers a `wsFrames` entry (a subscribe and an unsubscribe
command, a one-letter frame tag other than `s`, `r` and `n`, and `start(params, send, { userId })`).
The view follows it with `createRealtimeFeed` from `@localixai/mini-app-sdk/ui/realtime-feed`,
created once at module level:

```ts
export const boardFeed = createRealtimeFeed<string, BoardEvent>({
  tag: 'b',
  subscribe: (sessionId) => ({ t: 'kanban:board.subscribe', sessionId }),
  unsubscribe: (sessionId) => ({ t: 'kanban:board.unsubscribe', sessionId }),
  decode: (json) => JSON.parse(json) as BoardEvent,
  route: (event) => event.sessionId,
})
```

`feed.follow(key, { frame, live, reconnect })` returns the release. In a component,
`useRealtimeFeed(feed, key | null, follower)` follows while the key is not `null` and returns
whether the stream is live. The feed handles these for you:

| Concern         | What the feed does                                                                       |
| --------------- | ---------------------------------------------------------------------------------------- |
| Shared keys     | Surfaces on one key share one subscription; the last release unsubscribes.               |
| Routing         | One listener parses each frame; `route` gives a key id, a test, or `null` for every key. |
| Reconnect       | Each key resubscribes and its followers get `reconnect`: frames in the gap are lost.     |
| Live            | Set by the subscribe's answer, or only by status frames with `status`; down on a drop.   |
| Late answers    | An answer to a subscribe that was since released or replaced changes nothing.            |
| Hidden document | With `pauseWhileHidden`, keys unsubscribe while hidden and resubscribe when shown.       |

A follower is told when liveness changes; `feed.live(key)` gives the state when it joins. Keep a
fallback poll while the feed is unavailable. Keep a healthy-feed timer only for a named source the
subscription cannot cover, such as metrics without a push API.

### Files that change under a chat

A view that mirrors the disk — a repository's status, an index of the code — hears changes instead
of polling for them. `miniAppFiles.watchWorkspace(sessionId, listener, { windowMs, onLive })`, or
the hook `useMiniAppWorkspaceChanges(sessionId, onChange, { windowMs })`, delivers
`{ sessionId, paths }` for that chat's workspace:

| Field / answer | Meaning                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------- |
| `paths`        | Absolute: each changed entry and its directory, `.git` included (its object store is not watched).                  |
| `paths: null`  | Coarse: too many to list, a watcher restart, or a reconnect that may have missed some. Re-read everything you show. |
| Window         | Batches fold for `windowMs` (500 ms by default) from the first change; steady churn still delivers once per window. |
| Live           | `onLive` / the hook's result. `false` for a remote session or a failed watcher, `null` until the host answers.      |

Subscribing arms the host's watcher for that chat, so it works whether or not the file tree is open.
Use `useFileResourceSync` for file-backed lists and editors: it coordinates reads, rejects stale
answers, and polls only while the watcher is unavailable. A sandboxed view (`views`) never receives
file paths; this door belongs to native workbench UI only.

See [Mini app synchronization](mini-app-sync.md) for source coverage, host-bound scopes, caches,
recovery, and draft policies.

### Places in the host's own surfaces

These registrations put a mini app inside surfaces the host lays out, while the host names no mini
app:

| Registration                                                         | What it adds                                                                                             | Boundary                                                                               |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `host.toolCards.register({ tool, presentation, Component? })`        | The label, noun, verb and icon a mini app tool reads with in the transcript, and optionally its own card | Name a tool your backend registers. First owner of a name wins; disabled → generic.    |
| `host.commentActions.register({ id, label, Icon, run })`             | A button beside **Send** on a comment batch; `run` receives `{ sessionId, title, summary, files }`       | Comments clear only after `run` resolves. Shown where the batch offers actions.        |
| `host.actions?.register({ id, label, Icon, when, run })`             | A contextual content action; receives `{ sessionId, surface, target }`                                   | Optional on older hosts. The mini app decides visibility, persistence and destination. |
| `host.sessionSurfaces.register({ surface: 'composer.header', ... })` | A strip above the chat's composer, passed `{ isFocused }` as its `context`                               | Every warm composer renders it; hold a live subscription only while focused.           |

Build a card from `@localixai/kit/tool-card` (`ToolLine`, `ToolBody`, `IORow`, `OutputBlock`, …) so
it reads like every built-in card. Label its sections the way they do: `In` for what the call was
given, `Out` for what came back and `Error` for a failure. Pass `prose` to `OutputBlock` for natural
language, which wraps at words; code and JSON stay monospace. The file editor's review comments
offer contributed actions. The Kanban mini app contributes its board card in the transcript,
**Task** on a comment batch, and the chat's open cards above the composer.

The host never imports the destination mini app. `ActionTarget` distinguishes code, visualizations,
Markdown blocks, tables, images, links and files; `surface` identifies the host-owned place, such as
`chat.content`. A synchronous, inexpensive `when(context)` controls visibility and is checked again
before the host calls `run(context)`. The owning session is supplied with the target; do not
substitute the currently active chat. Contributions disappear when their mini app is disabled or
unloaded. Use `ActionSurfaceProvider` when composing a new surface; a null surface suppresses
actions during streaming, and `board.element` distinguishes embedded board content from chat
fragments.

When eligibility depends on live mini app state, provide optional `subscribe(context, onChange)`.
The host calls `when` again when the mini app signals a change, and releases the subscription when
the fragment is hidden or removed. Keep `when` free of I/O; share reads and subscriptions inside the
mini app so many fragments do not each fetch the destination. Project Space uses this seam to hide
an action for content already on its board and restore it after deletion or undo.

```ts
host.actions?.register({
  id: 'example:save-code',
  label: 'Save code',
  Icon: Save,
  when: ({ surface, target }) => surface === 'chat.content' && target.kind === 'code',
  run: async ({ sessionId, target }) => saveCode(sessionId, target),
})
```

### A failure, and the program it needs

Report a failure with `useProblemReport` and render it as `ProblemLine` or, when the failure is the
whole pane, `ProblemState`; a missing or stopped external program is a `Prerequisite` with one
recovery action. [Report mini app failures](mini-app-problems.md) owns the details.

### A board

`@localixai/kit/canvas` is the board every graph in the app is drawn on: the Code Graph map and its
call lens, and the database relationship diagram. The host owns the camera, so every board moves the
same way:

| Input                          | Result                                               |
| ------------------------------ | ---------------------------------------------------- |
| Scroll, two fingers            | Pan in any direction, tracking the fingers           |
| Pinch, ⌘/Ctrl + scroll         | Zoom toward the pointer (WebKit pinch included)      |
| `+` / `−`, the controls        | Step through 10–250%; the percentage returns to 100% |
| Shift+1 / Shift+2 / Shift+0    | Fit everything / fit the selection / 100%            |
| Arrow keys, Shift + arrow keys | Pan by a small / a large step                        |

A board chooses `interaction`: `navigate` (drag pans, nothing moves) or `edit` (drag selects,
Space + drag or the middle button pans, nodes move and connect). Wrap the board and whatever drives
its camera in `CanvasProvider`. `useCanvasCamera()` moves the camera: `fit`, `focus`, `focusNode`,
`zoom`. `useCameraPlacement(key, place)` places it once per content key, so a poll never moves it.
An edge without a `type` is drawn by `CanvasEdge`, themed from its `data` (`emphasis`, `tone`,
`weight`, `arrow`, `label`, `route`). Take `Handle` and `Position` from the kit as well: a mini app
that bundles its own `@xyflow/react` has a second store its nodes cannot reach.

With reduced motion set on the system, every camera move lands at once. Use `prefersReducedMotion()`
from `@localixai/kit/platform` for any camera move you animate yourself. `captureBoard(frame, rect)`
renders one board rectangle as a PNG, whatever the camera shows. `keyboardHelp(interaction)` gives
the camera's keys, for a shortcuts sheet of your own. An edge's label is marked
`data-canvas-edge-label` with its `data-emphasis`, so a board can hide labels when zoomed out and
keep the focused one.

## Configuration

| Setting                          | Where                                     | Effect                                                   |
| -------------------------------- | ----------------------------------------- | -------------------------------------------------------- |
| `ui/register.tsx`                | Mini app sources                          | The artifact entry; a mini app without it ships no UI.   |
| `backend/index.ts`               | Mini app sources                          | The backend source the app builds.                       |
| `backend`                        | `mini-app.json`                           | Written by the build: the backend build that runs.       |
| Shared-module rule               | `@localixai/mini-app-sdk/ui-artifact`     | Which specifiers come from the host.                     |
| Mini app CSS and utility classes | Imported `.css` and Tailwind classes      | Built into the artifact's stylesheets on the host theme. |
| Script and style sources         | `tauri.conf.json` content security policy | Allows the local API origin for artifacts.               |

## Limits

Use `MarkdownRenderer` from `@localixai/kit/markdown` with source as `children`; see
[Shared Markdown](markdown.md) for renderer options and boundaries.

- A user mini app's backend may import only `hono`, `zod`, `@localixai/mini-app-sdk/backend`,
  `node:*`, `bun:*` and its own files; its UI only the shared modules, `zod`, `lucide-react` and its
  own files.
- A user mini app's tests run with `bun:test`; rendering tests need the host's DOM harness, which
  only first-party mini apps have.
- A kit type from a package the kit does not ship (Radix, cmdk, Monaco, the flow library behind
  `@localixai/kit/canvas`) is declared `any`, and a kit module whose generated declarations do not
  compile is typed by export name only. `noImplicitAny` stays off for mini apps.
- The `Browser` tool cannot reach inside a sandboxed third-party mini app view (an HTML view
  declared in a manifest); it drives native mini app UI.
- A mini app edit remounts that mini app's panels; React Fast Refresh does not preserve state inside
  a mini app.
- A dependency that `require`s a shared module synchronously is supported only for React.
- Avoid top-level `await` in a mini app: it is outside the host's page-lifetime protection. Shared
  imports use host-controlled awaits whose promises stop settling after `pagehide`, to prevent the
  observed WebKit reload failure. Hiding a workbench tab is not the same as ending the page
  lifetime.

## Related guides

- [Build a mini app](mini-apps.md)
- [Report mini app failures](mini-app-problems.md)
- [Author a skill](skills-authoring.md)
- [Keyboard ownership](keyboard-ownership.md) — scoped commands must yield to controls and overlays.

## Source of truth

- [Shared-module and artifact contract](https://github.com/rsaryev/localix/blob/main/packages/mini-app-sdk/src/ui-artifact.ts)
- [Mini app kit layout](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mini-apps/kit-layout.ts)
  and [its staging](https://github.com/rsaryev/localix/blob/main/scripts/stage-mini-app-kit.mjs)
- [The mini-app-authoring plugin](https://github.com/rsaryev/localix/tree/main/plugins/mini-app-authoring)
- [UI artifact builder](https://github.com/rsaryev/localix/blob/main/plugins/mini-app-authoring/src/build/ui-build.ts)
  and [its tests](https://github.com/rsaryev/localix/blob/main/scripts/mini-app-ui-artifact.test.ts)
- [Template layout and residue check](https://github.com/rsaryev/localix/blob/main/plugins/mini-app-authoring/src/scaffold/template-layout.ts)
- [Style check](https://github.com/rsaryev/localix/blob/main/plugins/mini-app-authoring/src/check/style.ts)
  and
  [the token rules](https://github.com/rsaryev/localix/blob/main/apps/api/src/contracts/ui-token-rules.ts)
- [Kit declarations](https://github.com/rsaryev/localix/blob/main/scripts/stage-mini-app-kit-declarations.mjs)
- [Mini app view host](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/inspector/model/miniAppViewHost.ts)
  and
  [the embedded actuator](https://github.com/rsaryev/localix/blob/main/packages/visual-feedback/src/embedded/index.ts)
- [Mini app record and file route](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mini-apps/ui-artifact.ts)
- [Workbench runtime](https://github.com/rsaryev/localix/blob/main/apps/ui/src/shared/contrib/miniAppUiRuntime.ts)
  and
  [host wiring](https://github.com/rsaryev/localix/blob/main/apps/ui/src/shared/contrib/miniAppUiDiscovery.ts)
- [Shared-module registry](https://github.com/rsaryev/localix/blob/main/apps/ui/src/app/miniAppSharedModules.ts)
- [Realtime feed](https://github.com/rsaryev/localix/blob/main/packages/mini-app-sdk/src/ui/realtime-feed.ts)
- [Tool cards](https://github.com/rsaryev/localix/blob/main/packages/mini-app-sdk/src/ui/tool-cards.ts),
  [comment actions](https://github.com/rsaryev/localix/blob/main/packages/mini-app-sdk/src/ui/comment-actions.ts)
  and
  [session surfaces](https://github.com/rsaryev/localix/blob/main/packages/mini-app-sdk/src/ui/contrib.ts)
- [UI kit](https://github.com/rsaryev/localix/tree/main/apps/ui/src/app/kit)

- [Tab scopes](https://github.com/rsaryev/localix/blob/main/apps/ui/src/entities/workspace-grid/model/scope.ts)
  and
  [instance guard](https://github.com/rsaryev/localix/blob/main/apps/ui/src/shared/contrib/uiContrib.ts).
