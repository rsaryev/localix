# Semantic index and change feed

A plugin backend can put its own items in the semantic index, find them by meaning, and follow its
own changes on the host's change feed — the same mechanisms the core uses for chats, skills and
agents.

## Index your items

Register a source with `ctx.host.semantic.registerSource`: a collection name, a `label` (the
category the status bar lists), a `version`, and `scan`/`read` over your items. The host embeds them
with the model the person chose — EmbeddingGemma 2 on this computer by default — and keeps the
vectors. Your collections are namespaced `plugin:<name>:<collection>`, so you can neither read nor
overwrite another's, and each is scored against itself alone.

## Query by meaning

`query(userId, collection, text, { scope })` answers with matches carrying `z` and `gate`; a match
counts when `z >= gate`. `embed` returns raw vectors for clustering or deduplication, and `status()`
says whether semantic search is ready. Semantic search is always on; until its model is here,
`query` returns nothing and `embed` returns `null`.

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

const stop = await host?.changes?.subscribe('digest', async (change) => {
  if (change.op === 'resync') await rebuildDigest()
  else await refreshDigest(change.ref.id as string)
})
```

## Availability

Both exist on the boot-time backend load, like `watchPath`. Types:
[`semantic.ts`](https://github.com/rsaryev/localix/blob/main/packages/plugin-sdk/src/backend/semantic.ts),
[`changes.ts`](https://github.com/rsaryev/localix/blob/main/packages/plugin-sdk/src/backend/changes.ts).
