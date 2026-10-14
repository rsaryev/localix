/**
 * The web client's view of the `/rpc/ws` wire-frame envelope.
 *
 * This is NOT a copy — it re-exports the single owner, `@localixai/api/ws-frame`,
 * which lives beside the server code that WRITES the frames (`realtime/ws.ts` and
 * `features/ext/ws-frame-registry.ts`). A hand-copied parser drifted from the producer
 * once already; re-exporting the owner is what makes that impossible.
 *
 * See that module for the frame-kind reference (session / rpc / generic subsystem
 * `frame`).
 */
export { parseFrame } from '@localixai/api/ws-frame'
