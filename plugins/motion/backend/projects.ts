import {
  copyFile,
  cp,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { basename, extname, isAbsolute, join, resolve } from 'node:path'
import { isPathWithin } from '@localixai/path-containment'
import {
  MOTION_DIR,
  projectIdSchema,
  type MotionFile,
  type MotionFormat,
  type MotionProject,
} from '../shared/contract'
import { DEFAULT_STYLE, motionStyles, styleById, styleCss, styleMarkdown } from '../shared/styles'
import { listFiles, motionDirectory, projectDirectory, revisionOf } from './files'
import { lintProject } from './lint'
import { announceWrite } from './writes'

/** Shipped beside the backend: the direction films and the shared kit (`plugins/motion/…`). */
export const DIRECTIONS_DIR = resolve(import.meta.dir, '..', 'directions')
export const KIT_DIR = resolve(import.meta.dir, '..', 'kit')
const SIZES: Record<MotionFormat, [number, number]> = {
  landscape: [1920, 1080],
  portrait: [1080, 1920],
  square: [1080, 1080],
}
const MEDIA =
  /\.(png|jpe?g|webp|gif|svg|avif|mp4|webm|mov|mp3|wav|ogg|m4a|aac|woff2?|ttf|otf|json|lottie)$/iu
const MAX_IMPORT = 200 * 1024 * 1024

export class MotionError extends Error {
  constructor(
    public code: 'not_found' | 'invalid' | 'conflict' | 'unavailable',
    message: string,
  ) {
    super(message)
  }
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"]/gu, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
export const slugify = (title: string) =>
  title
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 48)
    .replace(/-+$/u, '') || 'film'

async function outputs(
  folder: string,
  dir: 'renders' | 'snapshots',
  id: string,
): Promise<MotionFile[]> {
  const path = join(folder, dir)
  const entries = await readdir(path, { withFileTypes: true }).catch(() => [])
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
      .filter((entry) =>
        (dir === 'renders' ? /\.(mp4|webm|mov|gif)$/iu : /\.(png|jpe?g)$/iu).test(entry.name),
      )
      .map(async (entry) => {
        const info = await stat(join(path, entry.name))
        return {
          name: entry.name,
          path: `${MOTION_DIR}/${id}/${dir}/${entry.name}`,
          bytes: info.size,
          updatedAt: info.mtime.toISOString(),
        }
      }),
  )
  return files.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/** One project as the view and the agent see it; jobs are attached by the caller. */
export async function readProject(
  folder: string,
  id: string,
): Promise<Omit<MotionProject, 'job' | 'view'>> {
  const [files, { issues, meta }] = await Promise.all([listFiles(folder), lintProject(folder)])
  const latest = Math.max(0, ...files.map((file) => file.mtime))
  return {
    id,
    title: meta.title || id,
    path: `${MOTION_DIR}/${id}`,
    width: meta.width,
    height: meta.height,
    duration: meta.duration,
    scenes: meta.scenes,
    style: await styleOf(folder),
    updatedAt: new Date(latest || Date.now()).toISOString(),
    revision: revisionOf(files),
    renders: await outputs(folder, 'renders', id),
    snapshots: await outputs(folder, 'snapshots', id),
    issues,
  }
}

export async function listProjects(workspace: string) {
  const dir = await motionDirectory(workspace)
  const projects: Array<Omit<MotionProject, 'job' | 'view'>> = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !projectIdSchema.safeParse(entry.name).success) continue
    const folder = await projectDirectory(workspace, entry.name)
    if (!folder) continue
    if (!(await stat(join(folder, 'index.html')).catch(() => null))) continue
    projects.push(await readProject(folder, entry.name))
  }
  return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/**
 * Fork a direction's film into `.localix/motion/<id>/`: its scenes, the shared kit, the
 * direction's tokens and rules. A format other than the direction's own resizes the frame; the
 * agent then adapts the layout.
 */
export async function createProject(
  workspace: string,
  input: { title: string; direction?: string; format?: MotionFormat; name?: string },
): Promise<string> {
  const direction = styleById(input.direction ?? DEFAULT_STYLE)
  if (!direction)
    throw new MotionError(
      'invalid',
      `Unknown direction "${input.direction}". Directions: ${motionStyles.map((s) => s.id).join(', ')}.`,
    )
  const source = join(DIRECTIONS_DIR, direction.id)
  const dir = await motionDirectory(workspace)
  const taken = new Set(await readdir(dir))
  const base = input.name ?? slugify(input.title)
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base.slice(0, 58)}-${n}`
  const folder = join(dir, id)
  await cp(source, folder, {
    recursive: true,
    errorOnExist: true,
    filter: (path) =>
      !/(^|\/)(renders|snapshots|node_modules)(\/|$)/u.test(path.slice(source.length)),
  })
  await mkdir(join(folder, 'blocks'), { recursive: true })
  await copyFile(join(KIT_DIR, 'motion-kit.css'), join(folder, 'blocks', 'motion-kit.css'))
  await copyFile(join(KIT_DIR, 'motion-kit.js'), join(folder, 'blocks', 'motion-kit.js'))
  await copyFile(join(KIT_DIR, 'AGENTS.md'), join(folder, 'AGENTS.md'))
  await applyStyle(folder, direction.id)
  const [nativeW, nativeH] = SIZES[direction.format]
  const [width, height] = SIZES[input.format ?? direction.format]
  for (const file of await listFiles(folder)) {
    if (!file.path.endsWith('.html') && file.path !== 'package.json') continue
    const path = join(folder, file.path)
    let text = await readFile(path, 'utf8')
    if (width !== nativeW || height !== nativeH)
      text = text
        .replaceAll(`data-width="${nativeW}"`, `data-width="${width}"`)
        .replaceAll(`data-height="${nativeH}"`, `data-height="${height}"`)
        .replace(
          `content="width=${nativeW}, height=${nativeH}"`,
          `content="width=${width}, height=${height}"`,
        )
        .replace(/--u: [\d.]+px;/u, `--u: ${Math.min(width, height) / 100}px;`)
    text = text
      .replace(/<title>[^<]*<\/title>/u, `<title>${escapeHtml(input.title)}</title>`)
      .replace(/"name": "[^"]*"/u, `"name": ${JSON.stringify(id)}`)
    await writeFile(path, text)
  }
  announceWrite(folder)
  return id
}

/**
 * Write a direction's tokens (blocks/style.css) and rules (DIRECTION.md) into a project, replacing
 * the previous ones: the vector without the scenes.
 */
export async function applyStyle(folder: string, styleId: string) {
  const style = styleById(styleId)
  if (!style)
    throw new MotionError(
      'invalid',
      `Unknown style "${styleId}". Styles: ${motionStyles.map((s) => s.id).join(', ')}.`,
    )
  await mkdir(join(folder, 'blocks'), { recursive: true })
  await writeFile(join(folder, 'blocks', 'style.css'), styleCss(style))
  await writeFile(join(folder, 'DIRECTION.md'), styleMarkdown(style))
  announceWrite(folder)
  return style
}

/** The direction a project was last given, from its DIRECTION.md heading. */
export async function styleOf(folder: string) {
  const text = await readFile(join(folder, 'DIRECTION.md'), 'utf8').catch(() => '')
  const name = text.match(/^# Direction: (.+)$/mu)?.[1]?.trim()
  return motionStyles.find((style) => style.name === name)?.id ?? null
}

export async function removeProject(workspace: string, id: string) {
  const folder = await projectDirectory(workspace, id)
  if (!folder) throw new MotionError('not_found', 'This film no longer exists.')
  await rm(folder, { recursive: true, force: true })
  announceWrite(folder)
}

/**
 * Copy workspace files (screenshots, logos, music, fonts) into the project's assets/, keeping
 * names readable. The same file imported again returns its existing name.
 */
export async function importAssets(
  workspace: string,
  id: string,
  sources: Array<{ path: string; name?: string }>,
) {
  const folder = await projectDirectory(workspace, id)
  if (!folder) throw new MotionError('not_found', `No film "${id}". Call list for IDs.`)
  const root = await realpath(workspace)
  const assets = join(folder, 'assets')
  await mkdir(assets, { recursive: true })
  const results: Array<{ source: string; path?: string; error?: string }> = []
  for (const source of sources) {
    try {
      const from = await realpath(
        isAbsolute(source.path) ? source.path : resolve(root, source.path),
      )
      if (!isPathWithin(root, from)) throw new Error('is outside this workspace')
      const info = await stat(from)
      if (!info.isFile()) throw new Error('is not a file')
      if (info.size > MAX_IMPORT) throw new Error('is larger than 200 MB')
      const name =
        (source.name ?? basename(from)).replace(/[^A-Za-z0-9._-]+/gu, '-').replace(/^[-.]+/u, '') ||
        'asset'
      const ext = extname(name) || extname(from)
      const fileName = extname(name) ? name : `${name}${ext}`
      if (!MEDIA.test(fileName))
        throw new Error('is not an image, video, audio, font or Lottie file')
      let target = join(assets, fileName)
      for (let n = 2; await stat(target).catch(() => null); n++) {
        const same = (await readFile(target)).equals(await readFile(from))
        if (same) break
        target = join(assets, fileName.replace(/(\.[^.]+)?$/u, `-${n}$1`))
      }
      await copyFile(from, target)
      results.push({ source: source.path, path: `assets/${basename(target)}` })
    } catch (error) {
      results.push({
        source: source.path,
        error: `${source.path} ${error instanceof Error ? error.message.replace(/^ENOENT.*/u, 'does not exist') : 'could not be copied'}`,
      })
    }
  }
  announceWrite(folder)
  return results
}
