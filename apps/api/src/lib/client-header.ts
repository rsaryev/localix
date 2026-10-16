/**
 * The header a first-party client puts on every state-changing request it sends without a browser
 * `Origin` — and that every first-party browser client sends anyway.
 *
 * WHY A CUSTOM HEADER. The local API has no credentials, so a web page that can make the browser
 * send a body-less `POST`/`DELETE` to `127.0.0.1` (a "simple" request: `mode: 'no-cors'`, a form,
 * `sendBeacon`) could drain a node or delete a volume without ever reading the answer. A page
 * cannot attach a non-safelisted header without a CORS preflight, and the API refuses preflights
 * from origins it does not know, so the header's mere presence proves the request was not one of
 * those. Its value carries no secret; `local-origin-guard.ts` checks only that it is there.
 *
 * A leaf on purpose: the browser transport (`apps/ui/src/shared/api/internal.ts`) imports it through
 * `@localixai/api/client`, so the server and the client cannot spell the name differently.
 */
export const LOCALIX_CLIENT_HEADER = 'x-localix-client'

/** The value first-party clients send. Any non-empty value passes; this one names the sender. */
export const LOCALIX_CLIENT_HEADER_VALUE = '1'
