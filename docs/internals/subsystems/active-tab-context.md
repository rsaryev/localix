# Active-tab context

Active-tab context turns linkable workspace tabs into at most five ambient context chips in the
visible chat composer. It helps a model receive the current working set without reading a provider
while the chips are being previewed.

**Boundary:** The chips are suggestions. Manual references outrank them, and message acceptance owns
the durable context capture.

## Terminology

| Term             | Meaning                                                                  | Boundary                                           |
| ---------------- | ------------------------------------------------------------------------ | -------------------------------------------------- |
| Static binding   | A binding derived from the persisted work-item identity                  | It does not contain mounted UI state               |
| Live publication | Process-local context emitted by the mounted tab body                    | Unmount and reload discard it                      |
| Facet            | One independently resolvable binding published by a tab                  | One tab may publish several facets                 |
| Ambient ref      | A tab-derived ref the user did not add manually                          | Manual refs always outrank it                      |
| Binding envelope | The target kind, token, label, URI, attributes, and source kept together | Display tokens are not authoritative serialization |
| Active scope     | The session or global workspace scope currently selected by the grid     | Background session tabs are excluded               |

## What you can do

| Stage            | Mechanism                                                                                                        | Boundary or failure mode                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Static mapping   | `workItemToMessageBindings` maps core file, diff, and terminal tabs or calls a plugin work-item contribution     | A tab without a mapping contributes nothing                                        |
| Live publication | `publishLiveTabMessageContext` stores normalized `replace` or `append` facets by tab ID                          | Invalid registry input clears it; the sandbox bridge rejects invalid input earlier |
| Ranking          | `activeTabLinks` ranks current-scope open tabs by on-screen state, focused group, and tab recency                | The first five linkable facets win; one tab can contribute several facets          |
| Composer preview | `ambientAutoRefs` converts the full binding envelope into dismissible chips when the composer surface is visible | A hidden warm composer derives no ambient refs                                     |
| Send merge       | `resolveSendRefs` fills its 20-ref client limit with pinned refs, typed refs, then ambient refs                  | The API separately caps all bindings, including assets, at 20                      |
| Durable capture  | The chat service resolves accepted context bindings and persists their outcomes                                  | This lifecycle belongs to [Message bindings](message-bindings.md)                  |

The invariant is that a tab publishes a structured binding. Core may rank, normalize, budget, and
capture it, but core does not parse a plugin-owned resource URI.

## How it works

### Map static and live tab state

`tabMessageBinding.ts` is the only static/live merge point. Core file and diff tabs produce file
bindings, and terminal tabs produce terminal bindings. Registered work-item kinds provide
`toMessageBinding` or `toMessageBindings`, called with the tab and `{ session }` — the chat a
session-scoped tab belongs to, or `null` for a global tab — so a plugin never decodes the host's
opaque `scope` field.

A mounted tab body can publish narrower state through `publishMessageContext`. `replace` discards
the static mapping for that tab; `append` retains it. The registry deduplicates the resulting target
envelopes without interpreting their URI schemes.

Bundled components and sandboxed plugin views cross the same runtime normalizer. Live publications
may contain provider-owned `resource` targets or bounded `snippet` snapshots. They cannot publish a
host-owned file, terminal, task, or session target.

The file editor uses this seam for three states:

| Editor state                     | Live publication                                              | Boundary                                                            |
| -------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------- |
| Non-empty selection              | `replace` with selected text, path, language, and coordinates | The snapshot is capped by the live-snippet limit                    |
| Dirty buffer without a selection | `replace` with the in-memory buffer                           | Saving or clearing the dirty state restores the static file binding |
| Saved buffer without a selection | `append` the editor-state facet, or clear when it is empty    | Ambient context resolves the saved file at send time                |

In every state an **editor-state facet** rides alongside: the caret line and the file's current
errors and warnings (at most 20), built by
`apps/ui/src/features/inspector/model/editorStateContext.ts`. It updates on caret line changes, not
column changes. A snippet that carries a path and a start line expands with its location in the
block header, for example `from /abs/file.ts:4:40-4:47` (`snippetLocation` in
`apps/api/src/features/projects/expand-refs.ts`). The model gets the exact span to edit instead of a
file name and line numbers.

### Rank the working set

`tabCandidates` reads the grid's active scope, visible group bodies, and stored per-group recency.
`candidateScore` applies three ordinal signals:

| Signal                           |            Weight | Meaning                                     |
| -------------------------------- | ----------------: | ------------------------------------------- |
| Active tab in an on-screen group |               100 | Visible state outranks hidden open state    |
| Tab belongs to the focused group |                40 | Focus breaks visibility-class ties          |
| Recency                          | `20 / (rank + 1)` | Recency cannot overtake a visibility bucket |

The selector ranks all candidates before taking the first five linkable facets. Stable sorting keeps
grid order as the final tie-breaker.

### Preview and dismiss

The composer retains the complete `MessageContextBindingDraft`; it does not reduce a binding to its
display token. This preserves opaque URIs, provider attributes, and host-minted `active-tab`
provenance through send.

Ordinary tab dismissals last for the composer lifetime. A selection dismissal is keyed by the tab ID
and normalized target, so changing or clearing the selection makes the new state eligible again.

Preflight calls the project ref endpoint with `sizeOnly: true`. Files use `stat`; snippets use their
local length; other kinds use fixed estimates. This path performs no provider, database, exchange,
Git, or file-content read.

### Merge at send

`resolveSendRefs` preserves the following authority order:

1. pinned or dragged refs;
2. refs typed in the prompt;
3. ambient tab refs.

A manual duplicate suppresses its ambient copy. Ambient candidates use only the slots left by the
manual channels and are skipped individually when their estimated size would cross the hard context
budget.

## Configuration

These are code constants, not user settings.

| Constant                                 |                        Value | Enforced by                               |
| ---------------------------------------- | ---------------------------: | ----------------------------------------- |
| `AUTO_LINK_LIMIT`                        |                     5 facets | `activeTabLink.ts`                        |
| `PUBLISHED_MESSAGE_CONTEXT_MAX_BINDINGS` | 5 facets per tab publication | Plugin SDK normalizer and live registry   |
| `LIVE_SNIPPET_CONTENT_MAX`               |            40,000 characters | Plugin SDK snippet factory and normalizer |
| `MAX_SEND_REFS`                          |              20 context refs | Client ref merge; reserves no asset slots |

## Limits

- The five-facet ceiling applies after ranking bindings, not tabs. A multi-facet tab can fill the
  entire ambient set.
- Live publications are process-local UI state. Reloading or unmounting a tab discards them; the
  persisted message capture, not the registry, supports replay.
- A live snippet is truncated at 40,000 JavaScript characters. The limit is not a byte or token
  budget.
- Ambient refs exist only on the workspace chat composer. A client with no editor grid has no
  working set to publish.
- The 20-ref client ceiling does not subtract staged asset bindings. The API applies its 20-binding
  ceiling after combining assets and refs, so that combined request can still be rejected.
- Preflight sizes are estimates. The accepted turn still resolves and admits context under backend
  provider, scope, sensitivity, and byte policies.
- Dismissing a normal tab suppresses its ambient ref for the current composer lifetime. It does not
  disable the tab's manual drag or link action.

## Related guides

- [Message bindings](message-bindings.md)
- [Context system](context-system.md)
- [Context Fabric and Edit Prediction](context-and-edit-prediction-architecture.md)
- [Plugin authoring](../../extending/plugins.md)

## Source of truth

- [Plugin publication types and normalization](../../../packages/mini-app-sdk/src/ui/contrib.ts)
- [Static/live binding merge](../../../apps/ui/src/entities/workspace-grid/model/tabMessageBinding.ts)
- [Live registry](../../../apps/ui/src/entities/workspace-grid/model/liveTabMessageContext.ts)
- [Candidate ranking](../../../apps/ui/src/entities/workspace-grid/model/activeTabLink.ts)
- [Composer derivation](../../../apps/ui/src/entities/chat/ui/prompt-input/ambientTabLinks.ts)
- [Send precedence and budgets](../../../apps/ui/src/entities/chat/model/sendRefs.ts) ·
  [context-ref hook](../../../apps/ui/src/entities/chat/model/useContextRefs.ts)
- [Core file live state](../../../apps/ui/src/features/inspector/ui/FileTab.tsx)
- [Sandboxed bridge action](../../../apps/ui/src/shared/contrib/pluginPanelActions.ts)
