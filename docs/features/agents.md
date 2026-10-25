# Agents

An agent is a Claude Code agent file: a Markdown file whose front matter names it and describes it
and whose body is its standing instructions. Localix reads the same folders Claude Code does, so an
agent you write for one works in the other. There is no second agent format and no Agents page in
Settings: agents are Store items, found and edited in the [Store](store.md).

Create specialists from a conversation and manage them with `/agents`; see
[Create and manage specialists](agent-management.md).

## Where agents live

| Kept in                      | Folder                                                        | You can edit it |
| ---------------------------- | ------------------------------------------------------------- | --------------- |
| Yours                        | `~/.claude/agents/` (or the folder `CLAUDE_CONFIG_DIR` names) | Yes             |
| This project                 | `<project>/.claude/agents/`, up to the repository root        | Yes             |
| Managed by your organisation | the managed `.claude/agents/` folder                          | No              |
| From a plugin                | the `agents/` folder of an enabled plugin                     | No              |
| Built in                     | `general-purpose`, `Explore`, `Plan` and `localix`            | No              |

When two agents share a name, Claude Code's precedence decides which one runs: managed, then the
project (the closest folder wins), then yours, then plugins. A file with the name of a built-in type
replaces it. Folders are watched: an agent you add or edit in an editor appears in the Store and in
`@` suggestions within a moment, and a file you delete leaves every list at once.

Localix keeps in its own database only what a file cannot hold: the agent's **access** rules, a
stable identity that survives a rename, and chat history. The identity is why a renamed or moved
file keeps its seat in a conversation and its permission choices. A file that disappears is treated
as missing for a grace period (10 minutes for your own folder, 7 days for a project) before its
rules and seats are cleaned up; a disabled plugin or an unreachable project folder is never a
deletion. Deleting an agent in the Store or with `/agents delete` cleans up at once. Messages it
wrote stay, under its last name.

## The agent's page

Open **Store → Agents**, or follow an `@name` link in a chat. The page has these tabs:

- **Overview**: description, where the file is, how many chats it is seated in, and the actions that
  fit: Edit, Duplicate, Copy to Yours, Move to a project or to Yours, Delete.
- **Settings**: the definition, written back to the file. Name, description, instructions, model,
  effort, turn limit, preloaded skills, priority and memory scope are fields; front matter Localix
  does not edit (`tools`, `hooks`, `mcpServers` and unknown keys) is kept as it is. A save that
  would overwrite a change made in an editor in the meantime is refused, and the page asks you to
  reload.
- **Access**: per-agent switches for tools, skills, MCP servers, plugins and mini apps. A switch is
  a rule for this agent only. Use **Open** on a row to go to that item's own page.

Agents from a plugin or a managed folder are read-only: **Copy to Yours** makes an editable copy
with a fresh identity and no inherited permissions beyond the Localix default.

## Localix, and the built-in types

`localix` is the main loop, not a file. It coordinates the requested outcome and handles
straightforward work directly, its priority is **2**, and it cannot be deleted or disabled. Every
conversation can fall back to it. To change how it behaves, edit `CLAUDE.md` or an output style, or
set `"agent"` in your Claude Code settings.

`general-purpose` (also `claude`), `Explore` and `Plan` are Claude Code's built-in subagent types
and behave as in Claude Code. `statusline-setup` and `claude-code-guide` are not offered. See
[Claude Code compatibility](../extending/claude-code-compatibility.md).

You are not an agent. There is no `@human` record: describe yourself and your preferences in
`~/.claude/CLAUDE.md` or the project's `CLAUDE.md`. Agents never address you with an `@` mention; to
get your answer, a decision or an approval they use the `ask` tool ([HITL](hitl.md)); otherwise they
report and stop, and the reply returns to you. `@all` addresses every participant. A board card may
still be assigned to you ([Cards for you](task-board.md#cards-for-you)).

## Starter team

The `team` plugin in the `localix` marketplace is Recommended in the Store. It adds `architect`,
`backend`, `frontend`, `design` and `devops` as ordinary plugin agents. Nothing is added to your
folders until you install it, and uninstalling removes them. Use **Copy to Yours** to change one.
Tag an agent in a conversation to bring it in.

Specialists have priorities from **−2** to **2** (`localix: priority:` in the file). Higher priority
elects the leader; equal priorities keep participant order. Explicit user routing and existing work
ownership still take precedence. Supporting specialists should have a lower priority than the
coordinator.

## Default tool candidates

Localix has an open candidate policy, so newly installed tools can join its runs. A candidate still
needs a compatible run shape, host port and model. A child cannot acquire a tool that requires
direct human interaction merely by allowing it in policy.

An agent-authored specialist receives a copy of its creator's saved permission rules. An agent made
in the Store starts from the Localix default; narrow it on its **Access** tab and in
[Permissions](permissions.md). Definitions and priorities never grant permission.

## Model, limits and context

In a new chat, the model route resolves from session choices, recent choices for that agent, its
`model` setting, the project and the primary route. A delegated child snapshots the parent's
effective route and effort, unless the caller explicitly selects a route. Editing an agent therefore
does not silently reroute work already delegated. A Localix route (`provider/model`) is kept under
the file's `localix:` key with `model: inherit`, so the file stays valid in Claude Code. Aliases
such as `opus`, `sonnet` or `haiku` need an explicit catalog model to run on a Localix route.

**Turn limit** (`maxTurns`) can lower a run's limit. Blank inherits the run limit, whose built-in
default is 1,000 tool-loop turns; user settings and delegated task caps can lower it.

In the composer, click the turn-limit control to cycle through **1 → 5 → 20 → 100 → ∞ → 1**. The
tooltip shows the next value. **∞** uses the built-in 1,000-turn ceiling; the agent normally stops
when its work is finished.

**Skills** (`skills`, at most 32) are preloaded for this agent in ordinary and delegated turns.
Session-pinned skills are added, duplicates are removed, and denied skills remain unavailable. A
team's members do not inherit one another's skill lists. Loading a skill never grants denied tools
or silences outside-workspace and dangerous-command confirmations.

**Memory scope** (`localix: memoryScope:`) limits both recall and saved notes to conversation,
project or global notes. With **All available scopes**, recall searches conversation, project and
global notes, while default writes stay in the project or conversation. A selected scope does not
fall back to another scope when unavailable. Changing it refreshes the agent's saved memory context
on the next run. Claude Code's own `memory:` key (a memory folder) is separate and keeps working.
See [stored context](learning-loop.md#recall-and-courses).

![An agent's page in the Store: standing instructions, memory scope and turn limit](../assets/screenshots/agents/context-and-limits--2026-10-12.png)

## Older conversations

Saved conversation history is kept. A participant whose definition is no longer available remains
visible in `/agents members`; add `localix` with `/agents add localix` before removing unavailable
participants. Agents saved in Localix's earlier JSON format are not read: recreate one you want to
keep as a file, or install the `team` plugin.

Agents [delegate](delegation.md) self-contained tasks to child sessions, run by themselves or by an
agent file named in the task, or invite colleagues into the conversation. An agent file is
persistent; it is not a child run.

Handing the floor between participants needs no tool: the host routes each reply by its `@handle`
addresses (see [Conversations](conversations.md)). Two protocol tools stay available even if an old
permission list denies them: `set_topic` for the leader or sole agent, and `skip_answer`, a
participant's pass when it is named but asked nothing.

See [Forks](delegation.md), [Capabilities](capabilities.md) and
[Permission modes](permission-modes.md) for the execution and policy contracts.
