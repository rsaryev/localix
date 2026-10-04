/**
 * The resource-ref provider registry now lives in `@localixai/plugin-sdk/backend`
 * so plugins consume it from the SDK instead of deep-importing this host path.
 * This file re-exports it to keep the host's existing internal import path working.
 */
export {
  buildResourceUri,
  createResourceProviderRegistry,
  decodeResourceSegment,
  encodeResourceSegment,
  linkAction,
  noticeNode,
  parseResourceUri,
  providerSegments,
  truncationNotice,
} from '@localixai/plugin-sdk/backend'
export type {
  ResourceBrowseGroup,
  ResourceBrowseResult,
  ResourceExpansion,
  ResourceNode,
  ResourceNodeAction,
  ResourceProviderRegistry,
  ResourceRefProvider,
} from '@localixai/plugin-sdk/backend'
