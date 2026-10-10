import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { HYPERFRAMES_VERSION } from '../shared/contract'
import { projectFile } from './files'

/**
 * The player injects the HyperFrames runtime itself only into a same-origin frame. Motion Studio
 * isolates agent-authored films at an opaque origin, so the served root page carries the runtime
 * (first in <head>, before the composition's scripts). Renders use the CLI's own copy.
 */
const RUNTIME = `<script src="https://cdn.jsdelivr.net/npm/@hyperframes/core@${HYPERFRAMES_VERSION}/dist/hyperframe.runtime.iife.js"></script>`

/**
 * Project files reach the player by URL, and an iframe cannot send headers, so the URL itself
 * is the capability: `/rpc/motion/view/<session>/<project>/<signature>/<file>`. The signature is
 * an HMAC over user, session and project with a per-process key — a guessed session ID is not
 * enough to read a film, and every URL dies with the backend that issued it.
 */
const key = randomBytes(32)
export const viewSignature = (userId: string, sessionId: string, projectId: string) =>
  createHmac('sha256', key)
    .update(`${userId}\0${sessionId}\0${projectId}`)
    .digest('hex')
    .slice(0, 32)
export function verifyView(
  userId: string,
  sessionId: string,
  projectId: string,
  signature: string,
) {
  const expected = Buffer.from(viewSignature(userId, sessionId, projectId))
  const given = Buffer.from(signature)
  return given.length === expected.length && timingSafeEqual(given, expected)
}
export const viewBase = (userId: string, sessionId: string, projectId: string) =>
  `/rpc/motion/view/${encodeURIComponent(sessionId)}/${projectId}/${viewSignature(userId, sessionId, projectId)}/`

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.lottie': 'application/zip',
}

/** A file response for the player, or null when the file is missing or escapes the project. */
export async function serveProjectFile(folder: string, path: string): Promise<Response | null> {
  const file = await projectFile(folder, path || 'index.html')
  if (!file) return null
  return fileResponse(file, path || 'index.html', await readFile(file))
}

/** Headers and runtime injection shared by project and direction files. */
export function fileResponse(file: string, path: string, bytes: Buffer): Response {
  const type = TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream'
  const headers = new Headers({
    'Content-Type': type,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    // The isolated player runs at an opaque origin and fetches scenes cross-origin.
    'Access-Control-Allow-Origin': '*',
    'Cross-Origin-Resource-Policy': 'cross-origin',
  })
  // Agent-authored HTML never runs with the API's origin, even when opened directly.
  if (type.startsWith('text/html') || type === 'image/svg+xml')
    headers.set('Content-Security-Policy', 'sandbox allow-scripts')
  if (path === 'index.html' && !bytes.includes('hyperframe.runtime')) {
    const html = bytes.toString('utf8')
    const at = html.search(/<head[^>]*>/iu)
    const injected =
      at < 0 ? RUNTIME + html : html.replace(/<head[^>]*>/iu, (head) => `${head}\n    ${RUNTIME}`)
    return new Response(injected, { headers })
  }
  return new Response(new Uint8Array(bytes), { headers })
}
