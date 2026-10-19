# Semantic index and change feed

A plugin backend can put its own items in the semantic index, find them by meaning, compare a few
texts with the embedding model, ask a decision model typed questions, and follow its own changes on
the host's change feed — the same mechanisms the core uses for chats, skills, agents and group
routing.

## Index your items

Register a source with `ctx.host.semantic.registerSource`: a collection name, a `label` (the
category the status bar lists), a `version`, and `scan`/`read` over your items. The host embeds them
with EmbeddingGemma 2, which Localix keeps on this computer, and keeps the vectors. Your collections
are namespaced `plugin:<name>:<collection>`, so you can neither read nor overwrite another's, and
each is scored against itself alone.

## Query by meaning

`query(userId, collection, text, { scope })` answers with matches carrying `z` and `gate`; a match
counts when `z >= gate`. `embed` returns raw vectors for clustering or deduplication, and `status()`
says whether semantic search is ready. Semantic search is always on; until its model is here,
`query` returns nothing and `embed` returns `null`.

## Compare a few texts

`rank(query, candidates, { task })` embeds a query and a handful of `{ key, text }` candidates now,
without storing anything, and returns them nearest first with each one's cosine. Use it to pick the
closest option, route an item, or spot a near-duplicate. With `similarity` or `classification` both
sides are embedded alike; the retrieval tasks embed candidates as documents. Like `embed`, it
returns `null` until the model is ready.

## Ask a decision model

`ctx.host.decisions` asks a decision model (Jev through OpenRouter) typed questions about a
structured `state`. A `choice` question picks among option keys and a `bool` question gives the
probability that a statement is true. All questions are answered in one pass, with probabilities and
without text.

`decide(userId, { state, questions }, { purpose, sessionId })` resolves to an outcome. It is
`answered` with `answers` keyed like your questions; otherwise its status says why: `unavailable`
(no connection serves a decision model), `deadline`, `cancelled` or `failed`. Always keep your own
fallback for those. The host picks the model, waits at most `deadlineMs` (3 s by default, 15 s at
most), records the spend under **Decisions** against `sessionId`, and logs the decision without its
state, under `plugin:<name>:<purpose>`. It rejects only a malformed `purpose` or a session the user
does not own. `available(userId)` says whether a decision would be answered now.

`confidentChoice(answer, 0.8)` returns a `choice` answer's pick when it reaches that probability,
else `null`.

A game whose other side can be the decision model keeps the choice with its table
(`@localixai/plugin-sdk/opponent`), asks for a turn with `askDecisionForTurn` (one `choice` question
over the legal moves; a miss comes back as the reason the board shows), and offers the choice with
`OpponentMenu` from `@localixai/kit/opponent-menu`. The bundled games are the examples.

## Follow your own changes

`ctx.host.changes` records thin notices on your stream, `plugin:<name>`: `upserted`, `deleted`, or
`resync` for "any of this kind may have changed". `record` never throws.
`subscribe(consumer, handler)` reads them at a cursor that survives a restart; a handler that throws
is retried from the same notice.

## Example

```ts
const host = ctx.host
host?.semantic?.registerSource({
  collection: 'cards',
  label: 'Cards',
  version: 1,
  scan: async (cursor, limit) => listCards(cursor, limit),
  read: async (keys) => readCards(keys),
})
// A card was saved: tell the index, and anything else following your stream.
host?.semantic?.changed('cards', [card.id])
host?.changes?.record({ entity: 'card', op: 'upserted', ref: { id: card.id } })

// Which column does a new card belong in? The decision model first, else the nearest by meaning.
const outcome = await host?.decisions?.decide(
  userId,
  {
    state: { card: { title: card.title, body: card.body } },
    questions: {
      column: { type: 'choice', instructions: 'Where does `card` belong?', criteria: columns },
    },
  },
  { purpose: 'triage', sessionId },
)
const column =
  (outcome?.status === 'answered' ? confidentChoice(outcome.answers.column, 0.8) : null) ??
  (
    await host?.semantic?.rank(
      card.title,
      Object.entries(columns).map(([key, text]) => ({ key, text })),
      { task: 'classification' },
    )
  )?.ranked[0]?.key ??
  'inbox'

const stop = await host?.changes?.subscribe('digest', async (change) => {
  if (change.op === 'resync') await rebuildDigest()
  else await refreshDigest(change.ref.id as string)
})
```

## Availability

All three exist on the boot-time backend load, like `watchPath`. Types:
[`semantic.ts`](https://github.com/rsaryev/localix/blob/main/packages/plugin-sdk/src/backend/semantic.ts),
[`decision.ts`](https://github.com/rsaryev/localix/blob/main/packages/plugin-sdk/src/backend/decision.ts),
[`changes.ts`](https://github.com/rsaryev/localix/blob/main/packages/plugin-sdk/src/backend/changes.ts).
