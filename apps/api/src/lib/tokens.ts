/**
 * The token estimator now lives in `@localixai/plugin-sdk/backend` so plugins
 * consume it from the SDK instead of deep-importing this host path. This file
 * re-exports it to keep the host's existing internal import path working.
 */
export { estimateTokens } from '@localixai/plugin-sdk/backend'
