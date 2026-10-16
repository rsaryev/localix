# Run an external agent CLI

Use an installed coding-agent CLI in a Localix terminal, or continue one of its recorded native
sessions. External history, transcript viewing and usage statistics are built into Localix.

## Start a session

1. Install and authenticate the CLI you want to use outside Localix.
2. Start a Localix chat in the project where the CLI should work.
3. Open the **Localix** agent pill above the composer and choose an installed coding agent. Localix
   links it to this chat and opens its terminal in the chat's working directory.
4. Use the CLI's own terminal controls for authentication and permission prompts. The Localix chat
   and composer remain available alongside it.

You can also launch a CLI manually in a project terminal:

| Agent          | Basic launch command |
| -------------- | -------------------- |
| Claude Code    | `claude`             |
| Codex          | `codex`              |
| opencode       | `opencode`           |
| Gemini CLI     | `gemini`             |
| GitHub Copilot | `copilot`            |
| Hermes         | `hermes`             |

Only detected executables appear in the agent-link menu and native-history views. The runtime prompt
gives shell-capable Localix agents the installed CLI names and basic commands; there is no
external-agent plugin or bundled slash command to enable.

## Continue an existing session

Choose a native CLI session from the history panel for the selected directory. Localix creates or
reuses a normal chat linked to that native identity, then requests its terminal. It preserves the
recorded timestamps and keeps the external messages in the CLI's own history; it does not import
those messages into the Localix chat.

For a transcript preview, browse **External Agents** under `@resource:` or open a session from
external statistics. Reading the preview starts no CLI and creates no chat. **Open in …** uses the
same linked-chat flow to continue the exact native session. All six adapters declare continuation
commands; an unavailable source produces an error instead of starting a different conversation.

Reopening a linked chat reuses its live terminal. If the terminal has closed, Localix needs a saved
native identity to resume it. A CLI that closed before its identity was discovered cannot silently
start afresh in that linked chat; see
[opening failures](../features/external-agents.md#opening-failures).

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
- Native messages remain in the external history; linking adds identity, not transcript copies.
- Linked context is sent to your selected model provider, like other composer context.
- Localix does not edit the original external history files.

## Related guides

- [External agent sessions](../features/external-agents.md)
- [Forks](../features/delegation.md)
- [Workspace and context](../features/workspace.md)

## Source of truth

- [Installed CLI detection](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/external-agents/installed.ts)
- [Linking a CLI to a chat](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/external-agents/backend/link-session-routes.ts)
- [Attaching native history](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/external-agents/backend/attach-session-routes.ts)
- [Opening or reusing the owned terminal](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/external-agents/backend/owned-session-routes.ts)
- [Native resume contracts](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/external-agents/backend/resume-session.ts)
- [Observed terminal state](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/external-agents/backend/live/observe.ts)
- [External-agent tool](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/external-agents/backend/tools/agent-sessions-tool.ts)
