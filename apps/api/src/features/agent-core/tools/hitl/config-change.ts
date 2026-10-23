/**
 * The `config_change` HITL contract lives in `@localixai/mini-app-sdk/backend` (beside
 * `confirm`) so a mini app backend can raise the same request kind. Re-exported here so the
 * host's client leaf (`apps/api/src/client.ts`) reaches it through the same internal path as
 * the other HITL kinds instead of importing the SDK's backend entry into the browser bundle.
 */
export type {
  ConfigChangePayload,
  ConfigChangeRequest,
  ConfigChangeResponse,
} from '@localixai/mini-app-sdk/backend'
