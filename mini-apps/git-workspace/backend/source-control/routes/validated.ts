/**
 * The request validator for the source-control routers — the SDK's, in its `nested` envelope.
 *
 * A validation failure answers rather than throwing, so it never reaches the error handler; its
 * body is decided here. `unwrap()` in the UI reads `error.error.message`, so anything outside
 * `{ error: { code, message, detail } }` surfaced as a raw Zod dump with a null code. The code
 * stays `validation_error`, which the UI already branches on.
 *
 * Shared by the three route modules so they answer a bad body identically.
 */
import { routeValidator } from '@localixai/mini-app-sdk/backend'

export const validated = routeValidator({ envelope: 'nested', code: 'validation_error' })
