import type { ActionContext, ActionTarget } from '@localixai/mini-app-sdk/ui'
import type { CreateOp } from '../shared/ops/contract'
import { spaceTypes } from '../shared/types'
import { IMAGE_EXTENSIONS } from '../shared/types/references'
import { readTable } from '../shared/types/table'

const MAX_TEXT = 64 * 1024
const usableText = (text: string) => text.length <= MAX_TEXT && text.trim().length > 0
export const webUrl = (url: string) => {
  try {
    const parsed = new URL(url)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !!parsed.host
  } catch {
    return false
  }
}
export const imageUrl = (url: string) => {
  try {
    return (
      webUrl(url) &&
      IMAGE_EXTENSIONS.includes(new URL(url).pathname.split('.').pop()!.toLowerCase())
    )
  } catch {
    return false
  }
}
export const localPath = (path: string) => !!path.trim() && !/^(?:[a-z][\w+.-]*:|\/\/)/iu.test(path)
export const usableImage = (src: string) =>
  webUrl(src) || localPath(src) || /^data:image\/[\w.+-]+;base64,/iu.test(src)

export function canAddToSpace({ surface, target }: ActionContext): boolean {
  if (surface !== 'chat.content') return false
  switch (target.kind) {
    case 'visualization':
      return target.format === 'mermaid' && usableText(target.source)
    case 'code':
      return usableText(target.text)
    case 'markdown':
    case 'table':
      return usableText(target.markdown)
    case 'image':
      return usableImage(target.src)
    case 'link':
      return webUrl(target.url)
    case 'file':
      return localPath(target.path)
  }
}

/** Native types keep editable content; unsupported table syntax stays lossless Markdown. */
export function contentOperation(target: Exclude<ActionTarget, { kind: 'image' }>): CreateOp {
  switch (target.kind) {
    case 'visualization': {
      const w = target.width ?? 560
      const h = target.height ?? 320
      const scale = Math.min(1, 960 / w, 720 / h)
      const size =
        Number.isFinite(scale) && w > 0 && h > 0
          ? { w: Math.max(160, w * scale), h: Math.max(100, h * scale) }
          : {}
      return {
        op: 'create',
        type: 'mermaid',
        props: { source: target.source, title: target.title ?? '' },
        ...size,
      }
    }
    case 'code':
      return {
        op: 'create',
        type: 'code',
        props: { code: target.text, language: target.language ?? '', title: target.title ?? '' },
      }
    case 'table': {
      const parsed = readTable(target.markdown)
      if (typeof parsed !== 'string') return { op: 'create', type: 'table', props: parsed }
      return { op: 'create', type: 'text', props: { text: target.markdown } }
    }
    case 'markdown':
      return {
        op: 'create',
        type: 'text',
        w: 480,
        h: Math.min(720, Math.max(100, target.markdown.split('\n').length * 24 + 32)),
        props: { text: target.markdown },
      }
    case 'link':
      return imageUrl(target.url)
        ? { op: 'create', type: 'image', props: { url: target.url, alt: target.title ?? '' } }
        : { op: 'create', type: 'link', props: { url: target.url, title: target.title ?? '' } }
    case 'file': {
      const spec = spaceTypes.claimPath(target.path, false)
      return {
        op: 'create',
        type: spec.type,
        props: {
          ...spec.claims?.fromPath?.(target.path),
          ...(spec.type === 'file' && target.line ? { line: target.line } : {}),
        },
      }
    }
  }
}
