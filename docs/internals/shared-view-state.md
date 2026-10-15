# Shared view state

Conversation routes, draft text and surface resume state must agree across native windows and
browser channels. Their owners differ; copying them into one frontend preference store makes a
second resolver and lets a surface choose a provider independently of the conversation.

## Routing and reasoning

A participant's explicit conversation route wins. An unresolved model asks the server for the last
choice for that agent, its authored default, the project default, then the primary participant's
route. A provider connection travels with its model. The UI reads this result through the existing
session and provider clients; no surface has an independent resolver.

Reasoning is settled at conversation birth and stays concrete for that task. Explicit reasoning
selections have their own timestamp: later message activity, pinning and inherited worker routes
must not become new preferences. The server carries recent `max`/`xhigh` as `high` into a fresh
conversation and excludes `off` from carried history. Explicit task choices remain unchanged. The
old local reasoning helpers are no longer consulted by live creation or picker flows.

## Durable resume records

`user_view_state` stores typed records under `(user, kind, key)`. Currently supported records are:

| Kind      | Key             | Value                         | Consumers     |
| --------- | --------------- | ----------------------------- | ------------- |
| `surface` | Surface key     | Surface-specific resume state | Owning views  |
| `draft`   | Conversation ID | Unsent text or null           | Main composer |

Session references must belong to the authenticated user. A missing record has revision zero. Writes
compare `expectedRevision` in SQL and return the current snapshot on a conflict. Each accepted write
increments the revision; null retains the revision rather than recreating a key. Drafts are limited
to 32,000 characters. Other channel state requires a new typed contract, not arbitrary profile JSON.

The frontend uses the existing `resourceSync` scheduler and socket. Accepted writes invalidate
`view-state`; events contain no text. Draft writes debounce for 600 ms and participate in the shared
quit-flush registry. The existing local draft cache remains an offline recovery and migration cache.
An edit made during a save is retained and subsequently saved against the next revision.

If another channel changes a dirty draft, the local text stays visible until the person chooses
**Keep mine** or **Use other draft**. Clean readers adopt the server value. Transient failures
retain the draft and expose Retry.

## Frontend persistence audit

This inventory records current ownership and remaining migrations. It does not claim every local
preference is already synchronized.

| State                                                                     | Current owner                             | Decision                                                                      |
| ------------------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------- |
| Models, provider connections, reasoning, participants                     | Conversation/provider APIs                | Reuse resolved session routes in every surface                                |
| Account UI/agent settings                                                 | User profile API with optimistic cache    | Keep existing profile merge and invalidation                                  |
| Unsent conversation text                                                  | User view-state API; local recovery cache | Shared `useComposerDraft` in every composer                                   |
| Main workspace scope, selected chat, URL                                  | Workspace navigation and chat persistence | Keep independent per window; remote creation must not navigate another window |
| Grid tabs, rail order/width, editor caret/scroll, transcript measurements | Window/device persistence                 | Keep local; geometry and open views differ by screen                          |
| Unsaved file bodies                                                       | File draft/editor owner                   | Keep separate from chat drafts; require file conflict semantics               |
| Preview/browser history, plugin view state, folder expansion              | Inspector/plugin owners                   | Keep scoped to the owning view; plugins retain their typed data APIs          |
| Prompt history, recent model menu ordering, palette/project MRU           | Local convenience history                 | Does not decide executable routes; review cross-device history separately     |
| Last workspace tip and tip counters                                       | Local progress caches                     | Candidate for explicit profile fields; not conversation state                 |
| Notification preferences and spend threshold                              | Local preference modules                  | Remaining candidates for profile migration                                    |
| Notification journal/outbox and delivery receipts                         | Existing notification subsystem           | Preserve existing deduplication                                               |
| Editor wrap, whitespace, autosave and inlay preferences                   | Local editor preferences                  | Candidate for typed profile settings; do not mix with caret/geometry          |
| Hover, focus, drag depth, open menus, HITL form controls                  | Ephemeral UI                              | Never synchronize pointer or focus between channels                           |
| HITL requests, questions, answers, work and queue                         | Existing server domain APIs               | Shared forms/actions/transcript projection                                    |

The implementation lives in `features/user/view-state-*`, `shared/lib/view-state`, and
`features/chat/model/useComposerDraft.ts`. The decision is recorded in
`docs/adr/0001-shared-view-state.md`; resource synchronization is documented in
`docs/internals/client-server-sync.md`.
