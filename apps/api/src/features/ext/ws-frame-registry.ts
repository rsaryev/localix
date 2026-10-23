/**
 * Host-shim: the generic live-stream contribution seam now lives in
 * `@localixai/mini-app-sdk/backend` — a bundled mini app backend types its `WsFrameContribution`
 * against it, so the type (and the registry machinery the host drives) can't be a
 * mini app→apps/api deep-import. This file stays as the stable in-host import path every
 * host caller already uses (`bootstrap`, `app`, `realtime/ws`, `subsystem-contrib`).
 */
export { createWsFrameConnection, createWsFrameRegistry } from '@localixai/mini-app-sdk/backend'
export type {
  WsFrameConnection,
  WsFrameContribution,
  WsFrameRegistry,
} from '@localixai/mini-app-sdk/backend'
