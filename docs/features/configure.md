# Let the agent propose configuration changes

The `configure` tool lets an agent see why a capability is unavailable and propose the change that
would restore it. Nothing is applied until you approve the card it raises.

## Terminology

| Term     | Meaning                                                                    | Where it appears                                          |
| -------- | -------------------------------------------------------------------------- | --------------------------------------------------------- |
| Ledger   | One verdict per tool for a run: live, deferred, or withheld with a reason. | The agent's `# Unavailable tools` section and `inspect`.  |
| Remedy   | One kind of change the agent may propose, such as `tool.enable`.           | The `change.kind` field and the card's subtitle.          |
| Proposal | One remedy plus the change, awaiting your Approve or Deny.                 | The `config_change` card in the chat.                     |
| Withheld | The run does not hold a tool; the reason says which layer removed it.      | `inspect`, the card, the agent's Store page (Access tab). |

## What you can do

| Action                           | Mechanism                                                                 | Availability and boundary                                                      |
| -------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Ask why a tool is missing        | The agent calls `configure` with `action: "inspect"`.                     | Read-only, needs no approval, and never re-reads policy mid-run.               |
| Approve a proposed change        | Press **Approve** on the card.                                            | The change is written as you, with the agent's session recorded as its origin. |
| Refuse a proposed change         | Press **Deny**, close the card, or leave it for five minutes.             | All three mean no; the agent may not propose the same change again this run.   |
| Review what an agent changed     | Inspect the proposal result in chat and the resulting switch in Settings. | Reverting is an ordinary edit; provenance storage differs by remedy.           |
| Take the tool away from an agent | Turn `configure` off in that agent's rules.                               | Sub-agents and unattended runs never have it at all.                           |

## How it works

### The agent proposes; your click is the authority

`action: "propose"` validates the change, renders a card, and raises a `config_change`
human-in-the-loop request — the same mechanism as Ask and Confirm, so it routes to the chat's
approval surface. The built-in tool is omitted from closed child and automation profiles. The host
applies the change only after an approval comes back, then records what was approved and what
happened.

Silence is a refusal — the shared five-minute deadline for blocking human-in-the-loop requests, and
the same outcome: denied, with nothing changed. A configuration change that applied itself because
nobody was looking would be the opposite of the boundary this tool exists to keep.

### What can be proposed

| Remedy kind                          | Changes                                    | Lands on             |
| ------------------------------------ | ------------------------------------------ | -------------------- |
| `tool.enable`                        | One tool's switch.                         | The proposing agent. |
| `mini-app.enable`                    | A mini app, with its tools.                | The proposing agent. |
| `plugin.enable`, `mcp.server.enable` | A plugin or an MCP server, with its tools. | The proposing agent. |

Each change names its target and accepts optional `enabled`, defaulting to `true`. Setting it to
`false` proposes disabling the same capability. Prompt/model editing, role creation and workload
model routing are managed through their owning Settings screens.

Each remedy delegates to the write path that already owns its data, so an approved change lands
exactly where the same edit made in Settings would.

Tool-switch rules retain the proposing session and proposal id as rule origin. Mini app, plugin and
MCP switches use their capability write path; their proposal provenance lives in the backend's
`config_proposals` audit rows. This is not a separate audit-history screen in Settings.

### A proposal lands on the agent that made it

The card names the proposing agent and offers no scope selector. Approved switches update that
agent's rules; review the named target before approving.

### Scope of the tool itself

`configure` exists only in a chat. A sub-agent, a board worker and a scheduled job never receive its
schema and are never told it exists, so they cannot spend a turn discovering they may not use it.

## Configuration

| Control                   | Effect                                                           | Boundary                                                                |
| ------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `configure` switch        | Removes the tool, and with it the `# Unavailable tools` section. | Per agent, on the agent's Store page (Access tab).                      |
| Declines within a run     | Remembered until the run ends.                                   | A new run starts with a clean slate.                                    |
| Five-minute card lifetime | An unanswered proposal becomes a refusal.                        | The same deadline every HITL card has, counted down on the card itself. |

## Limits

- An approved change usually takes effect on the next turn, because a run resolves its capabilities
  once at the start. The card states which class of change it is.
- Shape, authority and model reasons carry no suggested remedy: a tool a sub-agent can never hold,
  one whose host service is absent, or one the run's model cannot read the output of, is reported
  but never suggested for a configuration proposal.
- A card is not a version-locked policy snapshot. Current switch remedies do not compare a captured
  policy revision on approval; they apply to the agent's current configuration. Check Settings if
  another window changed the same target while the card was open.
- Application and proposal-status recording are separate writes. A failed result does not prove that
  the setting stayed unchanged: the mutation may have committed before audit recording failed.
  Inspect the actual switch before retrying; there is no automatic rollback of that mutation.
- Approving records the change as agent-proposed; it does not record which model asked.

## Related guides

- [Capabilities and permission posture](capabilities.md)
- [Respond to human-in-the-loop requests](hitl.md)
- [Know the tool roster](tools.md)
- [Forks and background work](delegation.md)

## Source of truth

- [The `configure` tool](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/configure/configure.ts)
- [Tool ledger and withhold reasons](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tool-ledger.ts)
- [Remedy registry](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/config-proposals/registry.ts)
- [Switch writes and rule provenance](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/config-proposals/remedies/toggles.ts)
- [Proposal host and provenance](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/config-proposals/service.ts)
- [The card](https://github.com/rsaryev/localix/blob/main/apps/ui/src/entities/chat/ui/hitl/ConfigChangeInteractionView.tsx)
