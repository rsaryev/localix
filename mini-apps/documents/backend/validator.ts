import { routeValidator } from '@localixai/mini-app-sdk/backend'

/**
 * The request validator for both document routers — the SDK's, in its `nested` envelope.
 *
 * Both routers mount `defaultErrorHandler`, which answers `{ error: { code, message, detail } }`;
 * a validation failure never reaches it (the validator answers rather than throwing), so this is
 * where its body is decided — the same one, with the headline as `message` and every failed field
 * in `detail`, which the UI's `failure()` carries through to the Event Center.
 */
export const validated = routeValidator({ envelope: 'nested', code: 'invalid_request' })
