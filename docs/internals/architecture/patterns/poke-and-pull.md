# Poke and pull

A poke is a content-free signal telling a client to pull soon; the pull carries all data and is the
only path that changes client state. Read this note when adding a realtime invalidation to the UI or
deciding what a socket message may contain.

## Source

- Replicache documentation, "Poke" (Build Your Own Backend guide):
  https://doc.replicache.dev/byob/poke
- Replicache documentation, "How Replicache Works": https://doc.replicache.dev/concepts/how-it-works

## What the source says

Without pokes, a Replicache client pulls on a timer (`pullInterval`, 60 seconds by default), and
shortening the timer quickly becomes expensive. A poke is "only a hint telling the client to pull
soon" (Replicache docs). Because it carries no data, all transfer stays on the pull path, the
backend can stay a stateless request/response service, and any transport works: hosted pub/sub, a
WebSocket server, server-sent events or database features. The guide suggests one channel per
document or unit of collaboration.

The how-it-works page describes the pull. The client sends a cookie, an opaque value naming the
server state it already holds; the server answers with a patch from that state to the current one, a
new cookie, and which of the client's mutations it has confirmed. The client rewinds to the last
server state, applies the patch, replays its pending mutations and reveals the result atomically.
The pages do not discuss missed pokes or coalescing; the periodic pull is described as mainly a
development aid.

## Rules we take

- A realtime message names what to re-read; it never carries entity state.
- All state the UI shows arrives through an authoritative read, never through the push channel.
- Coalesce pokes for the same resource; one read can answer many.
- Discard a read result that an invalidation, disconnect or unmount has made stale.
- On reconnect, re-read whatever may have changed while disconnected; a missed poke must not leave
  the UI stale.

## Pitfalls the source warns about

- A poke has no data, so a client that does not pull after it shows nothing new.
- Timer-only pulling is either slow or expensive.
- Mutations can produce different results on the server than on the client, so the UI must handle
  outcomes it did not predict.
- Per-user cache names are needed so one browser profile does not share state between users.

## How Localix applies it

- The resource list is fixed in `apps/api/src/features/realtime/resources.ts`; the
  `resources.changed` event lists names only, with no payloads or secrets.
- The server side poke is published by the relay (`apps/api/src/features/realtime/relay.ts`), a
  projector on the core change feed that maps each committed notice kind to the resources it
  invalidates.
- `apps/ui/src/shared/api/resourceSyncTransport.ts` turns socket events into invalidations and ties
  reads to connection state.
- `packages/plugin-sdk/src/ui/resource-sync.ts` is the pull side: invalidations are coalesced, reads
  are serial per adapter, failures retry with backoff, and a generation counter drops superseded
  results.
- Making the poke follow the change feed (a realtime consumer of `change_events`) is planned; see
  [the change feed subsystem](../../subsystems/change-feed.md).

Related: [Event notification](event-notification.md), [Replay then live](replay-then-live.md).

## What we do not take

- **Cookies and patches.** Our read models are small; a pull returns the full resource, so there is
  no server-side diffing state to keep per client.
- **Client mutation replay and rebase.** UI writes go through ordinary API calls and wait for the
  server; there is no speculative local mutation queue.
- **Third-party pub/sub.** The existing event socket is the only delivery channel.
