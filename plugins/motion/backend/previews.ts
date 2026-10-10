import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { styleById, styleCss } from '../shared/styles'
import { projectFile } from './files'
import { DIRECTIONS_DIR, KIT_DIR } from './projects'
import { fileResponse } from './view'

/** Gallery stills, rendered from each direction's film at its poster second (`bun run previews`). */
export const PREVIEWS_DIR = resolve(import.meta.dir, '..', 'previews')

export async function serveStylePreview(id: string): Promise<Response | null> {
  if (!styleById(id)) return null
  const bytes = await readFile(join(PREVIEWS_DIR, `${id}.jpg`)).catch(() => null)
  return bytes
    ? new Response(new Uint8Array(bytes), {
        headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=3600' },
      })
    : null
}

/**
 * A direction's film as the player loads it, assembled on the fly exactly as `create` would fork
 * it: the shared kit and the direction's tokens under blocks/. Public, read-only sample content.
 */
export async function serveDirectionFile(id: string, path: string): Promise<Response | null> {
  const direction = styleById(id)
  if (!direction) return null
  const file = path || 'index.html'
  if (file === 'blocks/style.css')
    return fileResponse('style.css', file, Buffer.from(styleCss(direction)))
  if (file === 'blocks/motion-kit.css' || file === 'blocks/motion-kit.js') {
    const kit = join(KIT_DIR, file.slice('blocks/'.length))
    return fileResponse(kit, file, await readFile(kit))
  }
  const real = await projectFile(join(DIRECTIONS_DIR, direction.id), file)
  return real ? fileResponse(real, file, await readFile(real)) : null
}
