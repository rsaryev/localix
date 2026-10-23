# Plugin apps

**Availability:** macOS desktop only.

A [mini app](../extending/plugins.md) with a screen of its own can also run as its own Mac app: a
Dock icon, a window, a menu bar and a place in Cmd+Tab, Spotlight and Launchpad. Localix stays the
host. Each app has one project of its own, its conversations are the app's history, and the agent
works beside the mini app in each of them. Everything runs in Localix, on the same data you see in
the workspace.

Mini apps stay tabs in the workspace until you choose otherwise; nothing becomes an app on its own.

## Install a mini app as an app

Any of these does the same:

| Where                    | Do this                                                                         |
| ------------------------ | ------------------------------------------------------------------------------- |
| A plugin's tab           | Right-click the tab and choose **Install _Plugin_ as App**.                     |
| The tab strip            | With the plugin's tab on screen, click the app button at the right of the tabs. |
| The plugin's rail button | Right-click it and choose **Install _Plugin_ as App**.                          |
| The command palette      | Run **Install _Plugin_ as App**.                                                |

Localix draws the app's icon from the plugin's own glyph on a black tile like Localix's, creates the
app in `~/Applications/Localix Apps`, makes the app's project and opens it. From there it is an
ordinary Mac app: keep it in the Dock, open it from Spotlight or Launchpad, or drag it anywhere you
keep apps.

The app's project is named after the app and lives in `~/.localix/apps/<plugin>`. It appears in the
workspace's project switcher like any other project, so you can open the app's conversations from
Localix too, and its permissions, agent and mode are the project's own.

A plugin offers one app, whichever of its tabs you install it from: a board and a task card of the
same plugin open the same app, on the plugin's main screen.

## Use the app

The window shows the plugin's main screen with the conversation beside it. The agent there is the
same agent as in the workspace, so a game's opponent, a board's planner or a tool's operator works
the way it does in a tab. The app opens on the conversation you last used in it.

The title row beside the window buttons is the app's path, as in Localix: the app's name, then the
conversation. Open the conversation to see the app's history and switch to an earlier one.

- **New chat** at the right of the title row starts a new conversation in the app: a new game, an
  empty board.
- **Open in Localix** (Shift+Command+O, in the app's menu) shows the same conversation in the
  workspace.
- When an agent in the app's conversation waits for you, a number appears on the app's Dock icon.
- The window remembers its size and position. It uses the same glass and theme as the workspace.

## Localix runs in the background

The app needs Localix. When Localix is not running, opening the app starts it in the background: the
app's window appears and Localix keeps no window of its own on screen. Open Localix from its Dock
icon or menu-bar icon to see the workspace.

Quitting Localix quits its apps, as quitting a browser closes its installed web apps. If Localix
stops unexpectedly, an open app starts it again and reconnects.

## Open, reinstall or remove

When a plugin is already an app, the same places offer **Open _Plugin_ App** and **Remove _Plugin_
App**. Removing moves the app to the Trash; the plugin itself stays in Localix. Deleting the app in
Finder does the same.

After a Localix update, its apps are brought up to date on the next launch and keep their names and
icons. To pick up a new icon, remove the app and install it again.

Removing the app keeps its project and history. Installing the app again reopens them. Deleting the
project in Localix hides it there; the app brings it back the next time it opens.

If you turn a plugin off or remove it, its app still opens and shows its conversations, and the
Event Center keeps one entry saying the plugin is turned off. The entry clears itself once the
plugin is on again.

## Limits

- macOS only. The Windows and Linux desktop apps, and Localix in a browser, keep plugins as tabs.
- A mini app needs a screen of its own (the button it adds to the rail) to become an app. A plugin
  in the Claude Code format with no mini app has no screen, so it stays in the agent.
- A development build keeps its apps separately, in `~/Applications/Localix Dev Apps`, and they need
  the development servers running.

## Related guides

- [Plugins and mini apps](../extending/plugins.md)
- [Build a plugin with the agent](../extending/build-with-the-agent.md)
- [Native workspace tabs](native-workspace-tabs.md)

## Source of truth

- [Installing and refreshing app bundles](https://github.com/rsaryev/localix/blob/main/apps/desktop-tauri/src-tauri/src/app_bundle.rs)
- [The app runner](https://github.com/rsaryev/localix/blob/main/apps/desktop-tauri/src-tauri/src/app_runner.rs)
- [Install actions and icons](https://github.com/rsaryev/localix/tree/main/apps/ui/src/features/plugin-apps)
- [The app page](https://github.com/rsaryev/localix/blob/main/apps/ui/src/pages/chat/model/useMiniApp.ts)
