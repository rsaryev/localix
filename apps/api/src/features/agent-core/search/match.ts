/**
 * The field scorer lives in `@localixai/mini-app-sdk/backend` (over `@localixai/search`) so mini
 * apps consume it from the SDK instead of deep-importing this host path. This file re-exports it to
 * keep the host import path working.
 */
export { bestFieldScore } from '@localixai/mini-app-sdk/backend'
