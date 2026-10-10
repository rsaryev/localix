import { join } from 'node:path'
import { projectFile, readText } from './files'

const attr = (tag: string, name: string) =>
  tag.match(new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'u'))?.[1]
const rootTag = (html: string) => html.match(/<[a-z]+[^>]*\sdata-composition-id\s*=[^>]*>/iu)?.[0]
const registers = (html: string, id: string) =>
  // Composition IDs are [a-z0-9-]: nothing to escape.
  new RegExp(`__timelines\\s*(?:\\[\\s*["'\`]${id}["'\`]\\s*\\]|\\.${id}\\b)\\s*=`, 'u').test(html)

function scriptAndStyle(html: string) {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/giu)].map(
    (m) => m[1] ?? '',
  )
  const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/giu)].map((m) => m[1] ?? '')
  return { scripts: scripts.join('\n'), styles: styles.join('\n') }
}

function determinism(file: string, html: string): string[] {
  const { scripts, styles } = scriptAndStyle(html)
  const issues: string[] = []
  const banned: Array<[RegExp, string]> = [
    [/Math\.random\s*\(/u, 'Math.random() — use MK.random(seed)'],
    [/Date\.now\s*\(|new Date\s*\(/u, 'a wall clock (Date) — derive state from the timeline'],
    [/performance\.now\s*\(/u, 'performance.now() — derive state from the timeline'],
    [/\bset(?:Timeout|Interval)\s*\(/u, 'timers — put every change on the timeline'],
    [/requestAnimationFrame\s*\(/u, 'requestAnimationFrame — put every change on the timeline'],
    [/\.play\s*\(\s*\)/u, '.play() — HyperFrames owns playback; keep timelines paused'],
    [/repeat\s*:\s*-1/u, 'repeat: -1 — use a finite repeat count'],
  ]
  for (const [pattern, message] of banned)
    if (pattern.test(scripts)) issues.push(`${file}: avoid ${message}.`)
  if (/(^|[;{\s])(animation|transition)\s*:/mu.test(styles))
    issues.push(`${file}: CSS animation/transition does not seek; animate on the GSAP timeline.`)
  return issues
}

/**
 * What can be proven without a browser: the root contract, every scene wired and registered,
 * local references present, no clocks or randomness, no leftover starter copy. `hyperframes
 * check` (browser) covers layout, contrast and runtime errors.
 */
export async function lintProject(folder: string): Promise<{ issues: string[]; meta: Meta }> {
  const issues: string[] = []
  const meta: Meta = { title: '', width: 1920, height: 1080, duration: null, scenes: 0 }
  const index = await readText(join(folder, 'index.html'))
  if (index === null) return { issues: ['index.html is missing.'], meta }
  meta.title = index.match(/<title>([^<]*)<\/title>/iu)?.[1]?.trim() ?? ''
  const root = rootTag(index)
  if (!root) issues.push('index.html: no root element with data-composition-id.')
  else {
    const id = attr(root, 'data-composition-id') ?? ''
    meta.width = Number(attr(root, 'data-width')) || meta.width
    meta.height = Number(attr(root, 'data-height')) || meta.height
    const duration = Number(attr(root, 'data-duration'))
    meta.duration = Number.isFinite(duration) && duration > 0 ? duration : null
    if (!attr(root, 'data-width') || !attr(root, 'data-height'))
      issues.push('index.html: the root needs data-width and data-height.')
    if (meta.duration === null) issues.push('index.html: set data-duration on the root (seconds).')
    if (!registers(index, id) && !/data-no-timeline/u.test(root))
      issues.push(`index.html: register the root timeline as window.__timelines['${id}'].`)
  }
  issues.push(...determinism('index.html', index))
  const hosts = [...index.matchAll(/<[a-z]+[^>]*\sdata-composition-src\s*=[^>]*>/giu)].map(
    (m) => m[0],
  )
  // The finishing overlay is not a scene.
  meta.scenes = hosts.filter((host) => attr(host, 'data-composition-id') !== 'finish').length
  const texts = [index]
  for (const host of hosts) {
    const src = attr(host, 'data-composition-src') ?? ''
    const id = attr(host, 'data-composition-id') ?? ''
    const file = await projectFile(folder, src)
    const html = file ? await readText(file) : null
    if (html === null) {
      issues.push(`index.html: scene "${id}" points to ${src}, which does not exist.`)
      continue
    }
    texts.push(html)
    if (!/<template[\s>]/iu.test(html)) issues.push(`${src}: wrap the scene in <template>.`)
    const inner = rootTag(html)
    const innerId = inner ? attr(inner, 'data-composition-id') : undefined
    if (innerId !== id)
      issues.push(`${src}: data-composition-id must be "${id}" to match its host.`)
    if (!registers(html, id) && !/data-no-timeline/u.test(html))
      issues.push(`${src}: register window.__timelines['${id}'] after building the timeline.`)
    if (!attr(host, 'data-duration')) issues.push(`index.html: scene "${id}" needs data-duration.`)
    issues.push(...determinism(src, html))
  }
  // Comments may show example markup; only live references count.
  const live = (html: string) =>
    html.replace(/<!--[\s\S]*?-->/gu, '').replace(/\/\*[\s\S]*?\*\//gu, '')
  for (const html of texts.map(live))
    for (const match of html.matchAll(
      /\s(?:src|href)\s*=\s*["'](?!https?:|data:|#|\/\/)([^"']+)["']/giu,
    )) {
      const ref = match[1]!.split(/[?#]/u)[0]!
      if (ref && !(await projectFile(folder, ref))) issues.push(`Missing file referenced: ${ref}.`)
    }
  // Directions mark their sample copy with data-sample; replacing a line removes the attribute.
  const samples =
    texts
      .map(live)
      .join('\n')
      .match(/\sdata-sample\b/gu)?.length ?? 0
  if (samples)
    issues.push(
      `${samples} sample line${samples === 1 ? ' is' : 's are'} still on screen (elements with data-sample). Replace them with the real story and remove the attribute.`,
    )
  return { issues: [...new Set(issues)].slice(0, 40), meta }
}
export interface Meta {
  title: string
  width: number
  height: number
  duration: number | null
  scenes: number
}
