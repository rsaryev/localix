# Run an external agent CLI

Use an installed coding-agent CLI in a Localix terminal, or continue one of its recorded native
sessions. External history, transcript viewing and usage statistics are built into Localix.

## Start a session

1. Install and authenticate the CLI you want to use outside Localix.
2. Start a Localix chat in the project where the CLI should work.
3. Use **Claude Code** or **Codex** in the bottom bar when the corresponding executable is
   available. For another supported CLI, open a project terminal and run its basic command.

| Agent          | Basic launch command |
| -------------- | -------------------- |
| Claude Code    | `claude`             |
| Codex          | `codex`              |
| opencode       | `opencode`           |
| Gemini CLI     | `gemini`             |
| GitHub Copilot | `copilot`            |
| Hermes         | `hermes`             |

The launch buttons belong to the normal customizable bar. An absent executable means no launch
button or history entry for that agent. The runtime prompt gives shell-capable Localix agents the
installed CLI names and basic commands; there is no external-agent plugin or bundled slash command
to enable.

## Continue an existing session

Open **History → External**, then choose a session under its activity day and agent. The transcript
is read-only. **Import to Localix** creates a Localix chat from its readable turns, using the
recorded working directory's project when available.

For Claude Code, Codex and opencode, **Open in …** resumes the exact native session in a terminal.
Other providers offer viewing and import. A preview does not launch anything. Opening a terminal
from a global preview creates a Localix chat to own it.

## Let Localix investigate the conversation

Drag the external session into your Localix composer, use **Link to chat** in a preview opened from
that chat, or browse **External Agents** with `@resource:`. Ask the agent what it should investigate
and send the reference. It receives a bounded digest and the original key, then can use
`external_agent_sessions` to read more transcript windows, recorded tool calls and their results.

A link is a read-only reference, not an instruction to start a CLI. Starting and operating a
terminal still uses the normal tool permissions. Inspect the resulting files, source-control changes
and checks before relying on an external agent's answer.

## Limits

- Only supported CLIs found on the executable search path are exposed. History files alone are
  insufficient.
- History format support is adapter-specific. Missing token usage remains unknown, and bounded
  transcript reads disclose omitted turns.
- Live terminal state is inferred from observed screens. An unknown state does not mean success.
- Imported conversations are copies. They do not synchronize future native turns back into Localix.
- Linked context is sent to your selected model provider, like other composer context.
- Localix does not edit the original external history files.

## Related guides

- [External agent sessions](../features/external-agents.md)
- [Choose a delegation mechanism](../features/delegation.md)
- [Workspace and context](../features/workspace.md)

## Source of truth

- [Installed CLI detection](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/external-agents/installed.ts)
- [Native resume contracts](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/external-agents/backend/resume-session.ts)
- [Observed terminal state](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/external-agents/backend/live/observe.ts)
- [External-agent tool](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/external-agents/backend/tools/agent-sessions-tool.ts)
