/**
 * `view_image` — put a PNG/JPEG/GIF/WebP file in front of the model as native visual content.
 *
 * Image loading used to be a branch hidden inside `read`, which cost `read` a media clause in
 * its schema and taught the model nothing — it does not guess that a text tool returns pixels.
 * One tool, one job, one owner of the image-loading rule; `read` on an image now points here. Documents stay with `read` (they come back as extracted TEXT — this runtime
 * carries images only).
 */
import path from 'node:path'
import { z } from 'zod'
import { defineAgentTool } from '@localixai/agent/agents'
import type { ImageContent } from '@localixai/agent'
import { formatSize } from '@localixai/agent'
import { fileExtension, mediaTypeForExtension } from '@localixai/plugin-sdk/backend'
import { TOOL } from '../../tool-names'
import { type ExecutionEnvironment, shellQuote } from '../environment'
import { localEnvironment } from '../environments/local'
import { resolveTargetPath, sameNameInCwdHint, scopePathInput } from './file-utils'

export const viewImageToolInputSchema = z.object({
  path: z.string().min(1).describe('A PNG, JPEG, GIF or WebP file, absolute or relative to cwd.'),
  cwd: z.string().optional().describe('Base for relative paths (defaults to the session root).'),
})

export interface ViewImageToolDetails {
  path: string
  kind: 'image'
  mediaType: string
  bytes: number
  name: string
}

/** The image formats the runtime can deliver as vision parts (`ImageContent['mediaType']`). */
const VIEWABLE_IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp'])

/** The vision media type of a path, from the shared extension vocabulary; else `undefined`. */
function viewableImageMediaType(filePath: string): ImageContent['mediaType'] | undefined {
  const extension = fileExtension(filePath)
  return VIEWABLE_IMAGE_EXTENSIONS.has(extension)
    ? (mediaTypeForExtension(extension) as ImageContent['mediaType'])
    : undefined
}

/** Whether this path is an image `view_image` can deliver (the rule `read` defers to). */
export function isViewableImagePath(filePath: string): boolean {
  return viewableImageMediaType(filePath) !== undefined
}

/** Approximate decoded byte count of a base64 string (ignoring whitespace). */
export function base64Bytes(data: string): number {
  const len = data.length
  if (len === 0) return 0
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0
  return Math.floor((len * 3) / 4) - padding
}

/**
 * Read a binary file as clean (unwrapped) base64 through the execution environment.
 * `base64 | tr -d '\n'` is portable across macOS/Linux and works identically over the
 * local / ssh / docker backends, so the environment interface needs no binary-read primitive.
 */
async function readBase64(
  env: ExecutionEnvironment,
  targetPath: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const q = shellQuote(targetPath)
  try {
    // `uncapped`: a binary's base64 must round-trip INTACT. The default ~2 MB stdout cap keeps
    // only the TAIL, which drops the leading bytes and yields undecodable base64.
    const { stdout, exitCode } = await env.exec(`base64 < ${q} | tr -d '\\n'`, {
      uncapped: true,
      signal,
    })
    if (exitCode !== 0) return null
    const data = stdout.trim()
    return data.length > 0 ? data : null
  } catch {
    return null
  }
}

export function createViewImageTool(
  env: ExecutionEnvironment = localEnvironment,
  defaultCwd?: string,
) {
  return defineAgentTool<z.infer<typeof viewImageToolInputSchema>, ViewImageToolDetails>({
    name: TOOL.view_image,
    label: 'View image',
    activeVerb: 'Viewing image',
    description:
      'Look at an image file (screenshots, diagrams, mockups, photos) as native visual content. `read` returns text, not pixels; a PDF or office document goes through `read`.',
    inputSchema: viewImageToolInputSchema,
    // Its whole result is a picture: a model that cannot read images is not offered it.
    requiresModelInput: ['image'],
    // A reader whose output enters context, judged on containment — never a mutation to confirm.
    mutates: false,
    executionMode: 'parallel',
    parallelScopePaths: (input) => {
      const s = scopePathInput(input)
      return s ? [resolveTargetPath(s.path, s.cwd, defaultCwd)] : []
    },
    async execute(_toolCallId, input, signal, onUpdate) {
      const targetPath = resolveTargetPath(input.path, input.cwd, defaultCwd)
      const name = path.basename(targetPath)
      const mediaType = viewableImageMediaType(targetPath)
      if (!mediaType) {
        return {
          content: `${name} is not a supported image (PNG, JPEG, GIF, WebP). Use \`read\` for text and documents, or convert the file to a supported image first.`,
          isError: true,
        }
      }
      const data = await readBase64(env, targetPath, signal)
      if (!data) {
        // readBase64 swallows the cause; the same-name-in-cwd hint only fires when a file with
        // this basename exists in cwd — a strong "wrong path" signal.
        const hint = await sameNameInCwdHint(env, targetPath, input.cwd ?? defaultCwd)
        return { content: `Failed to load image: ${targetPath}${hint}`, isError: true }
      }
      const details: ViewImageToolDetails = {
        path: targetPath,
        kind: 'image',
        mediaType,
        bytes: base64Bytes(data),
        name,
      }
      onUpdate?.(details)
      return {
        content: `Image ${name} (${formatSize(details.bytes)}) is now visible to you above.`,
        contentParts: [{ type: 'image', mediaType, data }],
        details,
      }
    },
  })
}
