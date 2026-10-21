# Plugin apps: design and ownership

A plugin app is a plugin installed as its own macOS app. The user guide is
[Plugin apps](../features/plugin-apps.md). This page covers how it is built and what each part owns.

## The shape

The pattern is the one Chrome uses for installed web apps (`app_mode_loader` in
`~/Applications/Chrome Apps.localized`) and Parallels for Windows apps (`WinAppHelper` in
`~/Applications (Parallels)`): a generated bundle with its own bundle id, name and icon, signed ad
hoc, whose `Info.plist` names the host. macOS gives each bundle its own Dock icon, menu bar, Cmd+Tab
entry and window frame. Unlike both, the app draws its window itself: it is a WKWebView over the
host's runtime, so no window crosses a process boundary and no private API is involved.

```text
Kanban.app (bundle id ai.localix.tauri.app.kanban; a clone of the Localix binary)
  │ 1. main() sees LocalixPlugin in its Info.plist and runs app_runner, never the Tauri shell
  │ 2. reads the runtime endpoint; none live → open -g Localix.app --args --background
  ▼
NSWindow + NSVisualEffectView + WKWebView ─ localix-app://app/index.html (the host's UI build)
  │ __LOCALIX_APP = {plugin, name, projectDir}, __LOCALIX_API_PORT = <port>
  ▼
Localix (runtime, plugins, data; workspaces held back until Localix itself is asked for)
```

## Rules

1. **Localix is the only host.** The app has no runtime, no database and no plugin code of its own.
   It reads the runtime's endpoint descriptor (`~/.localix/localix.db.api-runtime.json`) and talks
   to that runtime like any client. Everything the app shows can be rebuilt from the host.
2. **The bundles are the record.** The installed list is read from
   `~/Applications/Localix Apps/*.app`; there is no table to reconcile. A bundle deleted in Finder
   is simply gone.
3. **Opt in only.** A plugin is a tab until a person installs it. The manifest has no field for it:
   an app is the person's choice, not the author's.
4. **One binary, one version.** The app's executable is an APFS clone of the host binary and its
   page is the host bundle's UI build, so the app never runs a UI older than its host. A host build
   that differs from the one recorded in the bundle (`LocalixHostBuild`) re-clones on launch.
5. **One plugin, one project.** An app's conversations live in a project of its own
   (`~/.localix/apps/<plugin>`), so its history, rules, agent and mode are a project's, served by
   the projects and sessions features as they are. No membership table, no new API.
6. **The app is the ordinary client.** The page is the web workspace with `chrome="app"`: the title
   row and the grid, no rail, sidebar or status bar. It adds no endpoint, store or notification
   producer, and reuses the workspace's own parts (the breadcrumb, the title-row measurement, the
   new-chat action) rather than copies of them.

## Native host

| Concern                                    | Owner                                                              |
| ------------------------------------------ | ------------------------------------------------------------------ |
| Install, refresh, open, remove, quit       | `app_bundle.rs`; Info.plist and host paths in `app_bundle_host.rs` |
| Plugin name, Finder name, bundle id        | `app_bundle_names.rs` (the manifest's `PLUGIN_NAME_RE`, bounded)   |
| Workspace commands (`plugin_app_*`)        | `app_bundle_commands.rs`, trusted workspaces only                  |
| `.icns` from the page's PNG renditions     | `app_icon.rs`                                                      |
| Runner entry, window, host wait            | `app_runner.rs`                                                    |
| Endpoint, host launch, paths, MIME, CSP    | `app_runner_host.rs` (pure, unit-tested)                           |
| Serving the UI build                       | `app_runner_scheme.rs` (`localix-app://app`)                       |
| Page messages, navigation, Open in Localix | `app_runner_web.rs`                                                |
| Loading the page, scripts run before paint | `app_runner_page.rs`                                               |
| File panel, alert, confirm, links out      | `app_runner_ui.rs`                                                 |
| Menu bar                                   | `app_runner_menu.rs`                                               |
| Glass                                      | `app_runner_glass.rs`, materials from `window_material.rs`         |

- **Background launch.** `--background` sets `WindowData.held`: workspaces load and report first
  paint but `reveal` keeps them hidden. `show_main_window` (Dock click, menu-bar item, a deep link,
  **Open in Localix**) ends the hold through `release_hold` and reveals them the way first paint
  would have. The hold is never saved, so the next ordinary launch shows the saved layout.
- **Waiting for the host.** The runner checks the endpoint every 250 ms while waiting and every 2 s
  once connected. A live endpoint on a new port reloads the page. With no endpoint it starts the
  host once per wait, and only when no process of that host is running: opening a running Localix
  again would be a reopen, which shows its windows. After 60 s it says so.
- **Quitting.** `RunEvent::Exit` terminates every installed app; the apps cannot work without their
  host.
- **One change at a time.** Install, refresh and removal share a lock; a launch's refresh can meet
  an install from the workspace.
- **Install.** `install` makes the project folder, stages and signs the bundle, then swaps it in
  whole. It returns the folder, and the workspace finds or creates the project before it opens the
  app (`ensurePluginAppProject`), so an app always opens into its own project.
- **Title row.** The page lies under a transparent titlebar with the title hidden. Before every load
  the runner injects the workspace's own measurement (`native_chrome::measure` and `apply_script`:
  `--titlebar-height`, `--native-window-button-gap`, `data-fullscreen`) and re-measures on entering
  and leaving fullscreen, for the page on screen and the next load. A press on an element that
  itself carries `data-tauri-drag-region` posts `drag` (or `zoom` on a double press), and the runner
  calls `performWindowDragWithEvent` or `performZoom`: Tauri's contract, without Tauri.
- **Signing.** `codesign --force --sign -` over the finished bundle. A bundle made on the Mac has no
  quarantine, so Gatekeeper runs it. LaunchServices is told at once (`lsregister -f`).

## The page

- **Entry.** `app/main.tsx` applies the app's remembered conversation as the first route before the
  router loads (`applyPluginAppStartRoute`). The page passes `isColdIndex: false` to the URL sync,
  so neither the home draft nor the last-workspace restore runs: either would land in another
  project and mint a draft there. `stampPluginAppDataset` sets `data-desktop` for the stylesheet
  only: the kit's glass coats and system font apply, while the JavaScript `isDesktop` stays false
  because there is no shell to invoke. `useTheme` and the anti-FOUC script in `index.html` skip the
  inline fill for the same reason the macOS workspace does.
- **Conversation.** `usePluginApp` finds the app's project, then opens the conversation recorded in
  view state (`surface`, key `plugin-app:<plugin>`) while it is still one of the project's, else the
  project's newest, else a new one (`pluginAppConversation.ts`, read from the hydrated roster). Any
  conversation of the project the person opens becomes the remembered one; one elsewhere is visited,
  not adopted. The plugin's main screen (the rail viewlet it contributes) opens once in each. **New
  chat** in the title row and every other entry run the page's new-chat action, which the app
  replaces (`replaceNewChat`) with a new conversation in its project.
- **Title row.** `TitlebarContent` with `app` draws the workspace's `UnifiedBreadcrumb` with the
  app's name as its root, not a project switch, and the conversation crumb listing the app's
  project: the app's history. New chat sits at the right of the row.
- **Plugin turned off.** One standing problem in the Event Center (`pluginAppProblem.ts`,
  `toast.problems`), keyed to the app and settled when the plugin is back. A `toast.warning` would
  write a new durable row on every launch.
- **Window messages.** The page posts JSON to `window.webkit.messageHandlers.localixApp`: `theme`
  (material and appearance), `session` (for **Open in Localix**) and `badge` (attention items in the
  app's conversation). The runner validates each one.
- **Origin.** The API accepts `localix-app://app` beside `tauri://localhost`
  (`apps/api/src/lib/local-origin-guard.ts`). No web page can claim that origin; a local process can
  already call the API directly.

## Change feed

The app writes nothing of its own. Its project and conversations are created and renamed through the
projects and sessions endpoints, whose repositories record their change notices in the same
transaction (C1), and every window re-reads on the poke (C6). Nothing in another feature has to
react to an app, so there is no consumer: deleting a conversation removes it from the app's history
through the session's own notice, and deleting the project soft-deletes it until the app's next
`resolve-path` revives it, which is that endpoint's documented behaviour.

## Install actions

`features/plugin-apps` owns the installed list (read from the shell, refreshed on focus), the
actions and the icon. `pluginAppSourceForKind` maps any tab kind to its plugin's main screen, so a
group's button and every tab's menu name the plugin they act on. Icons are drawn on a 1024 canvas
with Localix's tile (896 points, radius 196, `#121215` to `#09090b`) and the plugin's glyph in
`#e7e6e6`, then sent as PNG renditions; the renderer is imported only when an install starts.

## Verification

| Question                                    | Evidence                                                                                 |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Endpoint, paths, MIME, CSP, plist, icon     | `cargo test --lib app_` in `apps/desktop-tauri/src-tauri`                                |
| Start route, dataset, window messages, icon | `bun test apps/ui/src/shared/lib/pluginApp.dom.test.ts apps/ui/src/features/plugin-apps` |
| New chat in an app                          | `bun test apps/ui/src/pages/chat/model/useNewChatAction.dom.test.tsx`                    |
| Which conversation an app opens             | `bun test apps/ui/src/pages/chat/model/pluginAppConversation.test.ts`                    |
| Origin                                      | `bun test apps/api/src/lib/local-origin-guard.test.ts`                                   |

The native window, the background launch and the Dock need a feel check on a Mac after a build:
install a plugin, quit Localix, open the app from the Dock, and confirm Localix starts without a
window and the app reconnects after Localix restarts.
