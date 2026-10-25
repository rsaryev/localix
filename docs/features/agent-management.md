# Create and manage specialists

Agents are Claude Code agent files (see [Agents](agents.md)), managed in the [Store](store.md). A
participant is an agent added to one chat, and a run is one piece of work. Creating an agent or
inviting a participant does not start a model run. Give the participant a task with `@handle`, from
your message or from a colleague's reply.

You are not an agent: there is no `@human` record, and describing yourself belongs in `CLAUDE.md`.
The handle `all` is reserved.

## Create in the Store

Open **Store → Agents** and choose **Add agent**. Give it a name and a description, and choose where
to keep it: yours (`~/.claude/agents/`) or the open project (`<project>/.claude/agents/`). A name
already taken in that place is refused. Localix writes the file with a placeholder body and opens
the agent's page on its **Settings** tab, where you write the instructions.

## Create from a conversation

Ask your assistant to create a specialist and bring it into the conversation. With the `store` tool
available, it can look at what is installed (`search` with `kind: "agent"`) and, once you approve,
create a missing specialization with `create`, giving a name, a description and the standing
instructions. Current task details belong in the handoff rather than in the reusable definition.

Every `create` shows you a card with the definition and waits for your answer; nothing is written
before you approve. A run nobody can answer, such as an automation, refuses it. The `scope` is
`user` (your agents, in every project) or `project` (the open project's `.claude/agents/` folder);
creation cannot select a different project. Your own agents and plugin agents such as the starter
team are listed in every project too, unless a project agent uses the same name. The server issues a
stable ID and leaves model preferences, memory settings, skill preloads and turn limits at their
existing defaults.

A created specialist starts from the Localix default policy, as with the Store's **Add agent** form.
It does not copy its creator's permission rules; edit them on its **Access** tab when needed.

After creating a specialist, the assistant tags its handle in the reply with a concrete assignment:
the tag invites it into the conversation and gives it the floor. A fixed-membership conversation
cannot invite a new colleague. Child and automation runs do not receive the `store` tool. Parallel
copies of the same agent remain the responsibility of [fork](delegation.md).

The elected leader receives team-building instructions even while alone in the chat. It handles
small tasks directly; when distinct specialties are useful, it reuses existing definitions and
creates the missing roles one `store` call at a time, each one approved by you.

## User commands

Type `/agents` for help. The composer offers action choices and scoped agent suggestions.

![The /agents create link opens the Store's Add agent form with the name and description filled in](../assets/screenshots/agents/create-from-chat--2026-10-12.png)

| Command                           | Result                                                                   |
| --------------------------------- | ------------------------------------------------------------------------ |
| `/agents list`                    | List the agents of this chat's project, including disabled ones.         |
| `/agents members`                 | List this chat’s participants, including unavailable definitions.        |
| `/agents show @handle`            | Show the definition, identity and availability.                          |
| `/agents create [handle]`         | Link to the Store's Agents shelf, where **Add agent** is.                |
| `/agents create <request>`        | Ask the chat's agent to draft and save a specialist from your own words. |
| `/agents edit @handle`            | Link to the agent's page in the Store.                                   |
| `/agents copy @handle new-handle` | Copy the file, policy and enabled choice into a fresh identity.          |
| `/agents enable @handle`          | Enable new runs.                                                         |
| `/agents disable @handle`         | Disable new runs without stopping work already in progress.              |
| `/agents permissions @handle`     | Link to the agent's page in the Store, where its **Access** tab is.      |
| `/agents add @handle`             | Add a participant without starting work.                                 |
| `/agents remove @handle`          | Remove a participant while retaining its file.                           |
| `/agents delete @handle`          | Preview deletion of an unused agent file you can edit.                   |

IDs are accepted in place of handles. Commands use the current chat's project. Managed, plugin and
built-in agents cannot be edited or deleted with them, exactly as in the Store.

To describe the specialist in your own words, write the request after `create`. More than one word
without options is a request; a single word is a handle, and the reply links to the Agents shelf.
The chat's agent chooses the handle, description and instructions, then saves the specialist with
the `store` tool after you approve. It does not invite or start the new agent:

```text
/agents create a reviewer that checks database migrations for data loss and missing rollbacks
```

To create without opening a form, provide the definition fields and priority explicitly:

```text
/agents create migration-reviewer --description "Reviews database migrations" --instructions "Check compatibility, data preservation and recovery. Return findings with evidence." --priority 0
```

To change only one field while retaining all other settings and permissions:

```text
/agents edit @migration-reviewer --description "Reviews schema and data migrations"
```

`--priority` changes the bounded hierarchy priority; it does not change permission rules. `--handle`
renames a local agent while retaining its ID. Quoted arguments preserve Markdown and newlines.
Unknown options and incomplete definitions fail without starting an agent run. Permission rules are
changed on the agent's **Access** tab in the Store, not through definition options.

The composer offers action, agent, flag and value suggestions as you type. For example, type
`/agents edit @qa --pri` and press Tab to complete `--priority`. Each completed argument has its own
removable token. Backspace on an empty field reopens the previous token; Enter submits a complete
command, while Tab or the arrow keys select additional options. Suggestions continue until every
option for the action is used. While you type an option's text, Space keeps typing; type `--` to add
another option. Enter waits until an option that takes text has a value. Suggestions appear only at
the focused input, including when several composers share a draft.

Priority accepts whole numbers from −2 to 2. A value such as `0.5` stays intact through input tokens
and submission, then receives a validation error; the composer does not round it. A text value runs
to the next option, so `--instructions Check the schema --priority 1` needs no quotes. Quote a value
to keep newlines, repeated spaces, escaped quotes or a literal `--`.

![Editing an agent command with separate tokens and priority suggestions](../assets/screenshots/agents/edit-command-tokens--2026-10-13.png)

Deletion checks whether the identity is still seated in any conversation. Remove it from those
conversations first. The preview returns `/agents delete <id> --confirm`, so confirmation targets
the identity that was inspected. Built-in, managed and plugin agents cannot be deleted here; remove
a plugin's agents by uninstalling the plugin.

## Availability and retries

Agents with disabled availability or a denied chat invocation cannot join. A conversation must keep
one participant, and the active speaker must be stopped before removal. Removing a participant
cancels its queued turns through the existing membership writer.

Repeated delivery of the same creation call returns the saved identity, even after a rename. Reusing
that operation for different instructions fails. A different creation with an occupied handle fails
without overwriting the existing agent. A successfully created specialist remains if a later
invitation fails.

Localix is the only built-in agent. Customized policies remain unchanged; enable the `store` tool on
the agent's **Access** tab when desired. Its reads (`search`, `get`) can be granted independently of
its changes, and a rule can name one package, such as `install:plugin:review@market:user`.
