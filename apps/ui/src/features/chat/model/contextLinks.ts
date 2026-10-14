import {
  messageRefFromRaw,
  parseContextRefs,
  refLabel,
  toWireRef,
  type ParsedContextRef,
} from '@localixai/api/context-refs'
import type { MessageAttachment } from '@localixai/agent'
import type { MessageContextBindingDraft } from '@localixai/plugin-sdk/ui'
import type { MessageContextBinding } from '@/shared/api/contracts'

/**
 * The app's links as TEXT — `@file:src/a.ts`, `@session:…`, `@call:…`, `@terminal:…`,
 * `@resource:localix://resource/<provider>/…`, `@message:<sid>/<mid>`, or a bare `localix://…` URI —
 * turned into the same binding a drag of that thing carries.
 *
 * A surface that takes a link (the composer, a plugin board) must not learn the token grammar
 * itself: the grammar lives in the ref-kind registry (`@localixai/api/context-refs`), and a plugin
 * cannot import that package at all. So the parse is here, once, and reaches plugins through
 * `@localixai/kit/context-links`; a pasted `@session:…` then becomes the session a dragged session
 * row would have become, not a note that happens to contain its token.
 */

/** A parsed ref's binding target — one conversion for the send path and for a pasted link. */
export function contextTargetFromRef(
  ref: ParsedContextRef,
  label?: string,
): MessageContextBinding['target'] {
  const wire = toWireRef(ref)
  const attributes = Object.fromEntries(
    Object.entries(wire).filter(
      ([key, value]) =>
        key !== 'raw' && key !== 'kind' && key !== 'uri' && key !== 'label' && value !== undefined,
    ),
  ) as Record<string, string | number | boolean>
  return {
    kind: wire.kind,
    token: wire.raw,
    label: label ?? wire.label ?? wire.raw,
    ...(wire.uri ? { uri: wire.uri } : {}),
    ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
  }
}

/**
 * A ref shown in the chat (a sent pill, a composer chip) as the link a drag of it carries: the
 * canonical envelope it was rebuilt from when it has one, so a plugin resource keeps its own
 * attributes, else the grammar's target.
 */
export function linkFromRef(
  ref: ParsedContextRef & { messageBinding?: { target: MessageContextBinding['target'] } },
): MessageContextBindingDraft {
  const target = ref.messageBinding?.target ?? contextTargetFromRef(ref, ref.label ?? refLabel(ref))
  return {
    kind: 'context',
    source: 'drag',
    target: target as MessageContextBindingDraft['target'],
  }
}

/**
 * A stored attachment (a pasted screenshot, an uploaded file) as a link: the `file` binding the
 * host already previews and opens by `mediaId` (`binding-presentation.ts`). An attachment held
 * only inline, with no stored bytes to point at, has no link.
 */
export function linkFromAttachment(
  attachment: MessageAttachment,
): MessageContextBindingDraft | null {
  if (!('mediaId' in attachment) || !attachment.mediaId) return null
  const name = 'name' in attachment && attachment.name ? attachment.name : attachment.mediaId
  return {
    kind: 'context',
    source: 'drag',
    target: {
      kind: 'file',
      token: '',
      label: name,
      attributes: {
        mediaId: attachment.mediaId,
        name,
        ...('mediaType' in attachment ? { type: attachment.mediaType } : {}),
      },
    },
  }
}

const LOCALIX_URI = /^localix:\/\/\S+$/u
/** Trailing punctuation a sentence puts after a link: not part of it. */
const TRAILING = /[.,;:!?)\]]+$/u

function refOfWord(word: string): ParsedContextRef | null {
  const bare = word.replace(TRAILING, '')
  if (LOCALIX_URI.test(bare)) return parseContextRefs(`@resource:${bare}`)[0] ?? null
  if (!bare.startsWith('@')) return null
  return parseContextRefs(bare)[0] ?? messageRefFromRaw(bare)
}

export interface TextLinks {
  links: MessageContextBindingDraft[]
  /** The text is nothing but links: a surface may take it as those things, not as prose. */
  onlyLinks: boolean
}

/** Every link in `text`, in order and once each, as the drafts a drag of each would carry. */
export function linksInText(text: string): TextLinks {
  const words = text.split(/\s+/u).filter(Boolean)
  const seen = new Set<string>()
  const links: MessageContextBindingDraft[] = []
  let prose = false
  for (const word of words) {
    const ref = refOfWord(word)
    if (!ref) {
      prose = true
      continue
    }
    if (seen.has(ref.raw)) continue
    seen.add(ref.raw)
    links.push({ kind: 'context', source: 'drag', target: bindingTarget(ref) })
  }
  return { links, onlyLinks: links.length > 0 && !prose }
}

/**
 * The grammar has a `folder` kind; the drag transport does not — a dragged folder is a `file`
 * binding whose path ends in `/` (the file tree's). A typed `@folder:` becomes that same binding,
 * so a surface meets one folder shape whichever way it arrived.
 */
function bindingTarget(ref: ParsedContextRef): MessageContextBindingDraft['target'] {
  const target = contextTargetFromRef(ref, refLabel(ref))
  if (ref.kind !== 'folder' || !ref.path) return target as MessageContextBindingDraft['target']
  const path = ref.path.endsWith('/') ? ref.path : `${ref.path}/`
  return { ...target, kind: 'file', attributes: { ...target.attributes, path } }
}
