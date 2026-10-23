# Decide what an agent may do

Permission rules belong to the agent taking the turn. Its instructions describe the work it should
do; its rules govern the calls it may make. The conversation's
[permission mode](permission-modes.md) derives effective rules for a run without changing the stored
list. Run shape, host services, and model compatibility can further limit tools that Settings
allows.

## What you can do

| Goal                                  | How                                                                          |
| ------------------------------------- | ---------------------------------------------------------------------------- |
| Restrict which tools an agent may use | Switch tools off for that agent in **Settings → Capabilities**               |
| Require confirmation before a change  | Add an `ask` rule to the agent (see [Permissions](permissions.md))           |
| Stop being asked about one command    | Choose **Always** under **Allow** on the confirmation card, then **Approve** |
| Stop being asked inside one folder    | Click the folder in the path on a file's confirmation card                   |
| Switch off a plugin tool              | Switch off that tool, or the whole plugin, for the agent                     |
| Track substantial work                | Keep the Kanban plugin on; let the agent `delegate` when parallel work helps |
| Cut tokens per turn                   | Give the agent fewer tools — a lean agent is a lean prompt                   |
| Undo your edits to a shipped role     | **Reset to defaults** on that agent's Permission rules                       |

## How it works

### The agent decides authority

```text
run shape + host services + model compatibility + effective agent rules
  → allowed tool candidates → immediate or deferred schemas
```

Permission rules belong to an agent and to nothing else. A run reads that one ordered list and the
last rule matching the call decides; a role narrower than another is simply a different agent, which
you can create and edit like any other. [Permissions](permissions.md) owns the rule grammar.

What a project still decides is where things are INSTALLED — its plugins, MCP servers and skills —
not what may run.

A conversation's [permission mode](permission-modes.md) derives the effective rules for its runs
from the agent's list. Plan mode adds mutation denials. Bypass and Autonomous remove call-class
confirmation rules and turn named-tool questions into allows while keeping existing denials. The
stored agent rules stay unchanged. Run shape, host services, and model compatibility can also
withhold a tool enabled in Settings.

### Plugin tools

A plugin's tools join the same roster as the built-in ones, so one rule shape answers for both.
`tool:kanban` over `*` with effect `deny` removes the board tool from that agent's runs;
`plugin:kanban` removes the whole extension: a mini app's tools, prompt sections and agents, or a
plugin's skills, agents and MCP servers. The run projects the rules only after the loaded plugins
are known, so a plugin tool switched off in Settings never reaches the turn.

The conversation's **Plan** [permission mode](permission-modes.md) constrains project changes while
allowing its own plan files and permitted session-state changes. Use it to investigate and prepare a
plan for approval. For a lasting restriction, give the agent rules that deny the relevant calls;
denying file-write tools alone does not prevent writes through shell commands or other tools. Agreed
work can be tracked on the chat's [Kanban board](task-board.md), which the bundled Kanban plugin
provides; the board starts no model or session. When separate execution is useful, the agent
explicitly calls `delegate`, whose child runs as itself or a directory agent under the same mode.

### Going back to what we ship

The roles Localix ships with — `localix`, `lead`, `pm`, `architect`, `backend`, `frontend`, `qa`,
`design` and `devops` — start from rules we wrote, and after that the rules are yours. When an
agent's list no longer matches ours, the **Permission rules** tab grows a **Reset to defaults**
button; when it already matches, there is nothing to reset and no button. An agent you created has
no default to return to, so it never shows one. Reset STAGES our answer rather than writing it — you
read it on screen, then press **Apply**, and nothing is stored until you do.

### Spending fewer tokens

Tool schemas contribute to each model request. Core schemas are sent directly; plugin and MCP
schemas are deferred until activated or brought by a linked workbench. Use `context_budget` to
inspect the current request cost; the [tool roster guide](tools.md) explains the measured boundary.

There is no session switch for this. A run that should be lean is an AGENT that is lean: switch off
the tools it does not need in **Settings → Capabilities**, and its plugins and MCP servers with them
— a server denied by the agent's rules is not connected for that run. A whole-tool denial with no
later argument exception removes the candidate's schema. A conditional allow or named-tool question
can keep the schema available, while the permission gate judges each call's arguments. The
[specialist presets](agents.md) use different candidate lists and action restrictions; their
permission choices remain editable.

Switching a tool OFF for a role is the whole of that dial. Switching one on is not: a run also has
to be able to carry it, which is the run shape's answer rather than the rule's — a tool a child
session is allowed but its run shape never hands it is simply absent. The shipped roles are checked
against this, so an allow one of them holds is one it can actually reach.

There is no separate per-session economy switch. Configure the agent's rules and inspect the
assembled roster with `context_budget`; enabled tools can still be withheld by structural gates.

## Configuration

| Surface                                                  | Operation                                                  |
| -------------------------------------------------------- | ---------------------------------------------------------- |
| Settings → Capabilities → Tools / Skills / MCP / Plugins | Switch any one of them on or off for an agent              |
| Settings → Capabilities → Permission rules               | Argument patterns, **ask**, whole families, and rule order |
| Confirmation card                                        | **Once**, **This session**, or **Always**; a folder level  |

The four registry tabs and the rules tab write the same thing. A switch is a rule: turning a skill
off stores `skill:<name>` over `*` with effect `deny`, which is exactly the row the rules tab would
show. The registry switches send their changes immediately. The rules editor and **Reset to
defaults** stage a draft until **Apply**. Turning a switch on writes an explicit `allow`; clearing a
rule in the editor instead restores the artifact's default/trust behavior. The rules tab also
supports argument patterns and order, which a whole-item switch cannot express.

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

- [Capability rules and evaluation](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/capability-rule.ts)
- [Capability resolver and whole-tool denial](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/capabilities/resolve.ts)
- [Permission-rule composition](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/run/permission-gate-build.ts)
- [The permission gate](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/permission-gate.ts)
- [Permission-mode rewriting](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/capabilities/permission-mode-policy.ts)
- [Switch-to-rule translation](https://github.com/rsaryev/localix/blob/main/apps/ui/src/shared/contrib/capabilityRules.ts)
- [Draft and Apply behavior](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/settings/model/usePermissionRules.ts)
- [Run shape](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/run-shape.ts)
- [Plugin roster narrowing](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/plugins/narrow.ts)
  and
  [the run's rule projection](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/prompt-context.ts)
