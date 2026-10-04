/**
 * The `config_change` HITL contract lives in `@localixai/plugin-sdk/backend` (beside
 * `confirm`) so a plugin backend can raise the same request kind. Re-exported here so the
 * host's client leaf (`apps/api/src/client.ts`) reaches it through the same internal path as
 * the other HITL kinds instead of importing the SDK's backend entry into the browser bundle.
 */
export type {
  ConfigChangePayload,
  ConfigChangeRequest,
  ConfigChangeResponse,
  ConfigChangeResponsePayload,
  ConfigReloadClass,
} from '@localixai/plugin-sdk/backend'
