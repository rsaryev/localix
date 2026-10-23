import type { DocumentExtractPort } from './document-ports'

/**
 * Standard host extension points implemented by mini apps and consumed by the host.
 * Keys describe the capability, never the mini app that happens to provide it.
 *
 * A capability has ONE provider (first-wins). Contributions many mini apps make side by side —
 * context providers, text-input completion surfaces — are `BackendSubsystem` fields instead.
 */
export const CAP_DOCUMENT_EXTRACT = 'document.extract' as const

/** Public capability key → port contract map. */
export interface CapabilityShapes {
  [CAP_DOCUMENT_EXTRACT]: DocumentExtractPort
}

export type CapabilityKey = keyof CapabilityShapes
export type Capabilities = Partial<CapabilityShapes>
