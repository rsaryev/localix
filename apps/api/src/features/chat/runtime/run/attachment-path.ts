/**
 * Copy-free `path` attachments: a file the user handed over that stays exactly
 * where it already lives.
 *
 * The composer produces these when a desktop drop recovers a real absolute path,
 * so nothing is copied into the workspace and the agent can act on the original.
 * What this module decides is what the model RECEIVES for one: the picture itself
 * when the wire can carry it, otherwise a manifest naming the path.
 */
import { open, readFile } from 'node:fs/promises'

import type { MessageAttachment } from '@localixai/agent'
import { isWireCarriableImage } from '@localixai/agent/agents'
import { isPathWithin } from '@localixai/path-containment'

import {
  analyzeText,
  binaryManifest,
  isTextualMediaType,
  permissionRequiredManifest,
  readTextPrefix,
  textManifest,
  unavailablePathManifest,
} from './attachment-manifests'

/**
 * Turn a persisted copy-free path into the same manifest shape as a spill, without
 * writing or rewriting the original path. Outside-workspace paths are deliberately
 * not probed here: the agent's later `read` call is the permission
 * boundary and will ask the user before any contents or filesystem metadata enter
 * model context.
 */
export async function materializePathAttachment(
  att: MessageAttachment,
  cwd: string | undefined,
): Promise<MessageAttachment> {
  if (att.kind !== 'path') return att

  // An IMAGE the user dragged into the composer is carried natively, wherever it
  // lives on disk. The outside-workspace rule below exists to stop the AGENT
  // reaching into arbitrary paths on its own; it was never meant to cover a file
  // the HUMAN explicitly handed over, and applying it here is why a screenshot
  // dropped from ~/Desktop reached the model as the sentence "use the read tool"
  // instead of as a picture. Dragging the file IS the per-file grant — the same
  // reading every other chat app takes of a dropped image.
  //
  // Deliberately probes the path even when it is outside the workspace, which the
  // branch below does not: for THIS attachment the user already chose the file, so
  // there is nothing left to ask them about, and an honest "it is gone" beats a
  // manifest that claims bytes are waiting at a path that no longer has them.
  if (isWireCarriableImage(att.mediaType)) {
    const carried = await carryPathImage(att)
    if (carried) return carried
  }

  if (cwd && !isPathWithin(cwd, att.path)) {
    return {
      kind: 'text',
      name: att.name,
      spilled: true,
      path: att.path,
      size: att.size,
      text: permissionRequiredManifest(att.path, att.mediaType, att.size),
    }
  }

  if (isTextualMediaType(att.mediaType)) {
    try {
      // A client-supplied media type is only a hint. If the bytes are not UTF-8,
      // keep them out of model context and describe the resource as binary.
      const prefix = await readTextPrefix(att.path)
      if (!prefix) {
        return {
          kind: 'text',
          name: att.name,
          spilled: true,
          path: att.path,
          size: att.size,
          text: binaryManifest(att.path, att.mediaType, att.size),
        }
      }
      const textInfo = analyzeText(prefix.text)
      return {
        kind: 'text',
        name: att.name,
        spilled: true,
        path: att.path,
        // Only a whole-file read knows the whole-file line count; over a prefix it would be
        // a lower bound reported as fact.
        ...(prefix.truncated ? {} : { lineCount: textInfo.lineCount }),
        size: att.size,
        text: textManifest(att.path, att.name, prefix.byteLength, {
          ...textInfo,
          truncated: prefix.truncated,
        }),
      }
    } catch (error) {
      return unavailablePathAttachment(att, error)
    }
  }

  try {
    const handle = await open(att.path, 'r')
    try {
      const info = await handle.stat()
      if (!info.isFile()) {
        return unavailablePathAttachment(att, new Error('The path is not a regular file.'))
      }
    } finally {
      await handle.close()
    }
    return {
      kind: 'text',
      name: att.name,
      spilled: true,
      path: att.path,
      size: att.size,
      text: binaryManifest(att.path, att.mediaType, att.size),
    }
  } catch (error) {
    return unavailablePathAttachment(att, error)
  }
}

/**
 * Raw-byte ceiling for inlining a copy-free `path` image onto the wire. Base64
 * inflates by 4/3, so this stays inside the same order of budget the preview tool
 * already works to (`browser-reply.ts`'s 7MB of base64). Above it the caller
 * falls through to the ordinary manifest, which names the real path — a picture
 * too large to send is still a file the agent can go and read.
 */
export const MAX_PATH_IMAGE_BYTES = 5 * 1024 * 1024

/**
 * Read a `path` image into a native `image` attachment.
 *
 * `null` means "not carried, use the ordinary manifest path" (too large). A file
 * that is missing or not a regular file comes back as the unavailable manifest,
 * because at this point the user has already chosen it and deserves the truth
 * about it rather than an invitation to read bytes that are not there.
 */
async function carryPathImage(
  att: Extract<MessageAttachment, { kind: 'path' }>,
): Promise<MessageAttachment | null> {
  try {
    const handle = await open(att.path, 'r')
    let info
    try {
      info = await handle.stat()
    } finally {
      await handle.close()
    }
    if (!info.isFile()) {
      return unavailablePathAttachment(att, new Error('The path is not a regular file.'))
    }
    // Sized from the FILE, never from the client-supplied `att.size`: the bound is
    // there to keep an arbitrary on-disk file out of this process's memory, and a
    // caller-provided number cannot be what enforces it.
    if (info.size > MAX_PATH_IMAGE_BYTES) return null
    const bytes = await readFile(att.path)
    return {
      kind: 'image',
      mediaType: att.mediaType,
      data: bytes.toString('base64'),
      name: att.name,
      size: info.size,
    }
  } catch (error) {
    return unavailablePathAttachment(att, error)
  }
}

function unavailablePathAttachment(
  att: Extract<MessageAttachment, { kind: 'path' }>,
  error: unknown,
): MessageAttachment {
  return {
    kind: 'text',
    name: att.name,
    spilled: true,
    path: att.path,
    size: att.size,
    text: unavailablePathManifest(att.path, error),
  }
}
