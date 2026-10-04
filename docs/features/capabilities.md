# Decide what an agent may do

An agent has no modes of its own and no permission scopes. What a run may use is one question with
one answer: the rules of the agent taking the turn. What it should do with them is the agent's own
instructions. The conversation's [permission mode](permission-modes.md) only changes how often you
are asked, and it never lifts a `deny` rule.

## What you can do

| Goal                                  | How                                                                                    |
| ------------------------------------- | -------------------------------------------------------------------------------------- |
| Restrict which tools an agent may use | Switch tools off for that agent in **Settings → Capabilities**                         |
| Require confirmation before a change  | Add an `ask` rule to the agent (see [Permissions](permissions.md))                     |
| Stop being asked about one command    | Choose **Always** under **Allow** on the confirmation card, then **Approve**           |
| Stop being asked inside one folder    | Click the folder in the path on a file's confirmation card                             |
| Switch off a plugin tool              | Switch off that tool, or the whole plugin, for the agent                               |
| Track substantial work                | Keep the Kanban plugin on; use `agents` `delegate` explicitly when parallel work helps |
| Cut tokens per turn                   | Give the agent fewer tools — a lean agent is a lean prompt                             |
| Undo your edits to a shipped role     | **Reset to defaults** on that agent's Permission rules                                 |

## How it works

### The agent decides authority

```text
the agent's rules → run shape
```

Permission rules belong to an agent and to nothing else. A run reads that one ordered list and the
last rule matching the call decides; a role narrower than another is simply a different agent, which
you can create and edit like any other. [Permissions](permissions.md) owns the rule grammar.

What a project still decides is where things are INSTALLED — its plugins, MCP servers and skills —
not what may run.

There is one answer and one place to change it. A conversation's
[permission mode](permission-modes.md) does not add a second answer: it rewrites this same list for
the conversation's runs, so the roster, the gate and the prompt read one result, and a tool switched
on in Capabilities is never missing from the turn because of a mode.

### Plugin tools

A plugin's tools join the same roster as the built-in ones, so one rule shape answers for both.
`tool:kanban` over `*` with effect `deny` removes the board tool from that agent's runs;
`plugin:kanban` removes the whole plugin — its tools, skills, prompt sections, agents and MCP
servers. The run projects the rules only after the loaded plugins are known, so a plugin tool
switched off in Settings never reaches the turn.

A read-only phase is the conversation's **Plan** [permission mode](permission-modes.md): the agent
investigates and presents a plan for you to approve before anything is changed. An agent that must
never touch the project, in any conversation, is one whose rules deny the write tools. Agreed work
can be tracked on the chat's [Kanban board](task-board.md), which the bundled Kanban plugin
provides; the board starts no model or session. When separate execution is useful, the agent
explicitly calls `agents` `delegate`, whose child receives its own tool set.

### Going back to what we ship

The roles Localix ships with — `lead`, `product`, `backend`, `frontend`, `qa` and the default agent
— start from rules we wrote, and after that the rules are yours. When an agent's list no longer
matches ours, the **Permission rules** tab grows a **Reset to defaults** button; when it already
matches, there is nothing to reset and no button. An agent you created has no default to return to,
so it never shows one. Reset STAGES our answer rather than writing it — you read it on screen, then
press **Apply**, and nothing is stored until you do.

### Spending fewer tokens

Every tool's schema rides on every request — the default chat roster is about 4,900 tokens of fixed
tax before the first word of conversation. An MCP server can add forty tools on its own.

There is no session switch for this. A run that should be lean is an AGENT that is lean: switch off
the tools it does not need in **Settings → Capabilities**, and its plugins and MCP servers with them
— a server the agent's rules deny is never even connected. A tool you switch off is REMOVED from the
run, not refused when it is called: the schema never ships, so the saving is real. `product` is what
that looks like among the shipped roles — no shell and no file writes, so eight of the catalog's
tools never reach a request it makes.

Switching a tool OFF for a role is the whole of that dial. Switching one on is not: a run also has
to be able to carry it, which is the run shape's answer rather than the rule's — a tool a child
session is allowed but its run shape never hands it is simply absent. The shipped roles are checked
against this, so an allow one of them holds is one it can actually reach.

There is no per-session "economy mode". It would be a second answer to "which tools does this run
get" — invisible in Capabilities, so a tool switched ON there could still be missing from the turn —
and everything it could do is expressible as an agent whose rules say so.

## Configuration

| Surface                                                  | Operation                                                  |
| -------------------------------------------------------- | ---------------------------------------------------------- |
| Settings → Capabilities → Tools / Skills / MCP / Plugins | Switch any one of them on or off for an agent              |
| Settings → Capabilities → Permission rules               | Argument patterns, **ask**, whole families, and rule order |
| Confirmation card                                        | **Once**, **This session**, or **Always**; a folder level  |

The four registry tabs and the rules tab write the same thing. A switch is a rule: turning a skill
off stores `skill:<name>` over `*` with effect `deny`, which is exactly the row the rules tab would
show. The tabs are the fast way to say yes or no; the rules tab is where everything else a rule can
express lives, for every kind at once.

## Limits

- Rules are Localix application policy, not an operating-system sandbox. Nothing here grants or
  removes host privileges, and no rule bypasses protections enforced outside Localix.
- An `ask` rule relies on each tool's static or per-call mutation classification. An incorrect
  classifier can prompt too often or let a write through without the extra confirmation.
- Switching a tool on does not create it. The run shape, plugins, client capabilities, and host
  dependencies can each narrow a run further.
- The board creates no execution directory. Explicit sub-agents share the owning session hierarchy's
  workspace.

## Related guides

- [Permissions](permissions.md)
- [Human in the loop](hitl.md)
- [Kanban board](task-board.md)
- [Plugins](../extending/plugins.md)
- [Tool budget](tool-budget.md)

## Source of truth

- [Capability rules and evaluation](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/capabilities/rule.ts)
- [The capability resolver](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/capabilities/resolve.ts)
- [Permission-rule composition](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/run/permission-gate-build.ts)
- [The permission gate](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/permission-gate.ts)
- [Run shape](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/run-shape.ts)
- [Plugin roster narrowing](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/narrow.ts)
  and
  [the run's rule projection](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/prompt-context.ts)
