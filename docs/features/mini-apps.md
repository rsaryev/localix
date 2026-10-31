# Mini apps

A mini app is an application inside Localix: a screen of its own, tools the agent can call, and a
guide that tells the agent how to use it. Localix ships none: Localix's own mini apps and plugins
are in the [Localix marketplace](https://github.com/rsaryev/localix-marketplace) and install from
the Store like anyone's. Use this page to see your mini apps, switch them on or off, change their
settings, and create one of your own.

Mini apps are not plugins. A [Claude Code plugin](../extending/claude-code-plugins.md) adds skills,
commands, hooks and servers to the agent and is managed in the Store (Plugins) and with `/plugin`; a
mini app is managed here.

**Trust boundary:** A mini app's backend runs as trusted code in the Localix API process. One you
add yourself waits for your yes before its code runs; one the agent builds for you starts on.

## What you can do

| Outcome                         | How                                                                                       | Boundary                                                                                                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| See your mini apps              | `/mini-app list`, or the Store (Mini apps)                                                | The list shows the scope of the current chat's project.                                                                                                       |
| Add one from the Store          | The **+** button in the rail (**Open the Store**), or setup                               | Only the recommended apps install without your choice.                                                                                                        |
| Get the recommended apps        | Nothing: a new installation installs them in the background                               | Once per app; one you remove is not added again.                                                                                                              |
| Update all at once              | **Update all** in the line above the message box, or in the Event Center                  | Only apps a marketplace installed; your own folders are left alone.                                                                                           |
| Update one                      | **Update** on its card in the Store, or wait for the automatic update                     | Shown when the marketplace offers another version than yours. Only an app from a signed marketplace updates on its own.                                       |
| Stop an app updating on its own | Its Store page → the **⋯** menu beside **Open** → untick **Update automatically**         | Offered for an app from a signed marketplace; its page says **Signed**, **Not signed** or **Signature changed** beside the publisher.                         |
| See what an app is              | Choose its card in the Store                                                              | Its page shows screenshots, its README, contents and plan.                                                                                                    |
| Install with its desktop app    | **Install as app** in the menu beside **Get** in the Store                                | macOS desktop only, for an app with a screen of its own.                                                                                                      |
| Add a publisher's marketplace   | Store → **Sources** → **Add source…**, or `/mini-app marketplace add <owner/repo or url>` | Localix reads it first; nothing is added until you choose **Add**.                                                                                            |
| See or remove marketplaces      | Store → **Sources**, a shelf's sources menu, or `/mini-app marketplace list`              | The Localix marketplace and Localix Community are built in and stay.                                                                                          |
| Turn one on or off              | `/mini-app enable <name>`, `/mini-app disable <name>`, or the row's switch                | A per-agent switch is on the agent's **Access** tab.                                                                                                          |
| Change a mini app's settings    | **Settings** on its row in the Store (Mini apps)                                          | Secret settings are kept in the [vault](secrets.md).                                                                                                          |
| Remove one                      | `/mini-app remove <name>`, or **Remove** on its card or in Store → **Installed**          | Its data folder stays, so a reinstall finds it.                                                                                                               |
| Have the agent build one        | Describe what it should do, with the authoring plugin installed                           | The plugin is in the [Localix marketplace](https://github.com/rsaryev/localix-marketplace); see [Build with the agent](../extending/build-with-the-agent.md). |
| Pick up edits to its files      | `/mini-app reload`                                                                        | Reloads every mini app and its tools, screens and commands.                                                                                                   |
| Open the list from the rail     | **Manage mini apps…** in the rail's tools menu                                            | Opens the Store (Mini apps).                                                                                                                                  |
| Run one as its own Mac app      | **Install _Name_ as App** on its tab; see [Mac apps](mini-app-mac-apps.md)                | macOS only, for a mini app with a screen of its own.                                                                                                          |

Changes made with `/mini-app` take effect on the next turn.

## How it works

Mini apps are added in the [Store](store.md), which opens in its own tab on its **Mini apps** shelf
from the rail's **+**, from the Store (Mini apps) and from setup. Each app has a tile with **Get**,
which becomes **Open** once it is installed and **Update** when a newer version is offered. Choosing
a tile opens the app's page: its screenshots, README, what is inside (screen, tools, backend and
commands), what would run on this computer and the version on offer.

A check mark means Localix verified the publisher. An app from an unverified publisher asks for your
yes first, in a sheet that says what would run and where it comes from. An app built for a newer
Localix says so and cannot be installed.

On the macOS desktop, an app with a screen of its own also offers **Install as app**, which makes it
an app with its own window, Dock icon and place in Spotlight once the install has landed. If the
desktop app cannot be made, the install stays and the card says why. An installed app's page has
**Add desktop app** or **Remove desktop app**. See [Mac apps](mini-app-mac-apps.md).

The Store reads the Localix marketplace, Localix Community and any marketplace you added.
**Sources** lists them under **Mini app marketplaces**, each with how many apps it offers; **Add
source…** reads an address and adds it only when you choose **Add**. Choosing a source opens the
Store filtered by it. A marketplace is an HTTPS address or a `file://` path to its
`mini-app-marketplace.json`, or a GitHub `owner/repo` whose latest release carries that file. A
publisher can link to theirs with
`localix://ui/work-item/mini-app-store/add-marketplace?url=<address>`, which opens the Store with
that dialog filled in. An app is `<app>@<marketplace>`, such as `notes@ada`; a marketplace's name is
unique on your computer, and you run one app of a name. See
[Mini app marketplaces](../extending/mini-app-marketplace.md) for the format.

**Get** on an app replaces what holds its name here: a mini app you built and installed from its
folder, or the same name from another marketplace. The data kept under that name stays, and the
confirmation says what gives way. A folder you put among your mini apps by hand is its only copy and
is never replaced, and apps Localix installs on its own replace nothing.

`/mini-app marketplace list` shows the marketplaces and how many apps each offers,
`/mini-app marketplace add <owner/repo or url>` reads one and adds it, replying with its publisher
and app count or why it was refused, and `/mini-app marketplace remove <name or url>` removes one
you added; the composer offers your marketplaces for it.

### Recommended apps

On a new installation, Localix installs the apps the Localix marketplace marks to install by default
in the background, without asking; the marketplace repository decides which. They come from that
marketplace like any other app, and the Event Center's **In progress** shows each download; when
they are in, one entry says so ("Installed 3 mini apps").

Offline, nothing is installed and Localix tries again later. Each recommended app is installed once:
remove one (`/mini-app remove <name>` or **Remove** in the Store) and it is not added again, and a
folder of your own by the same name is never replaced. An installation that already had mini apps
when this arrived gets nothing new.

Setup's **Add mini apps** slide shows the recommended apps with where each stands, a few more of
Localix's own to install in place, and **Open the Store** last; setup stays open.

Only the Localix marketplace can recommend an app: a marketplace you added cannot, whatever it says.

### Installing and updating in the background

An install or an update in progress shows in the Event Center's **In progress** with its progress,
and the bell shows a thin ring while anything runs. Updates on offer appear there too and in one
line above the message box: **2 mini app updates — Update all**, or **3 updates** when plugins have
updates too, since the Store offers every kind together. Localix's own update always comes first.
The line can be hidden with × until what it offers changes. When an install or update finishes, the
Event Center keeps one line: "Installed _Name_", "Updated 3 mini apps", or "Could not install
_Name_" with the reason and **Try again**.

A marketplace's app arrives as an archive whose checksum the marketplace pins. An archive that does
not match is discarded, and the version you had keeps running. Apps installed from a signed
marketplace take its newer versions by themselves, a minute after start and then every six hours.

Each row in the Store (Mini apps) shows the app's version, project scope, category and what it
brings: tools, screens, commands, a guide. A row marked **awaiting your yes** came from outside
Localix and has not run yet; **runs code** means its backend runs while it is on.

| Where it lives                         | What is there                                                |
| -------------------------------------- | ------------------------------------------------------------ |
| `~/.localix/mini-apps/<name>/`         | Your mini apps, in every project, and the marketplaces' ones |
| `<project>/.localix/mini-apps/<name>/` | A project's own mini apps                                    |
| `~/.localix/mini-apps-data/<name>/`    | What a mini app keeps; it outlives updates and reinstalls    |

When a project's mini app has the same name as one of yours, yours wins and the project's copy is
hidden. To add a mini app by hand, copy its folder (with its `.localix-mini-app/mini-app.json`) into
one of these places and run `/mini-app reload`.

A mini app's commands appear in the slash menu as `/<app>:<command>`, with chips and pickers for
their arguments. The agent sees one line per enabled mini app and reads the app's guide before it
first uses it.

When a mini app fails to load, or reports a problem itself, the Event Center shows it with an action
that opens the app's row in the Store (Mini apps). The entry clears once the app works again.

## Limits

- A mini app's backend is not sandboxed. Turning one on is consent, not isolation.
- `/mini-app enable` and `/mini-app disable` change whether the app runs; they do not delete it or
  its data.
- The core hosts no marketplace. The Localix marketplace publishes its own with each of its
  releases; the Store reads the latest one, and its featured and recommended apps come from it.
- Which apps were already offered is remembered in `~/.localix/mini-app-recommended.json`. Deleting
  that file does not reinstall anything while you have other mini apps.
- Apps from a marketplace you added are always shown as unverified.
- A marketplace can take an app back. A taken-back copy stops loading, its Store tile says **Taken
  back**, and its page gives the marketplace's reason, with **Remove** in its menu. Its data stays.

## Related guides

- [Build a mini app](../extending/mini-apps.md)
- [Build a mini app with the agent](../extending/build-with-the-agent.md)
- [Mini apps as Mac apps](mini-app-mac-apps.md)
- [Install Claude Code plugins](../extending/claude-code-plugins.md)
- [Settings](settings.md)

## Source of truth

- [The Store](https://github.com/rsaryev/localix/tree/main/apps/ui/src/features/store)

- [The `/mini-app` command](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/service/command-handlers-mini-apps.ts)
- [The mini apps feature](https://github.com/rsaryev/localix/tree/main/apps/api/src/features/mini-apps)
- [Where mini apps live](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mini-apps/paths.ts)
- [Mini app conditions in the Event Center](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/notifications/conditions/mini-apps.ts)
- [The contract for plugins and mini apps](https://github.com/rsaryev/localix/blob/main/docs/internals/plugins-and-mini-apps.md)
