# Run an external agent CLI

Use the bundled External Agents Workspace to launch Claude Code or Codex in an interactive Localix
terminal. This is useful when the CLI should work in the session's current directory while the
Localix session keeps an inspectable link to the work.

**Requires:** Install the selected CLI and keep the bundled plugin enabled.

## What you can do

| Outcome              | Mechanism                                                          | Boundary                                                              |
| -------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Launch Claude Code   | `/external-agents:claude` drives its interactive terminal.         | The `claude` executable is required.                                  |
| Launch Codex         | `/external-agents:codex` drives its interactive terminal.          | The `codex` executable is required.                                   |
| Inspect the live run | The plugin correlates the terminal with the CLI's native session.  | Correlation depends on the CLI's supported screen and history shapes. |
| Know when it settles | `external_agent_sessions` reads observed state and can wait on it. | Nothing is injected into the CLI, so no report arrives on its own.    |

The [plugin guide](../extending/plugins.md) owns installation, activation, and native-code trust.
This recipe covers only the external-CLI workflow.

## How it works

### 1. Check the CLI executable

Run the check for the CLI you plan to use:

```bash
command -v claude
command -v codex
```

You should see an executable path for the selected CLI. An empty result means Localix will not be
able to start that command from its terminal environment.

### 2. Check the bundled plugin

Open **Settings → Capabilities → Plugins** and confirm that **External Agents Workspace** is
enabled. It is bundled and defaults on, but an explicit saved setting can disable it.

You should see the `external-agents` commands in the composer command menu after the plugin is
enabled for the current scope.

### 3. Delegate one bounded task

Run one of these commands with a self-contained task:

```text
/external-agents:claude inspect the failing route test and report the cause
/external-agents:codex update the parser and run its focused tests
```

The command expands a plugin prompt for the Localix agent. You should then see it open an
interactive terminal, start the selected CLI in the session directory, and submit the refined task.

### 4. Follow the terminal state

Read the terminal before answering a prompt. The Codex workflow can stop at its approval menu; the
Claude Code workflow uses its non-interactive permission flag after any first-run warning.

You should see the live delegation enter the External Agents Workspace roster with a live state.
That state is observed — the rendered screen classified against a detection manifest, and the CLI's
own transcript — so nothing arrives in the parent session on its own: wait on the delegation's key
with `external_agent_sessions`, or check the roster on a later turn.

### 5. Verify the result in Localix

Open the changed files, source-control view, or relevant preview and run the checks that matter for
the task. The CLI operates in the session directory, so its file changes should appear on those
workspace surfaces.

You should finish with observed files and check output, not only the external CLI's final prose.

## Configuration

| Command or API                   | Effect                                            | Boundary                                                    |
| -------------------------------- | ------------------------------------------------- | ----------------------------------------------------------- |
| `/external-agents:claude <task>` | Starts the bundled Claude Code terminal workflow. | Requires the enabled bundled plugin and `claude` on `PATH`. |
| `/external-agents:codex <task>`  | Starts the bundled Codex terminal workflow.       | Requires the enabled bundled plugin and `codex` on `PATH`.  |

## Limits

- The bundled commands cover Claude Code and Codex. The plugin can read several other CLIs'
  supported history formats, but that does not create launch commands for them.
- The bundled command is a model-driven macro. It instructs the Localix agent to operate a PTY; it
  is not a hard-coded host transaction.
- A delegation is never asked to report back, so live state is inferred rather than declared. An
  `unknown` state is never treated as success, and an unconfirmed `idle` says so.
- There is no host path for driving an arbitrary headless CLI. The bundled commands operate a PTY
  the way a person would; a plugin that wants another CLI writes its own tool and spawns it itself.
- Native plugins execute trusted local code in the API process. They are not sandboxed.
- If the command is absent, re-enable the bundled plugin and start a fresh run so the scope reloads.
  If a terminal opens but its state never settles, inspect its screen — the manifest may not
  classify what that CLI version renders.

## Related guides

- [Choose a delegation mechanism](../features/delegation.md)
- [Respond to human-in-the-loop requests](../features/hitl.md)
- [Extend Localix with plugins](../extending/plugins.md)
- [Use hooks and slash commands](../features/hooks-and-commands.md)

## Source of truth

- [Bundled commands and activation](https://github.com/rsaryev/localix/blob/main/plugins/external-agents/plugin.json)
- [Observed terminal state](https://github.com/rsaryev/localix/blob/main/plugins/external-agents/backend/live/observe.ts)
- [External-agent tool registration](https://github.com/rsaryev/localix/blob/main/plugins/external-agents/backend/index.ts)
- [External-agent wait contract](https://github.com/rsaryev/localix/blob/main/plugins/external-agents/backend/tools/agent-sessions-schema.ts)
