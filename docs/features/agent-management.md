# Create and manage specialists

Agents are Claude Code agent files (see [Agents](agents.md)), managed in the [Store](store.md). A
conversation has one agent, fixed when it is created, and a run is one piece of work. Creating an
agent does not start a model run.

You are not an agent: there is no `@human` record, and describing yourself belongs in `CLAUDE.md`.

## Create in the Store

Open **Store → Agents** and choose **Add agent**. Give it a name and a description, and choose where
to keep it: yours (`~/.claude/agents/`) or the open project (`<project>/.claude/agents/`). A name
already taken in that place is refused. Localix writes the file with a placeholder body and opens
the agent's page on its **Settings** tab, where you write the instructions.

## Create from a conversation

Ask your assistant to create a specialist. With the `Store` tool available, it can look at what is
installed (`search` with `kind: "agent"`) and, once you approve, create a missing specialization
with `create`, giving a name, a description and the standing instructions. Current task details
belong in the task you give it rather than in the reusable definition.

Every `create` shows you a card with the definition and waits for your answer; nothing is written
before you approve. A run nobody can answer, such as an automation, refuses it. The `scope` is
`user` (your agents, in every project) or `project` (the open project's `.claude/agents/` folder);
creation cannot select a different project. Your own agents and plugin agents such as the starter
team are listed in every project too, unless a project agent uses the same name. The server issues a
stable ID and leaves model preferences, memory settings, skill preloads and turn limits at their
existing defaults.

A created specialist starts from the Localix default policy, as with the Store's **Add agent** form.
It does not copy its creator's permission rules; edit them on its **Access** tab when needed.

A created specialist is available to start a new conversation with, or to name as a subagent type in
a task (see [Subagents](delegation.md)). Child and automation runs do not receive the `Store` tool.

The `localix` agent receives team-building instructions. It handles small tasks directly; when
distinct specialties are useful, it reuses existing definitions and creates the missing roles one
`Store` call at a time, each one approved by you.

## User commands

Agents are managed in the Store: the **Agents** shelf adds, edits, copies, enables and removes them,
and an agent's own page has its **Access** tab. The `/agents` command only lists and points there.

| Command        | Result                                                                   |
| -------------- | ------------------------------------------------------------------------ |
| `/agents list` | List the agents of this chat's project by name, including disabled ones. |
| `/agents`      | Link to the Agents shelf of the Store, where **Add agent** is.           |

An agent is identified by its Claude Code `name`; there is no `@handle` form. To make an agent in
your own words, ask the chat's agent: it picks the name, description and instructions and saves the
specialist with the `Store` tool after you approve. It does not start the new agent.

Managed, plugin and built-in agents cannot be edited or deleted, exactly as in the Store. Deleting
an agent checks whether any conversation still uses it.

## Availability and retries

An agent with disabled availability or a denied chat invocation cannot start a conversation.

Repeated delivery of the same creation call returns the saved identity, even after a rename. Reusing
that operation for different instructions fails. A different creation with an occupied name fails
without overwriting the existing agent.

Localix is the only built-in agent. Customized policies remain unchanged; enable the `Store` tool on
the agent's **Access** tab when desired. Its reads (`search`, `get`) can be granted independently of
its changes, and a rule can name one package, such as `install:plugin:review@market:user`.
