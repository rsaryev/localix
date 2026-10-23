import type { ActionTarget } from '@localixai/mini-app-sdk/ui'
import type { SpaceDocument } from '../shared/format/document'
import { contentOperation, localPath, webUrl } from './action-target'

function nativeKey(type: string, props: Record<string, unknown>): string | null {
  switch (type) {
    case 'text':
      return JSON.stringify(['text', props.text])
    case 'code':
      return JSON.stringify(['code', props.code, props.language ?? ''])
    case 'mermaid':
      return JSON.stringify(['mermaid', props.source])
    case 'table':
      return JSON.stringify(['table', props.columns, props.rows])
    case 'image':
      return JSON.stringify(['image', props.path ?? props.url])
    case 'link':
      return JSON.stringify(['link', props.url])
    case 'file':
      return JSON.stringify(['file', props.path, props.line ?? null])
    case 'folder':
    case 'document':
      return JSON.stringify([type, props.path])
    default:
      return null
  }
}

const indices = new WeakMap<SpaceDocument, Set<string>>()
const targets = new WeakMap<ActionTarget, string | null>()

/** Older copies have random ids. Index their native content once per snapshot, never per button. */
export function containsFragment(space: SpaceDocument, target: ActionTarget) {
  let targetKey = targets.get(target)
  if (targetKey === undefined) {
    if (target.kind === 'image') {
      targetKey =
        webUrl(target.src) || localPath(target.src)
          ? nativeKey('image', { path: target.src })
          : null
    } else {
      const op = contentOperation(target)
      targetKey = op.op === 'create' ? nativeKey(op.type, op.props ?? {}) : null
    }
    targets.set(target, targetKey)
  }
  if (!targetKey) return false
  let index = indices.get(space)
  if (!index) {
    index = new Set()
    for (const element of Object.values(space.elements)) {
      const key = nativeKey(element.type, element.props)
      if (key) index.add(key)
    }
    indices.set(space, index)
  }
  return index.has(targetKey)
}
