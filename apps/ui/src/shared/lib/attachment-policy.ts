import type { MessageAttachment } from '@/shared/api/contracts'

/**
 * A file the user has staged in the composer but not yet sent. Wraps the wire
 * `MessageAttachment` with a stable id (for React keys / removal) and, for images,
 * an object-URL preview shown in the tray.
 */
export interface PendingAttachment {
  id: string
  attachment: MessageAttachment
  /** Object URL for image previews — revoke on removal/send to avoid leaks. */
  previewUrl?: string
}

export interface AttachmentGate {
  /** Native model modality. False means hand the bytes over as an agent-readable file. */
  allowImages: boolean
  allowPdf: boolean
  allowAudio: boolean
  /** Office documents (docx/xlsx/pptx/odt). Not a model modality — handled by the
   *  extraction pipeline — so allowed regardless of the model, unless a caller opts out. */
  allowDocuments: boolean
  /** False for the composer: unsupported native modalities still remain selectable as files. */
  limitPickerToAllowedKinds?: boolean
}

/**
 * Composer attachments are agent resources, not only native model content parts.
 * Modality metadata chooses native-part vs file handoff; it never disables the
 * attachment. A caller may still construct a narrower gate explicitly (the
 * image-only HITL reference picker opts out of documents this way).
 */
export function attachmentGate(inputModalities: string[] | undefined): AttachmentGate {
  // Unknown modalities → be permissive (matches the backend default), so we never
  // turn a usable native attachment into a generic file when the catalog lacks info.
  if (!inputModalities || inputModalities.length === 0)
    return {
      allowImages: true,
      allowPdf: true,
      allowAudio: true,
      allowDocuments: true,
      limitPickerToAllowedKinds: false,
    }
  return {
    allowImages: inputModalities.includes('image'),
    allowPdf: inputModalities.includes('pdf'),
    allowAudio: inputModalities.includes('audio'),
    // Office docs are read via extraction/spill, not a native modality — always on.
    allowDocuments: true,
    limitPickerToAllowedKinds: false,
  }
}

/**
 * Pasted text longer than this is attached as a `pasted-text.txt` file instead of
 * being dumped into the textarea (keeps the composer usable for huge clipboards).
 */
export const LARGE_PASTE_CHARS = 4000

/** The accept attribute for the file picker, derived from the gate. */
export function acceptAttribute(gate: AttachmentGate): string {
  // An unrestricted composer gate must leave the browser picker unrestricted too;
  // an extension/MIME allowlist would still make arbitrary agent-readable files
  // impossible to select even though drop/paste accepts them.
  if (gate.limitPickerToAllowedKinds === false) return ''
  const parts = ['.txt,.md,.json,.csv,.log,.xml,.yaml,.yml,text/*']
  if (gate.allowImages) parts.unshift('image/png,image/jpeg,image/gif,image/webp')
  if (gate.allowPdf) parts.unshift('application/pdf')
  if (gate.allowDocuments) parts.unshift('.docx,.xlsx,.pptx,.odt')
  return parts.join(',')
}
