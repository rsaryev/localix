# Build a plugin with the agent

The agent can build a mini app from a description: it scaffolds one, writes its tools and interface,
checks and builds it, and can inspect it through the browser tool. Use it to get a working
workbench, such as a meal tracker, a dashboard or a board game, without writing the code yourself.

**Trust boundary:** A mini app the agent creates is enabled when it is created, and its native code
runs unsandboxed in the Localix API process. Read what it made before you rely on it.

![A working Release Checklist fixture plugin beside its demo conversation](../assets/screenshots/plugins/agent-build--2026-10-07.png)

The screenshot uses a functioning Release Checklist fixture with a counter checked through a real UI
toggle. Its conversation is seeded illustrative content; the frame is not a recording of an agent
creating the plugin.

## What you can do

| Capability                  | Mechanism                                                                          | Boundary                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Create a plugin             | Run `/plugin create <what it should do>`; the agent calls `plugin_build`.          | The host creates the plugin only on that tool call, under `~/.localix/plugins`.   |
| Change one it built         | Ask in the same chat; the agent edits and calls `plugin_build` again.              | Failed verification checks do not publish new artifacts; source edits remain.     |
| Get a native interface      | The agent writes `ui/register.tsx` against the host's own kit.                     | A style check rejects hand-rolled controls and palette colours.                   |
| Give the agent new tools    | The plugin's tools register with the agent with no glue code.                      | A tool must declare its effect, or a read-only session refuses even its reads.    |
| Let the plugin start a turn | A UI action calls `ctx.host.wake`, as the bundled games do.                        | A wake is one short message and only the plugin's own tools; see the wakes guide. |
| Look at the result          | The build report asks the agent to inspect the plugin when `browser` is available. | The running UI still needs visual and interaction verification.                   |

## How it works

`/plugin create` starts an agent turn that requires the `plugin_build` tool. The agent names the
plugin, and the host does the rest:

1. It forks the System Overview template into `~/.localix/plugins/<name>` and enables the copy only
   after the untouched template passes the non-residue checks. Template-domain residue is expected
   for this initial build. A failed creation removes its copy after activation rollback succeeds; if
   rollback cannot be confirmed, it leaves the copy and reports that state.
2. The copy has both layers: `.claude-plugin/plugin.json` names the plugin and carries its skill,
   and `.localix-app/app.json` holds the mini app's category and settings. The agent is instructed
   to replace the template's domain with yours and write the tools, tests, and a matching skill, or
   delete `skills/`. The build writes the mini app's `backend`; the agent leaves it alone.
3. Each `plugin_build` call checks template residue, style, routes, message context, the backend and
   UI builds, types and tests, in parallel. Output is published only when every check passes. The
   workbench swaps the new interface in place, with no restart.
4. When `browser` is available, the agent is instructed to open `plugin:<name>`, take a screenshot,
   and exercise the interface. Without it, the agent must report that visual and interaction checks
   were not run. Passing build checks does not enforce this final inspection.

The tool call's `description` means **create a new plugin**, even if the requested name already
exists. The host normalizes the name and selects a free suffix, trying up to twenty candidates. Use
the name returned by the tool. For subsequent builds, omit `description` and pass that name;
including it again creates another copy. The command itself refuses an active or agentless session.

A mini app keeps state and shows it, and the chat agent does the understanding. Because that agent
already reads the files and photos you attach, a meal photo can arrive as a call to a calorie
counter's own `log_meal` tool with structured items. That workflow needs no separate upload, OCR, or
model service in the app. The same split serves a deployment dashboard whose tools read your
cluster, a research board that ranks notes with the embedding model, or a game whose opponent is a
decision model; [what a mini app can use](plugins.md#what-you-can-build) lists the host's APIs.

A plugin can also answer back. The bundled chess, checkers, battleship, tic-tac-toe and 2048 plugins
call `ctx.host.wake` when you move, so your move starts an agent turn and its reply lands on the
same board.

## Limits

- No duration is promised. Creation is an agent turn followed by a build and a test run, and its
  length depends on the model and on what you ask for.
- The agent stays inside the plugin's folder because its instructions say so. That is not an
  operating-system sandbox.
- A user plugin's `fileAssociations` do not register operating-system file handlers. Desktop
  handlers are fixed when the app bundle is built.
- The tests step runs existing `*.test.ts`/`*.test.tsx` files. With no matching files it passes
  without a test run; passing does not establish coverage of the requested feature.
- Check failures preserve previously published artifacts but do not undo source edits or side
  effects caused by tests. Publication swaps backend and UI outputs in sequence with rollback
  attempts; filesystem or activation errors need inspection before assuming recovery succeeded.
- A valid authored copy can be rebuilt; bundled first-party plugins are not built through this
  service. A name collision never edits the existing copy during creation.
- The checks cover structure, style, builds and tests. They do not review what the plugin's code
  does or prove its behavior, visual quality, or external service compatibility.

## Related guides

- [Build a plugin or a mini app](plugins.md)
- [Build workbench UI](plugin-ui.md)
- [Wake the agent from a plugin](plugin-wakes.md)
- [Annotate a live preview](../features/visual-feedback.md)

## Source of truth

- [The model-facing tool](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/plugin-build.ts)
- [The authoring service and its checks](https://github.com/rsaryev/localix/tree/main/apps/api/src/features/plugins/authoring)
- [The `/plugin create` command](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/service/command-handlers-plugins-create.ts)
- [The template every plugin forks](https://github.com/rsaryev/localix/tree/main/mini-apps/template)
