import { readMessageBindingDrag, type MessageContextBindingDraft } from '@localixai/mini-app-sdk/ui'
import { miniAppFiles } from '@localixai/mini-app-sdk/ui/runtime'
import { linksInText } from '@localixai/kit/context-links'
import { contentFromText } from '../../shared/content/text'
import type { SpaceDocument } from '../../shared/format/document'
import type { SpaceOp } from '../../shared/ops/contract'
import { placeNear } from '../../shared/ops/geometry'
import { spaceTypes } from '../../shared/types'
import { spaceApi } from '../api'
import { contentOfLink } from './links'

/**
 * Everything that arrives from outside the board — a drag from the file tree or an editor tab,
 * files from the desktop, a paste of text or of a screenshot — goes through here and leaves as
 * `create` operations. One entry for every source, so a folder
 * dragged from the tree and a folder dropped from Finder become the same element, chosen by the
 * same registry claim the agent's operations use.
 *
 * Nothing is copied: a path becomes a reference. Only content WITHOUT a path — a screenshot on
 * the clipboard, a file dropped in a browser build — is kept beside the board and referenced from
 * there, because there is nothing else to point at.
 */
export type Incoming =
  | { kind: 'path'; path: string; isDir: boolean }
  | { kind: 'file'; file: File }
  | { kind: 'text'; text: string }
  | { kind: 'link'; link: MessageContextBindingDraft }

/**
 * What a drop carries, most specific first: an in-app link (ANY kind — a session, a tool call, a
 * provider resource, not only a file), desktop paths, then text.
 */
export async function incomingFromDrop(transfer: DataTransfer): Promise<Incoming[]> {
  const binding = readMessageBindingDrag(transfer)
  if (binding) return [{ kind: 'link', link: binding }]

  const files = [...transfer.files]
  if (files.length) {
    const paths = await miniAppFiles.droppedPaths(files)
    if (paths) return paths.map((entry) => ({ kind: 'path', ...entry }))
    return files.map((file) => ({ kind: 'file', file }))
  }
  const uri = transfer
    .getData('text/uri-list')
    .split('\n')
    .find((line) => line && !line.startsWith('#'))
  const text = uri || transfer.getData('text/plain')
  return fromText(text)
}

/** What a paste carries: files (a screenshot) first, else its text. */
export function incomingFromPaste(data: DataTransfer): Incoming[] {
  const files = [...data.files]
  if (files.length) return files.map((file) => ({ kind: 'file', file }))
  return fromText(data.getData('text/plain'))
}

/**
 * Text that is nothing but app links — `@session:… @call:…`, a `localix://…` URI — is those
 * things, read by the host's own grammar; anything with words around its links is prose, a note.
 */
function fromText(text: string): Incoming[] {
  if (!text.trim()) return []
  const { links, onlyLinks } = linksInText(text)
  if (onlyLinks) return links.map((link) => ({ kind: 'link', link }))
  return [{ kind: 'text', text }]
}

const GAP = 24

/**
 * The operations that put `items` on the board around `at` (the drop point, or the middle of the
 * view): each takes the free spot nearest the point, the ones before it in the same drop counted
 * as taken, so a handful of files lands as a cluster where it was dropped and never as a stack.
 */
export async function opsFor(
  items: readonly Incoming[],
  at: { x: number; y: number },
  sessionId: string,
  space: SpaceDocument,
): Promise<SpaceOp[]> {
  const ops: SpaceOp[] = []
  const placed: { x: number; y: number; w: number; h: number }[] = []
  for (const item of items) {
    const content = await contentOf(item, sessionId)
    if (!content) continue
    const spec = spaceTypes.get(content.type)
    const measured = spec?.measure?.(content.props as never)
    const size = measured ?? spec?.size ?? { w: 240, h: 160 }
    const padded = placed.map((box) => ({
      ...box,
      x: box.x - GAP / 2,
      y: box.y - GAP / 2,
      w: box.w + GAP,
      h: box.h + GAP,
    }))
    const spot = placeNear(space, size, at, spaceTypes, padded)
    placed.push({ ...spot, ...size })
    ops.push({
      op: 'create',
      type: content.type,
      x: Math.round(spot.x),
      y: Math.round(spot.y),
      props: content.props,
    })
  }
  return ops
}

async function contentOf(item: Incoming, sessionId: string) {
  if (item.kind === 'text') return contentFromText(item.text, spaceTypes)
  if (item.kind === 'link') {
    const content = contentOfLink(item.link)
    if (!content) return null
    if (content.kind === 'element') return { type: content.type, props: content.props }
    return contentOfPath(content.path, content.isDir)
  }
  if (item.kind === 'path') return contentOfPath(item.path, item.isDir)
  return contentOfPath(
    await spaceApi.keepFile(sessionId, item.file, item.file.name || 'pasted.png'),
  )
}

function contentOfPath(path: string, isDir = false) {
  const spec = spaceTypes.claimPath(path, isDir)
  return { type: spec.type, props: spec.claims?.fromPath?.(path) ?? { path } }
}
