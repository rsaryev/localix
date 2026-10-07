# Build a plugin with the agent

The agent can build a plugin from a description: it scaffolds one, writes its tools and interface,
builds and tests it, and opens it. Use it to get a working workbench, such as a meal tracker or a
board game, without writing the plugin yourself.

**Trust boundary:** A plugin the agent creates is enabled when it is created, and its native code
runs unsandboxed in the Localix API process. Read what it made before you rely on it.

![A working Release Checklist fixture plugin beside its demo conversation](../assets/screenshots/plugins/agent-build--2026-10-07.png)

## What you can do

| Capability                  | Mechanism                                                                 | Boundary                                                                          |
| --------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Create a plugin             | Run `/plugin create <what it should do>`; the agent calls `plugin_build`. | The host creates the plugin only on that tool call, under `~/.localix/plugins`.   |
| Change one it built         | Ask in the same chat; the agent edits and calls `plugin_build` again.     | A build that fails never replaces the one that works.                             |
| Get a native interface      | The agent writes `ui/register.tsx` against the host's own kit.            | A style check rejects hand-rolled controls and palette colours.                   |
| Give the agent new tools    | The plugin's tools register with the agent with no glue code.             | A tool must declare its effect, or a read-only session refuses even its reads.    |
| Let the plugin start a turn | A UI action calls `ctx.host.wake`, as the bundled games do.               | A wake is one short message and only the plugin's own tools; see the wakes guide. |
| Look at the result          | The agent opens the plugin in its `browser` tool before it reports done.  | It sees the built plugin, not a mock of it.                                       |

## How it works

`/plugin create` starts an agent turn that requires the `plugin_build` tool. The agent names the
plugin, and the host does the rest:

1. It forks the System Overview template into `~/.localix/plugins/<name>` and enables the copy only
   after the untouched template passes the checks. A copy that fails to enable is deleted.
2. The agent replaces the template's domain with yours and writes the plugin's tools, a skill and
   tests.
3. Each `plugin_build` call checks template residue, style, routes, message context, the backend and
   UI builds, types and tests, in parallel. Output is published only when every check passes. The
   workbench swaps the new interface in place, with no restart.
4. The agent opens the plugin at `plugin:<name>` through its `browser` tool, looks at it, and then
   tells you what it built.

A plugin keeps state and shows it, and the chat agent does the understanding. Because that agent
already reads the files and photos you attach, a meal photo can arrive as a call to the plugin's own
`log_meal` tool with structured items. The plugin builds no uploads, OCR or model calls of its own.

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
- The checks cover structure, style, builds and tests. They do not review what the plugin's code
  does.

## Related guides

- [Build plugins](plugins.md)
- [Build workbench UI](plugin-ui.md)
- [Wake the agent from a plugin](plugin-wakes.md)
- [Annotate a live preview](../features/visual-feedback.md)

## Source of truth

- [The model-facing tool](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/plugin-build.ts)
- [The authoring service and its checks](https://github.com/rsaryev/localix/tree/main/apps/api/src/features/plugins/authoring)
- [The `/plugin create` command](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/service/command-handlers-plugins-create.ts)
- [The template every plugin forks](https://github.com/rsaryev/localix/tree/main/plugins/template)
