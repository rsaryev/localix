# Build a mini app with the agent

The agent can build a mini app from a description, in Localix or in Claude Code: it scaffolds one,
writes its tools and interface, checks and builds it, and installs it into Localix. Use it to get a
working workbench, such as a meal tracker, a dashboard or a board game, without writing the code
yourself.

**Trust boundary:** A mini app the agent installs is enabled when it is installed, and its native
code runs unsandboxed in the Localix API process. Read what it made before you rely on it.

![A working Release Checklist fixture mini app beside its demo conversation](../assets/screenshots/plugins/agent-build--2026-10-07.png)

The screenshot uses a functioning Release Checklist fixture with a counter checked through a real UI
toggle. Its conversation is seeded illustrative content; the frame is not a recording of an agent
creating the mini app.

## What you can do

| Capability               | Mechanism                                                                                  | Boundary                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Create a mini app        | Describe what it should do, with the plugin's `create` command, in Localix or Claude Code. | Needs the plugin installed; the app is created in the current project, or in the folder you name. |
| Change one it built      | Ask in the same chat; the agent edits, runs `mini-app check` and installs again.           | A failed check installs nothing; the installed version keeps running.                             |
| Get a native interface   | The agent writes `ui/register.tsx` against the host's own kit.                             | A style check rejects hand-rolled controls and palette colours.                                   |
| Give the agent new tools | The mini app's tools register with the agent with no glue code.                            | A tool must declare its effect, or a read-only session refuses even its reads.                    |
| Let the app start a turn | A UI action calls `ctx.host.wake`, as the Localix marketplace's games do.                  | A wake is one short message and only the app's own tools; see the wakes guide.                    |
| Share it                 | The plugin's `publish` command packs it into a catalog other people add in Store.          | Hosting the catalog's files is up to you; see [publishing](mini-app-publishing.md).               |

## How it works

Making a mini app is the job of the authoring plugin, a Claude Code plugin from the
[Localix marketplace](https://github.com/rsaryev/localix-marketplace). Install it in Localix from
the Store (Plugins); in Claude Code, add it with:

```text
/plugin marketplace add rsaryev/localix-marketplace
/plugin install mini-app-authoring@localix
```

Localix itself only runs and manages mini apps: it installs, updates, enables and validates them.
The plugin and Localix meet in the **mini app kit** — the SDK and UI kit declarations, the host
theme, the prebuilt backend modules and Localix's own validation rules, published with every release
as `mini-app-kit.tar.gz` — and in one install request.

1. `mini-app create <name>` forks the plugin's Daily Log template into a new folder and checks the
   fresh copy. Template-domain residue is expected at this point; every other check passes.
2. The copy is a mini app: `mini-app.json` holds its name, description, category, settings and
   commands, and `guide.md` tells the agent which tool does what, read with `MiniAppGuide` before it
   first uses the app. The agent replaces the template's domain with yours and writes the tools, the
   tests, a guide for the new domain and an icon of its own (`mini-app icon`). The routes, storage,
   live updates and search between the tools and the screen are the SDK's, so the agent writes the
   data model, the tools and the screen. After every edit, the plugin's hook reports what in that
   file breaks Localix's rules.
3. `mini-app check` runs template residue (including an icon that is still the template's),
   manifest, style, routes, store media, message context, the backend and UI builds, types and
   tests, and reports each.
4. `mini-app install` builds the package — the built backend and UI, the manifest, guide and icon,
   without sources or tests — and hands it to the running Localix, which validates it, installs it
   under `~/.localix/mini-apps/<name>` and switches it on. Installing again from the same folder
   updates it. When Localix is not running, the plugin starts the installed app; when it is not
   installed, the plugin's `get-localix` command downloads the latest release, verified against its
   checksums.

After you change an installed mini app's files by hand, `/mini-app reload` in Localix reloads every
mini app.

The template it starts from, Daily Log, shows the pattern: entries the agent logs from what you say
or show, a daily goal and unit set in Settings, and a screen with today's total, a chart of the week
and a quick-add form. A setting you change reaches the mini app's backend without a restart.

A mini app keeps state and shows it, and the chat agent does the understanding. Because that agent
already reads the files and photos you attach, a meal photo can arrive as a call to a calorie
counter's own `log_meal` tool with structured items. That workflow needs no separate upload, OCR, or
model service in the app. The same split serves a deployment dashboard whose tools read your
cluster, a research board that ranks notes with the embedding model, or a game whose opponent is a
decision model; [what a mini app can use](mini-apps.md#what-you-can-build) lists the host's APIs.

A mini app can also answer back. The turn-based games of the Localix marketplace call
`ctx.host.wake` when you move, so your move starts an agent turn and its reply lands on the same
board.

## Limits

- No duration is promised. Creation is an agent turn followed by builds and a test run, and its
  length depends on the model and on what you ask for.
- The agent stays inside the mini app's folder because its instructions say so. That is not an
  operating-system sandbox.
- A user mini app's `fileAssociations` do not register operating-system file handlers. Desktop
  handlers are fixed when the app bundle is built.
- The tests step runs existing `*.test.ts`/`*.test.tsx` files. With no matching files it passes
  without a test run; passing does not establish coverage of the requested feature.
- Localix refuses to install over a mini app from the catalog, or over a folder of yours it did not
  install itself.
- The checks cover structure, style, builds and tests. They do not review what the mini app's code
  does or prove its behavior, visual quality, or external service compatibility.

## Related guides

- [Build a mini app](mini-apps.md)
- [Mini apps](../features/mini-apps.md)
- [Build workbench UI](mini-app-ui.md)
- [Wake the agent from a mini app](mini-app-wakes.md)
- [Annotate a live preview](../features/visual-feedback.md)

## Source of truth

- [The authoring plugin](https://github.com/rsaryev/localix-marketplace/tree/main/plugins)
- [The kit's validation tools](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mini-apps/kit-tools.ts)
- [Installing a local package](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/mini-apps/local-install.ts)
- [The template every mini app forks](https://github.com/rsaryev/localix-marketplace/tree/main/plugins)
