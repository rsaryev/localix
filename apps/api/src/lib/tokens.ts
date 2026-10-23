/**
 * The token estimator now lives in `@localixai/mini-app-sdk/backend` so mini apps
 * consume it from the SDK instead of deep-importing this host path. This file
 * re-exports it to keep the host's existing internal import path working.
 */
export { estimateTokens } from '@localixai/mini-app-sdk/backend'
