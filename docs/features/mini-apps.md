# Mini apps

A mini app is an application inside Localix: a screen of its own, tools the agent can call, and a
guide that tells the agent how to use it. The Database, DevOps, Trading and Kanban workbenches and
the games are mini apps. Use this page to see your mini apps, switch them on or off, change their
settings, and create one of your own.

Mini apps are not plugins. A [Claude Code plugin](../extending/claude-code-plugins.md) adds skills,
commands, hooks and servers to the agent and is managed in Settings → Capabilities → Plugins and
with `/plugin`; a mini app is managed here.

**Trust boundary:** A mini app's backend runs as trusted code in the Localix API process. One you
add yourself waits for your yes before its code runs; one the agent builds for you starts on.

## What you can do

| Outcome                      | How                                                                        | Boundary                                                               |
| ---------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| See your mini apps           | `/mini-app list`, or Settings → Capabilities → Mini apps                   | The list shows the scope of the current chat's project.                |
| Add one from the store       | The **+** button in the rail, **Open the store** in Settings, or setup     | Nothing is installed until you choose it.                              |
| Update one                   | **Update** on its row in the store, or wait for the automatic update       | Shown when the catalog offers another version than yours.              |
| Add a publisher's catalog    | **Catalogs** in the store, or Settings → Mini apps → **Catalogs**          | Localix reads the address first and refuses one that is not a catalog. |
| Turn one on or off           | `/mini-app enable <name>`, `/mini-app disable <name>`, or the row's switch | A switch in Settings applies to the agent selected there.              |
| Change a mini app's settings | **Settings** on its row in Settings → Mini apps                            | Secret settings are kept in the [vault](secrets.md).                   |
| Remove one                   | `/mini-app remove <name>`, or **Remove** on its row or in the store        | Its data folder stays, so a reinstall finds it.                        |
| Have the agent build one     | `/mini-app create <what it should do>`                                     | See [Build with the agent](../extending/build-with-the-agent.md).      |
| Pick up edits to its files   | `/mini-app reload`                                                         | Rebuilds your own mini apps, then reloads every mini app.              |
| Open the list from the rail  | **Manage mini apps…** in the rail's tools menu                             | Opens Settings → Mini apps.                                            |
| Run one as its own Mac app   | **Install _Name_ as App** on its tab; see [Mac apps](mini-app-mac-apps.md) | macOS only, for a mini app with a screen of its own.                   |

Changes made with `/mini-app` take effect on the next turn.

## How it works

The store opens in its own tab, from the rail's **+**, from Settings → Mini apps and from setup. It
lists apps in three groups: **Updates**, **Installed** and **Available**. Each row shows the app,
what it does and one action: **Install**, **Update**, or how far a download has got. Category tabs
and the search narrow the list. A check mark means Localix verified the publisher. An app from an
unverified publisher shows the publisher's name, and its install asks **Install anyway?** first. An
app built for a newer Localix says so and cannot be installed.

The store reads the Localix catalog and any catalog you added. **Catalogs**, in the store's header
and in Settings → Mini apps, lists them; the Localix catalog is built in and stays, and an added one
can be removed. A catalog is an HTTPS address or a `file://` path to its `mini-app-catalog.json`.

A catalog's app arrives as an archive whose checksum the catalog pins. An archive that does not
match is discarded, and the version you had keeps running. Apps installed from a catalog take its
newer versions by themselves, a minute after start and then every six hours.

Each row in Settings → Capabilities → Mini apps shows the app's version, project scope, category and
what it brings: tools, screens, commands, a guide. A row marked **awaiting your yes** came from
outside Localix and has not run yet; **runs code** means its backend runs while it is on.

| Where it lives                         | What is there                                             |
| -------------------------------------- | --------------------------------------------------------- |
| `~/.localix/mini-apps/<name>/`         | Your mini apps, in every project, and the catalog's ones  |
| `<project>/.localix/mini-apps/<name>/` | A project's own mini apps                                 |
| `~/.localix/mini-apps-data/<name>/`    | What a mini app keeps; it outlives updates and reinstalls |

When a project's mini app has the same name as one of yours, yours wins and the project's copy is
hidden. To add a mini app by hand, copy its folder (with its `mini-app.json`) into one of these
places and run `/mini-app reload`.

A mini app's commands appear in the slash menu as `/<app>:<command>`, with chips and pickers for
their arguments. The agent sees one line per enabled mini app and reads the app's guide before it
first uses it.

When a mini app fails to load, or reports a problem itself, the Event Center shows it with an action
that opens the app's row in Settings → Mini apps. The entry clears once the app works again.

## Limits

- A mini app's backend is not sandboxed. Turning one on is consent, not isolation.
- `/mini-app enable` and `/mini-app disable` change whether the app runs; they do not delete it or
  its data.
- In a development checkout the store offers the checkout's own `mini-apps/` in place of the hosted
  Localix catalog.
- Apps from a catalog you added are always shown as unverified.
- Earlier versions kept mini apps under `~/.localix/plugins`. Those copies are removed at startup,
  and settings saved under the old names are not carried over.

## Related guides

- [Build a mini app](../extending/mini-apps.md)
- [Build a mini app with the agent](../extending/build-with-the-agent.md)
- [Mini apps as Mac apps](mini-app-mac-apps.md)
- [Install Claude Code plugins](../extending/claude-code-plugins.md)
- [Settings](settings.md)

## Source of truth

- [The `/mini-app` command](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/service/command-handlers-mini-apps.ts)
- [The mini apps feature](https://github.com/rsaryev/localix/tree/main/apps/api/src/features/mini-apps)
- [Where mini apps live](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mini-apps/paths.ts)
- [Settings → Mini apps](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/settings/ui/MiniAppsSettings.tsx)
- [Mini app conditions in the Event Center](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/notifications/conditions/mini-apps.ts)
- [The contract for plugins and mini apps](https://github.com/rsaryev/localix/blob/main/docs/internals/plugins-and-mini-apps.md)
