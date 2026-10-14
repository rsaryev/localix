import { resourceMessageBindingDraft, type MessageBindingTargetKind } from './contrib'
import { setCompactDragImage } from './drag-image'
import {
  MESSAGE_BINDING_DRAG_VERSION,
  WORKSPACE_TAB_DRAG_MIME,
  MESSAGE_BINDING_MIME,
  MESSAGE_BINDING_KIND_MIME_PREFIX,
  type MessageBindingDragPayload,
} from './message-binding-drag-contracts'
import { exceedsDragByteCap, normalizeDragEnvelope } from './message-binding-drag-envelope'

export {
  MESSAGE_BINDING_DRAG_VERSION,
  MESSAGE_BINDING_DRAG_MAX_BYTES,
  WORKSPACE_TAB_DRAG_MIME,
  MESSAGE_BINDING_MIME,
  MESSAGE_BINDING_KIND_MIME_PREFIX,
  type MessageBindingDragPayload,
  type MessageBindingDragKind,
} from './message-binding-drag-contracts'
export { composerDropHint, OS_FILES_DRAG_KIND } from './message-binding-drop-hints'

export { setCompactDragImage, setElementDragImage, setNativeWindowDragImage } from './drag-image'

const AGENT_LINK_DRAG_ATTRIBUTE = 'data-localix-agent-link-drag'
let removeAgentLinkDragListeners: (() => void) | null = null

/**
 * The binding of the drag currently in flight, kept in-process because some
 * WebView/WebKit builds hand a drop handler an EMPTY `getData` for a custom MIME
 * while still listing the type — the drop would otherwise be silently lost. Only
 * consulted when the type IS advertised, so a stale value cannot attach itself
 * to an unrelated drag.
 */
let activeDragPayload: MessageBindingDragPayload | null = null

/** Remove the project-wide "an agent-link drag is in flight" availability cue. */
export function clearMessageBindingDragAvailability(): void {
  if (typeof document !== 'undefined') {
    document.documentElement?.removeAttribute(AGENT_LINK_DRAG_ATTRIBUTE)
  }
  const removeListeners = removeAgentLinkDragListeners
  removeAgentLinkDragListeners = null
  removeListeners?.()
}

/**
 * Reveal every compatible agent input as soon as a canonical link drag starts and
 * hold the payload for the length of the gesture. Hover remains local to each input
 * and upgrades this quiet availability cue to the stronger active-drop border.
 */
function beginMessageBindingDrag(binding: MessageBindingDragPayload): void {
  clearMessageBindingDragAvailability()
  activeDragPayload = binding
  if (typeof document === 'undefined' || !document.documentElement) return
  document.documentElement.setAttribute(AGENT_LINK_DRAG_ATTRIBUTE, binding.target.kind)
  if (typeof window === 'undefined') return

  const finish = () => {
    clearMessageBindingDragAvailability()
    // These listeners are on the CAPTURE phase so the cue dies the instant the
    // gesture ends — but the drop target's own bubble-phase handler has not run
    // yet, and dropping the fallback here would delete it before the composer
    // could read it. A macrotask lands after the whole dispatch. The identity
    // check keeps a late timer from clearing the NEXT drag's payload.
    setTimeout(() => {
      if (activeDragPayload === binding) activeDragPayload = null
    }, 0)
  }
  // Capture the view instead of re-reading the global inside the teardown closure. The guard
  // above only proves `window` exists when the drag is ARMED; the closure runs later, from
  // `clearMessageBindingDragAvailability`, and a global that has gone away by then threw
  // ReferenceError from a removeEventListener that was only ever meant to detach the two
  // listeners added right here — on this exact object.
  const view = window
  view.addEventListener('dragend', finish, true)
  view.addEventListener('drop', finish, true)
  removeAgentLinkDragListeners = () => {
    view.removeEventListener('dragend', finish, true)
    view.removeEventListener('drop', finish, true)
  }
}

/**
 * Terminal ids are `randomUUID()`, so eight hex characters carry 32 bits — a
 * collision needs tens of thousands of concurrently open terminals. The prefix is
 * also the shared vocabulary rather than a local shortcut: `@terminal:` resolves
 * "id or unique prefix" server-side, the @-mention autocomplete inserts the same
 * eight characters, and the ref label renders them. Lengthening it only here
 * would fork the token that ambient tab links dedupe against.
 */
const TERMINAL_TOKEN_ID_CHARS = 8

function tokenFor(kind: MessageBindingTargetKind, id: string): string {
  switch (kind) {
    case 'file':
      return `@${id}`
    case 'session':
      return `@session:${id}`
    case 'project':
      return `@project:${id}`
    case 'terminal':
      return `@terminal:${id.slice(0, TERMINAL_TOKEN_ID_CHARS)}`
    case 'call':
      return `@call:${id}`
    case 'resource':
      return `@resource:${id}`
    case 'message':
    case 'snippet':
      return ''
  }
}

/** Build the same architecture-neutral binding draft used by plugin UI contributions. */
export function createMessageBindingDraft(
  kind: MessageBindingTargetKind,
  id: string,
  label?: string,
  options?: { content?: string; language?: string; source?: MessageBindingDragPayload['source'] },
): MessageBindingDragPayload {
  if (kind === 'resource') {
    return resourceMessageBindingDraft({ uri: id, label: label ?? id }, options?.source ?? 'drag')
  }
  const attributes: Record<string, string> = {}
  switch (kind) {
    case 'file':
      attributes.path = id
      break
    case 'session':
      attributes.sessionId = id
      break
    case 'project':
      attributes.projectId = id
      break
    case 'terminal':
      attributes.terminalId = id
      break
    case 'call':
      attributes.toolCallId = id
      break
    case 'message': {
      const slash = id.indexOf('/')
      if (slash >= 0) {
        attributes.sessionId = id.slice(0, slash)
        attributes.messageId = id.slice(slash + 1)
      }
      break
    }
    case 'snippet':
      if (options?.content) attributes.content = options.content
      if (options?.language) attributes.language = options.language
      break
  }
  return {
    kind: 'context',
    source: options?.source ?? 'drag',
    target: {
      kind,
      token: tokenFor(kind, id),
      label: label ?? id,
      ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
    },
  }
}

/** One message-link factory shared by drag and explicit Link actions. */
export function messageBindingDraft(
  sessionId: string,
  messageId: string,
  content: string,
): MessageBindingDragPayload {
  const preview = content.replace(/\s+/g, ' ').trim().slice(0, 60)
  return createMessageBindingDraft('message', `${sessionId}/${messageId}`, preview || 'message')
}

export interface MessageBindingDragOptions {
  /** Label for the compact drag ghost. Defaults to the binding's own label. */
  readonly previewLabel?: string
  /**
   * Optional `text/plain` companion, written only when asked for.
   *
   * Omitting it is the deliberate default: `text/plain` makes a terminal or any
   * native text target paste the raw token instead of letting our own drop layer
   * turn it into a link, and several producers arm this binding ON TOP of a drag
   * that already owns a payload (a board card's
   * id) — writing it here would introduce an OS export. Pass it where dropping
   * outside Localix should still yield useful text.
   */
  readonly plainText?: string
}

export function setMessageBindingDrag(
  dataTransfer: DataTransfer,
  binding: MessageBindingDragPayload,
  options?: MessageBindingDragOptions,
): void {
  if (Array.from(dataTransfer.types).includes(WORKSPACE_TAB_DRAG_MIME)) {
    clearMessageBindingDragAvailability()
    activeDragPayload = null
    return
  }
  const serialized = JSON.stringify({ ...binding, version: MESSAGE_BINDING_DRAG_VERSION })
  if (exceedsDragByteCap(serialized)) {
    // Arm nothing: an oversized payload cannot be read back, and advertising the
    // MIME anyway would light up every drop target for a link we cannot deliver.
    activeDragPayload = null
    return
  }
  dataTransfer.setData(MESSAGE_BINDING_MIME, serialized)
  dataTransfer.setData(
    `${MESSAGE_BINDING_KIND_MIME_PREFIX}${binding.target.kind}`,
    binding.target.kind,
  )
  if (options?.plainText) dataTransfer.setData('text/plain', options.plainText)
  // Claim the effect only when the source has not chosen one already: a board
  // card drag arms this binding on top of its OWN 'move' reorder
  // gesture, and forcing 'copy' there makes the browser veto the reorder drop.
  const effect = dataTransfer.effectAllowed
  if (!effect || effect === 'uninitialized' || effect === 'none') {
    dataTransfer.effectAllowed = 'copy'
  }
  setCompactDragImage(dataTransfer, options?.previewLabel ?? binding.target.label)
  beginMessageBindingDrag(binding)
}

/** Binding kind advertised by a drag, or null when it is not message-linkable. */
export function messageBindingDragKind(types: readonly string[]): string | null {
  if (types.includes(WORKSPACE_TAB_DRAG_MIME)) return null
  for (const type of types) {
    if (type.startsWith(MESSAGE_BINDING_KIND_MIME_PREFIX)) {
      const kind = type.slice(MESSAGE_BINDING_KIND_MIME_PREFIX.length)
      if (kind) return kind
    }
  }
  return types.includes(MESSAGE_BINDING_MIME) ? 'binding' : null
}

/** Read, bound and structurally validate the canonical binding draft from a drop. */
export function readMessageBindingDrag(
  dataTransfer: DataTransfer,
): MessageBindingDragPayload | null {
  if (Array.from(dataTransfer.types).includes(WORKSPACE_TAB_DRAG_MIME)) return null
  const raw = dataTransfer.getData(MESSAGE_BINDING_MIME)
  if (!raw) {
    return Array.from(dataTransfer.types).includes(MESSAGE_BINDING_MIME) ? activeDragPayload : null
  }
  if (exceedsDragByteCap(raw)) return null
  try {
    return normalizeDragEnvelope(JSON.parse(raw))
  } catch {
    return null
  }
}

export function promptHasToken(prompt: string, token: string): boolean {
  if (!token) return false
  let from = 0
  for (;;) {
    const at = prompt.indexOf(token, from)
    if (at === -1) return false
    const beforeOk = at === 0 || /\s/.test(prompt[at - 1])
    const after = prompt[at + token.length]
    const afterOk = after === undefined || /\s/.test(after)
    if (beforeOk && afterOk) return true
    from = at + 1
  }
}

export function messageBindingToken(binding: MessageBindingDragPayload): string {
  return binding.target.token
}
