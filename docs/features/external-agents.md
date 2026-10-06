# External agent sessions

Read conversations from installed coding-agent CLIs alongside Localix sessions, link them as
context, and continue them with their native identity. This is part of Localix itself; no plugin is
required.

## History and transcripts

The history panel has two full-width tabs: **Localix** and **External**. External history groups
sessions by activity day, then agent. Search matches titles, session identities and working
directories. The list loads bounded pages and keeps its scroll position when you switch tabs.

Only supported CLIs found on the machine's executable search path appear. Localix reads history
formats for Claude Code, Codex, opencode, Gemini CLI, GitHub Copilot and Hermes. Old history files
alone do not make an agent available. The bottom bar offers Claude Code and Codex launch buttons
when those CLIs are installed; they use the same movable layout as other bar items.

Open a session to read it with Localix's conversation renderer. Its footer offers:

- **Import to Localix**: copy the readable conversation into a Localix chat, using its recorded
  working directory's project when available. A notice states when a bounded read omitted turns.
- **Open in …**: resume that exact native session in a terminal for adapters with a declared resume
  command: Claude Code, Codex and opencode. Other adapters offer viewing and import.
- **Link to chat**: attach the session to the chat from which you opened it, for review before send.

Previewing a transcript does not start an agent or create a Localix chat. A terminal opened from an
app-level preview creates a Localix chat to own that terminal.

## Linked context

Drag an External history row, the transcript's last breadcrumb, or its tab into a composer. You can
also browse **External Agents** under `@resource:`. These paths use the same canonical session URI:

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
