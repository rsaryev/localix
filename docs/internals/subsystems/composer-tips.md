# Composer tip contracts

Composer tips describe capabilities available in the current workspace while a run streams. Use this
guide when adding tip sources, relevance gates, ranking, timing, or quick actions.

## How it works

### Build the pool on the server

`composerTips` derives the snapshot's `tips` from resolved tools, plugins, skills, and commands. The
client receives tip text and gates together, so it cannot advertise an extension absent from the
current catalog.

| Source                         | Availability rule                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------ |
| Curated tips                   | `requiresAnyTool` checks `tools.enabled`; the server removes the gate before publishing the tip. |
| Installed but inactive plugins | Text and keyword patterns come from the plugin's name and manifest description.                  |
| Built-in commands              | `TEACHABLE_COMMANDS` selects names; text comes from the shared `SLASH_COMMANDS` catalog.         |
| Skills and plugin commands     | The pool uses the snapshot's current catalog entries.                                            |
| Session tips                   | Declared gates name facts the client can resolve from the current session.                       |

The client authors no product copy. `composerTipsAgnostic.test.ts` guards that boundary.

### Select a relevant tip on the client

| Gate                          | Evaluated against                                                      |
| ----------------------------- | ---------------------------------------------------------------------- |
| `when.textPattern`            | The latest user message, using the supplied regular expression source. |
| `when.tools`                  | The tool currently streaming.                                          |
| `when.signals` / `notSignals` | Session facts resolved by `tipSignals.ts`.                             |

`TIP_SIGNALS` defines the shared vocabulary. The client test enumerates that exported list to catch
signals that no resolver implements. `pickStreamTip` ranks eligible tips by gate specificity and
selects from the highest tier; generic tips compete only when no more specific tip applies.

### Pace the display

`tipSelection.ts` selects a tip; `streamTips.ts` controls when it appears.

| Moment                               | Behavior                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------- |
| First 2 seconds of a run             | Show no tip, avoiding a flash during a short response.                    |
| Every 7 seconds afterward            | Rotate to the next eligible tip.                                          |
| A more specific tip becomes eligible | Swap after the current tip has remained visible for at least 2.5 seconds. |
| All eligible tips have been shown    | Recycle the run's shown set.                                              |

`shouldSwapForMoment` compares specificity. A swap restarts the rotation timer so the replacement
gets a full display interval.

### Offer quick actions

A tip carries at most two actions. `insert` stages editable text through the composer bus;
`navigate` resolves a `localix://ui/…` destination through the shared navigation registry. Build
settings destinations with SDK helpers such as `capabilitySettingsUiUri`, so an action reaches the
owning row rather than an unrelated settings page.

## Limits

- Tip text is clipped to 110 characters; each generated catalog source contributes at most 12 tips.
- A quick action stages text or opens a setting. It does not grant a denied tool access.
- A navigation action with an unresolved destination is omitted.

## Related guides

- [Capability resolution](capabilities.md)
- [Workspace behavior](../../features/workspace.md)

## Source of truth

- [Server tip composition](../../../apps/api/src/features/capabilities/tips.ts)
- [Tip gate contracts](../../../apps/api/src/features/capabilities/tip-contracts.ts)
- [Curated tips and command selection](../../../apps/api/src/features/capabilities/tips-curated.ts)
- [Session tips](../../../apps/api/src/features/capabilities/tips-session.ts)
- [Quick actions](../../../apps/api/src/features/capabilities/tips-actions.ts)
- [Keyword gates](../../../apps/api/src/features/capabilities/tips-keywords.ts)
- [Server tip tests](../../../apps/api/src/features/capabilities/tips.test.ts)
- [Client pacing](../../../apps/ui/src/entities/chat/model/streamTips.ts)
- [Client selection](../../../apps/ui/src/entities/chat/model/tipSelection.ts)
- [Session signals](../../../apps/ui/src/entities/chat/model/tipSignals.ts)
