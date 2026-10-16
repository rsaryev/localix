import type { AttachmentGate, PendingAttachment } from '@/shared/lib/attachment-policy'
import {
  droppedFilePath,
  restagedAttachment,
  isDocument,
  isImage,
  isAudio,
  isPdf,
  isText,
  INLINE_ATTACHMENT_BYTES,
  fileToStoredAttachment,
  nextId,
  readAsBase64,
  readAsText,
  mediaTypeForImage,
  documentMediaType,
  failedAttachmentNote,
} from './file-staging-helpers'
export {
  filesFromDesktopPick,
  messageAttachmentToFile,
  rememberDroppedFilePath,
} from './file-staging-helpers'

export type AttachmentResult =
  | { ok: true; pending: PendingAttachment }
  | { ok: false; name: string; reason: string }

/** Read or store a single browser File into a staged attachment, honoring explicit caller policy. */
export async function fileToAttachment(
  file: File,
  gate: AttachmentGate,
): Promise<AttachmentResult> {
  const droppedPath = droppedFilePath(file)
  if (droppedPath) {
    return {
      ok: true,
      pending: {
        id: nextId(),
        attachment: {
          kind: 'path',
          path: droppedPath,
          mediaType: file.type || 'application/octet-stream',
          name: file.name,
          size: file.size,
        },
      },
    }
  }

  // Office documents are the one deliberate opt-out. The composer gate never
  // disables them; the image-only HITL reference picker explicitly does.
  if (isDocument(file) && !gate.allowDocuments)
    return { ok: false, name: file.name, reason: 'document attachments are disabled' }

  const restaged = restagedAttachment(file)
  if (restaged) {
    if (
      (restaged.kind === 'image' && !gate.allowImages) ||
      (restaged.kind === 'audio' && !gate.allowAudio)
    ) {
      const data = restaged.data ? { data: restaged.data } : {}
      const mediaId = restaged.mediaId ? { mediaId: restaged.mediaId } : {}
      return {
        ok: true,
        pending: {
          id: nextId(),
          attachment: {
            kind: 'file',
            mediaType: restaged.kind === 'image' ? 'application/octet-stream' : restaged.mediaType,
            ...data,
            ...mediaId,
            name: restaged.name,
            size: restaged.size,
          },
        },
      }
    }
    return { ok: true, pending: { id: nextId(), attachment: restaged } }
  }

  if (file.size >= INLINE_ATTACHMENT_BYTES) {
    return { ok: true, pending: await fileToStoredAttachment(file, gate) }
  }

  if (isImage(file)) {
    const mediaType = mediaTypeForImage(file)
    const data = await readAsBase64(file)
    if (!gate.allowImages) {
      return {
        ok: true,
        pending: {
          id: nextId(),
          attachment: {
            kind: 'file',
            mediaType: 'application/octet-stream',
            data,
            name: file.name,
            size: file.size,
          },
        },
      }
    }
    return {
      ok: true,
      pending: {
        id: nextId(),
        attachment: { kind: 'image', mediaType, data, name: file.name, size: file.size },
        previewUrl: URL.createObjectURL(file),
      },
    }
  }

  if (isPdf(file)) {
    // NOT gated on a model modality any more. A PDF goes the same way an office document
    // does: the server spills the bytes into the session workspace and the documents
    // pipeline extracts its text, so the agent reads it with its own tools. Gating it on
    // `pdf` in the model's input modalities refused a perfectly usable attachment —
    // "Skipped 1 file(s): X.pdf: model has no PDF support" — while .docx beside it was
    // accepted by the very same mechanism. `allowPdf` remains useful as native-model
    // capability metadata, but never as permission to drop the attachment.
    const data = await readAsBase64(file)
    return {
      ok: true,
      pending: {
        id: nextId(),
        attachment: {
          kind: 'file',
          mediaType: 'application/pdf',
          data,
          name: file.name,
          size: file.size,
        },
      },
    }
  }

  if (isDocument(file)) {
    // Office docs (docx/xlsx/pptx/odt) — staged as a file attachment. The server
    // spills the bytes to the session workspace (attachment-spill) so the agent can
    // read them lazily via the document-extraction pipeline; nothing binary is dumped
    // into the model context.
    const data = await readAsBase64(file)
    return {
      ok: true,
      pending: {
        id: nextId(),
        attachment: {
          kind: 'file',
          mediaType: documentMediaType(file),
          data,
          name: file.name,
          size: file.size,
        },
      },
    }
  }

  if (isAudio(file)) {
    const data = await readAsBase64(file)
    if (!gate.allowAudio) {
      return {
        ok: true,
        pending: {
          id: nextId(),
          attachment: {
            kind: 'file',
            mediaType: file.type,
            data,
            name: file.name,
            size: file.size,
          },
        },
      }
    }
    return {
      ok: true,
      pending: {
        id: nextId(),
        attachment: { kind: 'audio', mediaType: file.type, data, name: file.name, size: file.size },
        previewUrl: URL.createObjectURL(file),
      },
    }
  }

  if (isText(file)) {
    // Text below the shared 50KB boundary stays inline. Larger CSV/log/source files
    // returned through the media-id branch above; the server rehydrates and spills
    // them to the session cwd, then hands the model only a manifest + head preview
    // (run/attachment-spill.ts) so the agent reads them lazily with the read tool.
    const text = await readAsText(file)
    return {
      ok: true,
      pending: {
        id: nextId(),
        attachment: { kind: 'text', text, name: file.name, size: file.size },
      },
    }
  }

  // Anything else — video, archives, binaries, an unrecognised extension — is staged as a
  // plain file rather than refused. The server spills it into
  // `.localix/attachments/<session>/<message>/` and hands the model a manifest naming the
  // real path, so the agent decides what to do with its own tools instead of the composer
  // deciding for it. This branch used to be the single biggest source of "unsupported file
  // type": video had no branch at all, and neither did anything without a known extension.
  const data = await readAsBase64(file)
  return {
    ok: true,
    pending: {
      id: nextId(),
      attachment: {
        kind: 'file',
        mediaType: file.type || 'application/octet-stream',
        data,
        name: file.name,
        size: file.size,
      },
    },
  }
}

/** Stage a recorded voice message (composer mic) as a pending audio attachment. */
export async function voiceBlobToAttachment(
  blob: Blob,
  durationMs: number,
): Promise<PendingAttachment> {
  const mediaType = blob.type || 'audio/webm'
  const ext = mediaType.includes('ogg')
    ? 'ogg'
    : mediaType.includes('mp4')
      ? 'm4a'
      : mediaType.includes('wav')
        ? 'wav'
        : 'webm'
  const file = new File([blob], `voice-message.${ext}`, { type: mediaType })
  const data = await readAsBase64(file)
  return {
    id: nextId(),
    attachment: {
      kind: 'audio',
      mediaType,
      data,
      name: file.name,
      size: file.size,
      durationMs: Math.round(durationMs),
    },
    previewUrl: URL.createObjectURL(file),
  }
}

/** Read many files; returns staged attachments plus human-readable rejection notes. */
export async function filesToAttachments(
  files: File[],
  gate: AttachmentGate,
): Promise<{ pending: PendingAttachment[]; rejected: string[]; notedFailures: number }> {
  // Read each file INDEPENDENTLY: a single unreadable file (a FileReader error
  // rejects readAsBase64/readAsText) must not reject the WHOLE batch. Under
  // Promise.all one bad file discarded every already-read file AND leaked any
  // preview object-URL minted for a successful image/audio file (created, then
  // dropped unrevoked because its pending never reached state) — a crumple zone
  // where one bad input collapses good work. An allSettled boundary keeps every
  // already-read file and surfaces exactly which ones will not be sent. Here a failed
  // read/upload also becomes model-visible content, while `rejected` keeps the UI
  // honest about the missing original bytes.
  const settled = await Promise.allSettled(files.map((f) => fileToAttachment(f, gate)))
  const pending: PendingAttachment[] = []
  const rejected: string[] = []
  let notedFailures = 0
  settled.forEach((s, i) => {
    if (s.status === 'rejected') {
      const reason = s.reason instanceof Error ? s.reason.message : 'could not be read'
      rejected.push(`${files[i]!.name}: ${reason}`)
      pending.push(failedAttachmentNote(files[i]!, s.reason))
      notedFailures += 1
    } else if (s.value.ok) {
      pending.push(s.value.pending)
    } else {
      rejected.push(`${s.value.name}: ${s.value.reason}`)
    }
  })
  return { pending, rejected, notedFailures }
}
