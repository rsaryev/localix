/**
 * The document extract/generate PORTS (and renderDocumentForModel) now live in
 * `@localixai/mini-app-sdk/backend` so plugins consume them from the SDK instead of
 * deep-importing this host path. This file re-exports them to keep the host's
 * existing internal import path working.
 */
export { renderDocumentForModel } from '@localixai/mini-app-sdk/backend'
export type { DocumentExtractPort, DocumentTextExtractor } from '@localixai/mini-app-sdk/backend'
