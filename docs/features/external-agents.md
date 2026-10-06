# External agent sessions

A Localix chat can have a coding agent linked to it. The chat keeps its normal messages, project and
controls; opening it also opens the linked CLI terminal. The external conversation remains in the
coding agent's own history.

## Sessions and projects

The history panel combines Localix chats with native CLI sessions recorded in the selected directory
and its subdirectories. Agent icons before each title identify the linked agent. Default stays
within the Localix workspace tree; it never aggregates machine-wide CLI history. A native session
already linked to a Localix chat appears once, under that chat. Archiving the chat does not bring
back a native duplicate.

All Localix chats share the same project selector, search, grouping, sorting, pinning, archive
controls, menus and batch actions. Opening a native history row first gives it a normal linked chat,
with those same controls. A newly created chat appears before the CLI writes a transcript.

Default shows only its own sessions. Like an ordinary Localix chat, each gets a separate directory
under the Localix workspace. Selecting a project shows its sessions and uses that project's folder.
The folder picker and project selector are shared with ordinary chats.

## Starting and opening a session

Use the main **New chat** action to create an ordinary chat in the selected project. The history
header has no duplicate creation button.

Above the composer, the agent pill shows **Localix** while no CLI is linked. Open it and choose an
installed coding agent. This links the selected CLI to the current chat and launches its terminal in
that chat's working directory. It keeps the same chat, messages and draft; it creates no second chat
and imports no external transcript. The Localix composer remains available alongside the terminal.

Opening an existing external session always opens its Localix chat and its agent terminal. A live
terminal is reused. After Localix identifies the CLI's native session, it saves that identity; an
adapter resumes the exact native session in its recorded working directory when a new terminal is
needed. All six supported agents declare native continuation commands. A missing native session
reports an error rather than starting a different conversation.

Each different external session you open starts its own CLI process. Switching chats keeps those
processes running; reopening the same session reuses its live terminal. There is no global cap or
idle eviction for these processes, so opening many sessions increases resource use. Close an agent's
terminal tab when you want to stop its process. Browsing a native transcript alone starts no CLI.

A chat with a linked CLI shows an agent pill above the composer, beside the project and Git context.
Press it to reveal the running terminal or reopen that same native conversation. The Localix chat
and draft stay in place.

Only supported CLIs found on the machine's executable search path appear in the agent-link menu.
Localix supports Claude Code, Codex, opencode, Gemini CLI, GitHub Copilot and Hermes.

## Native transcripts

Clicking an existing native session creates or reuses an ordinary Localix chat linked to its native
identity, then opens that chat and the CLI terminal. The external conversation stays in the agent's
own history; its messages are not imported into the Localix chat.

You can separately browse native CLI history through **External Agents** under `@resource:` and
through external statistics. A native transcript opens with Localix's conversation renderer. Its
footer offers **Open in …** and **Link to chat** when opened from a chat. Reading a native
transcript does not start a CLI or create a chat; its explicit terminal action uses the same
linked-chat flow.

## Linked context

Drag a native transcript's last breadcrumb or its tab into a composer. You can also browse
**External Agents** under `@resource:`. These paths use the same canonical session URI:

```text
localix://resource/external-agent/codex/session-id
```

The resource browser and transcript breadcrumbs navigate through agent and project containers to the
session. Containers are navigation destinations; individual sessions are attachable context. Opening
a session link returns to its native transcript.

When you send a linked session, the agent receives a compact digest of recent turns, the original
session key and a pointer to `external_agent_sessions`. It can read additional transcript windows,
inspect recorded tool calls and results, and collect context from several sessions. The digest
states what it omitted; it does not pretend to contain the full history.

The tool's model-facing fields use snake case. For example, one transcript window is:

```json
{ "action": "transcript", "key": "codex:session-id", "from": 0, "max_events": 100 }
```

Advance `from` using the returned event positions, or use `tail: true` to read the latest events.
Reading a transcript supplies context to the agent; it does not open a terminal for you. To open or
continue a native session, the agent uses `resume` with its session key, then runs the returned
command with `bash` action `open`. The lookup itself does not execute commands.

For agents with shell access, the runtime prompt includes a short list of installed external agents
and their basic launch commands. Starting or driving a CLI still goes through ordinary terminal
tools and permission rules. Linking history does not execute commands.

## Statistics

**Usage & Spend**, beside Settings in the navigation bar, has the same **Localix / External** tabs.
Both use a period selector, filters, four summary cards and charts. External statistics aggregate
the installed agents' recorded token usage by agent, project or model. Click a session breakdown to
inspect its conversation.

External numbers come from local history records. Missing usage remains unknown, and records without
timestamps are reported outside the selected period. These are recorded usage totals, not an account
quota or a bill; the External tab does not show account reset countdowns.

## Data boundaries

Localix reads machine-local history owned by the OS user running its backend. It does not edit those
history files. Reads and imports are bounded, and source truncation is disclosed. Linking a session
sends its expanded context to the model provider chosen for the Localix chat, like other attached
context. An uninstalled agent's sessions are hidden from history, statistics and resource browsing.

## Related guides

- [Run an external agent CLI](../recipes/bring-your-own-agent-cli.md)
- [Workspace and context](workspace.md)
- [Usage and cost tracking](cost-tracking.md)

## Source of truth

- [Core registration](https://github.com/rsaryev/localix/blob/main/apps/api/src/bootstrap/external-agents.ts)
- [Installed CLI detection](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/external-agents/installed.ts)
- [History adapters and resume contracts](https://github.com/rsaryev/localix/tree/main/apps/api/src/features/external-agents/backend/adapters)
- [Resource expansion](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/external-agents/backend/resource-provider.ts)
