/**
 * The pluralize helpers now live in `@localixai/mini-app-sdk/backend` so plugins
 * consume them from the SDK instead of deep-importing this host path. This file
 * re-exports them to keep the host's existing internal import path working.
 */
export { plural, pluralize } from '@localixai/mini-app-sdk/backend'
