import {
  resourceMessageBindingDraft,
  type MessageBindingDraft,
  type MessageBindingTargetKind,
} from './contrib'
import { setCompactDragImage } from './drag-image'

export { setCompactDragImage } from './drag-image'

/** Canonical drag transport for linking any resource/context into a message. */
export const MESSAGE_BINDING_MIME = 'application/x-localix-message-binding'

/**
 * Kind-advertising companion MIME. Drag payload data is protected during
 * dragover, while its type list remains readable for the composer hint.
 */
export const MESSAGE_BINDING_KIND_MIME_PREFIX = 'application/x-localix-message-binding-kind.'

export type MessageBindingDragPayload = Extract<MessageBindingDraft, { kind: 'context' }>
export type MessageBindingDragKind = MessageBindingTargetKind

/**
 * Serialized shape version. A desktop window can outlive the update that changed
 * this shape (the renderer is only reloaded when the user reopens it), so a drag
 * written by an older build and read by a newer one is an ordinary event, not a
 * theoretical one. An unrecognized version is dropped rather than coerced.
 */
export const MESSAGE_BINDING_DRAG_VERSION = 1

/**
 * Largest payload this transport will serialize, in UTF-8 BYTES.
 *
 * The bound has to sit ABOVE the largest payload the composer itself accepts or
 * hardening would silently eat legitimate drags: a `snippet` binding carries its
 * content inline in `target.attributes.content` and is clamped only much later,
 * at `SNIPPET_CONTENT_MAX` (100_000 chars, apps/api/src/features/chat/context-ref-kinds.ts),
 * which is ~300 KB once the text is not ASCII. Everything past that is a corrupt
 * or hostile payload, and rejecting it keeps the synchronous `JSON.parse` in a
 * drop handler off the frame budget. Nothing else bounds these bytes: the
 * server's `bindingsTotalBytes` guard counts only `resolution.contributions`.
 */
export const MESSAGE_BINDING_DRAG_MAX_BYTES = 512 * 1024

/** UTF-8 spends at least one and at most three bytes per UTF-16 code unit (a
 *  surrogate PAIR costs four, i.e. two per unit), so both bounds settle the
 *  common cases before we pay for an encoded copy. */
function exceedsDragByteCap(serialized: string): boolean {
  if (serialized.length > MESSAGE_BINDING_DRAG_MAX_BYTES) return true
  if (serialized.length * 3 <= MESSAGE_BINDING_DRAG_MAX_BYTES) return false
  return new TextEncoder().encode(serialized).byteLength > MESSAGE_BINDING_DRAG_MAX_BYTES
}

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
   * that already owns `text/plain` (the tab strip's reorder id, a board card's
   * id) — writing it here would clobber theirs. Pass it where dropping
   * outside Localix should still yield useful text.
   */
  readonly plainText?: string
}

export function setMessageBindingDrag(
  dataTransfer: DataTransfer,
  binding: MessageBindingDragPayload,
  options?: MessageBindingDragOptions,
): void {
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
  // Claim the effect only when the source has not chosen one already: a tab-strip
  // or board card drag arms this binding on top of its OWN 'move' reorder
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
  for (const type of types) {
    if (type.startsWith(MESSAGE_BINDING_KIND_MIME_PREFIX)) {
      const kind = type.slice(MESSAGE_BINDING_KIND_MIME_PREFIX.length)
      if (kind) return kind
    }
  }
  return types.includes(MESSAGE_BINDING_MIME) ? 'binding' : null
}

/** Composer dropzone pseudo-kind for native OS file uploads. */
export const OS_FILES_DRAG_KIND = 'files'

const DROP_HINTS: Record<MessageBindingTargetKind, string> = {
  file: 'Link file to message',
  session: 'Link session to message',
  project: 'Link project to message',
  message: 'Link message to message',
  terminal: 'Link terminal to message',
  call: 'Link tool call to message',
  resource: 'Link resource to message',
  snippet: 'Attach snippet to message',
}

export function composerDropHint(kind: string): string {
  if (kind === OS_FILES_DRAG_KIND) return 'Drop files to attach'
  const known = (DROP_HINTS as Record<string, string>)[kind]
  if (known) return known
  if (kind !== 'binding' && /^[a-z][a-z-]*$/.test(kind))
    return `Link ${kind.replace(/-/g, ' ')} to message`
  return 'Link to message'
}

/**
 * Limits below mirror `normalizePublishedMessageContext`
 * (packages/plugin-sdk/src/ui/contrib.ts) — the same binding shape arriving over a
 * different transport, so the two must not drift. That helper cannot be called
 * from here: it accepts only the two plugin-publishable target kinds (`resource`,
 * `snippet`), deliberately, so a sandboxed iframe cannot impersonate a host
 * capability — while a drag legitimately carries every core kind from in-process
 * producers.
 */
const TOKEN_MAX = 4096
const LABEL_MAX = 512
const URI_MAX = 4096
const ATTRIBUTES_MAX = 32
const ATTRIBUTE_KEY_MAX = 64
/** The shape the API accepts for `MessageContextBinding.plugin`. */
const PLUGIN_NAME = /^[a-z0-9][a-z0-9._-]{0,127}$/iu

const BINDING_SOURCES: Readonly<Record<MessageBindingDragPayload['source'], true>> = {
  drag: true,
  'active-tab': true,
  plugin: true,
}

function isBindingSource(value: unknown): value is MessageBindingDragPayload['source'] {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(BINDING_SOURCES, value)
}

/** The hint table is already the exhaustive `Record<MessageBindingTargetKind, …>`
 *  of this module, so deriving the accept-set from it means a kind added to the
 *  SDK union cannot slip through unvalidated (or hintless). */
function isBindingTargetKind(value: unknown): value is MessageBindingTargetKind {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(DROP_HINTS, value)
}

type BindingAttributes = NonNullable<MessageBindingDragPayload['target']['attributes']>

/** `null` = the bag is malformed and the whole payload must be rejected;
 *  `undefined` = there was no bag to begin with. */
function normalizeAttributes(value: unknown): BindingAttributes | undefined | null {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const entries = Object.entries(value)
  if (entries.length > ATTRIBUTES_MAX) return null
  const attributes: BindingAttributes = {}
  for (const [key, attribute] of entries) {
    // '__proto__' would be swallowed by the object literal's setter rather than
    // stored, so a binding written with it would read back short a field.
    if (key.length < 1 || key.length > ATTRIBUTE_KEY_MAX || key === '__proto__') return null
    if (typeof attribute === 'string' || typeof attribute === 'boolean') attributes[key] = attribute
    else if (typeof attribute === 'number' && Number.isFinite(attribute))
      attributes[key] = attribute
    else return null
  }
  return attributes
}

/**
 * Validate an untrusted transport envelope and REBUILD the draft from known
 * fields, so an unexpected extra field can never ride along into a durable
 * message binding.
 */
function normalizeDragEnvelope(value: unknown): MessageBindingDragPayload | null {
  if (typeof value !== 'object' || value === null) return null
  const envelope = value as Record<string, unknown>
  if (envelope.version !== MESSAGE_BINDING_DRAG_VERSION || envelope.kind !== 'context') return null
  if (!isBindingSource(envelope.source)) return null
  if (typeof envelope.target !== 'object' || envelope.target === null) return null
  const target = envelope.target as Record<string, unknown>
  if (!isBindingTargetKind(target.kind)) return null
  // An EMPTY token is valid: `message` and `snippet` bindings are structural-only
  // and carry their reference in the attributes, not in a typeable @-token. An
  // empty label is likewise kept — the producer is in-process host code and an
  // untitled tab is a real case, so a blank display string is no reason to drop
  // a link. (This is where the drag path deliberately parts with contrib.ts,
  // which rejects both because there the producer is an untrusted plugin.)
  if (typeof target.token !== 'string' || target.token.length > TOKEN_MAX) return null
  if (typeof target.label !== 'string' || target.label.length > LABEL_MAX) return null
  const uri = target.uri
  if (uri !== undefined && (typeof uri !== 'string' || uri.length < 1 || uri.length > URI_MAX))
    return null
  if (target.kind === 'resource' && typeof uri !== 'string') return null
  const attributes = normalizeAttributes(target.attributes)
  if (attributes === null) return null
  // A contentless snippet resolves to an empty ref downstream, so it is a broken
  // payload rather than a link with less information.
  if (target.kind === 'snippet' && typeof attributes?.content !== 'string') return null
  // The owning plugin of a dragged tab — what brings its tools to the turn. Kept only when it is
  // a plugin name; anything else is dropped rather than failing the drop.
  const plugin =
    typeof envelope.plugin === 'string' && PLUGIN_NAME.test(envelope.plugin)
      ? envelope.plugin
      : undefined
  return {
    kind: 'context',
    source: envelope.source,
    ...(plugin ? { plugin } : {}),
    target: {
      kind: target.kind,
      token: target.token,
      label: target.label,
      ...(typeof uri === 'string' ? { uri } : {}),
      ...(attributes ? { attributes } : {}),
    },
  }
}

/** Read, bound and structurally validate the canonical binding draft from a drop. */
export function readMessageBindingDrag(
  dataTransfer: DataTransfer,
): MessageBindingDragPayload | null {
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
