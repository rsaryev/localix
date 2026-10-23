/**
 * The resource-ref provider registry now lives in `@localixai/mini-app-sdk/backend`
 * so mini apps consume it from the SDK instead of deep-importing this host path.
 * This file re-exports it to keep the host's existing internal import path working.
 */
export {
  buildResourceUri,
  createResourceProviderRegistry,
  decodeResourceSegment,
  linkAction,
  noticeNode,
  parseResourceUri,
  providerSegments,
  truncationNotice,
} from '@localixai/mini-app-sdk/backend'
export type {
  ResourceBrowseGroup,
  ResourceBrowseResult,
  ResourceExpansion,
  ResourceNode,
  ResourceNodeAction,
  ResourceProviderRegistry,
  ResourceRefProvider,
} from '@localixai/mini-app-sdk/backend'
