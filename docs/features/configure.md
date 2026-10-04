# Let the agent propose configuration changes

The `configure` tool lets an agent see why a capability is unavailable and propose the change that
would restore it. Nothing is applied until you approve the card it raises.

## Terminology

| Term     | Meaning                                                                    | Where it appears                                         |
| -------- | -------------------------------------------------------------------------- | -------------------------------------------------------- |
| Ledger   | One verdict per tool for a run: live, deferred, or withheld with a reason. | The agent's `# Unavailable tools` section and `inspect`. |
| Remedy   | One kind of change the agent may propose, such as `tool.enable`.           | The `change.kind` field and the card's subtitle.         |
| Proposal | One remedy plus the change, awaiting your Approve or Deny.                 | The `config_change` card in the chat.                    |
| Withheld | The run does not hold a tool; the reason says which layer removed it.      | `inspect`, the card, Settings → Capabilities.            |

## What you can do

| Action                           | Mechanism                                                                | Availability and boundary                                                      |
| -------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Ask why a tool is missing        | The agent calls `configure` with `action: "inspect"`.                    | Read-only, needs no approval, and never re-reads policy mid-run.               |
| Approve a proposed change        | Press **Approve** on the card.                                           | The change is written as you, with the agent's session recorded as its origin. |
| Refuse a proposed change         | Press **Deny**, close the card, or leave it for five minutes.            | All three mean no; the agent may not propose the same change again this run.   |
| Review what an agent changed     | Settings → Capabilities shows the rule and the session that proposed it. | Reverting is an ordinary edit in the same screen.                              |
| Take the tool away from an agent | Turn `configure` off in that agent's rules.                              | Sub-agents and unattended runs never have it at all.                           |

## How it works

### The agent proposes; your click is the authority

`configure` writes nothing. `action: "propose"` validates the change, renders a card, and raises a
`config_change` human-in-the-loop request — the same mechanism as Ask and Confirm, so it routes to
your root chat even when a descendant raised it. The host applies the change only after an approval
comes back, then records what was approved and what happened.

Silence is a refusal — the same five-minute deadline every human-in-the-loop card carries, and the
same outcome: denied, with nothing changed. A configuration change that applied itself because
nobody was looking would be the opposite of the boundary this tool exists to keep.

### What can be proposed

| Remedy kind                          | Changes                                    | Lands on             |
| ------------------------------------ | ------------------------------------------ | -------------------- |
| `tool.enable`                        | One tool's switch.                         | The proposing agent. |
| `plugin.enable`, `mcp.server.enable` | A plugin or an MCP server, with its tools. | The proposing agent. |

Three, and they answer one question: this run does not hold something, may it. Writing an agent's
prompt or model, its tool list, its invocation hosts, duplicating or deleting a role, choosing a
model for a workload — those were remedies once, and they were a second way to author configuration
that you could only reach by asking a model to do it. The screen that owns each of them does the job
better. Authoring is yours; asking for access is the agent's.

Each remedy delegates to the write path that already owns its data, so an approved change lands
exactly where the same edit made in Settings would.

### A proposal lands on the agent that made it

Rules belong to an agent, so there is nowhere else a proposal could go: the card names that agent
and offers no choice. The agent that ran into the limit is the one whose rules change, which also
rules out a proposal that reads as reasonable and is not — a model asking for an installation-wide
grant because its own role denied it something.

### Scope of the tool itself

`configure` exists only in a chat. A sub-agent, a board worker and a scheduled job never receive its
schema and are never told it exists, so they cannot spend a turn discovering they may not use it.

## Configuration

| Control                   | Effect                                                           | Boundary                                                                |
| ------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `configure` switch        | Removes the tool, and with it the `# Unavailable tools` section. | Per agent, in Settings → Capabilities.                                  |
| Declines within a run     | Remembered until the run ends.                                   | A new run starts with a clean slate.                                    |
| Five-minute card lifetime | An unanswered proposal becomes a refusal.                        | The same deadline every HITL card has, counted down on the card itself. |

## Limits

- An approved change usually takes effect on the next turn, because a run resolves its capabilities
  once at the start. The card states which class of change it is.
- Shape, authority and model reasons carry no remedy: a tool a sub-agent can never hold, one whose
  host service is absent, or one the run's model cannot read the output of, is reported but never
  proposed.
- A proposal computed against stale policy is refused when it lands, with the conflict reported to
  the agent rather than retried.
- Approving records the change as agent-proposed; it does not record which model asked.

## Related guides

- [Capabilities and permission posture](capabilities.md)
- [Respond to human-in-the-loop requests](hitl.md)
- [Know the tool roster](tools.md)
- [Delegation and background work](delegation.md)

## Source of truth

- [The `configure` tool](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/configure/configure.ts)
- [Tool ledger and withhold reasons](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tool-ledger.ts)
- [Remedy registry](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/config-proposals/registry.ts)
- [Proposal host and provenance](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/config-proposals/service.ts)
- [The card](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/chat/ui/hitl/ConfigChangeInteractionView.tsx)
