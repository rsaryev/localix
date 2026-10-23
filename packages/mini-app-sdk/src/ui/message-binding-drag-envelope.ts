import type { MessageBindingTargetKind } from './contrib'
import {
  MESSAGE_BINDING_DRAG_VERSION,
  MESSAGE_BINDING_DRAG_MAX_BYTES,
  type MessageBindingDragPayload,
} from './message-binding-drag-contracts'
import { DROP_HINTS } from './message-binding-drop-hints'

/** UTF-8 spends at least one and at most three bytes per UTF-16 code unit (a
 *  surrogate PAIR costs four, i.e. two per unit), so both bounds settle the
 *  common cases before we pay for an encoded copy. */
export function exceedsDragByteCap(serialized: string): boolean {
  if (serialized.length > MESSAGE_BINDING_DRAG_MAX_BYTES) return true
  if (serialized.length * 3 <= MESSAGE_BINDING_DRAG_MAX_BYTES) return false
  return new TextEncoder().encode(serialized).byteLength > MESSAGE_BINDING_DRAG_MAX_BYTES
}

/**
 * Limits below mirror `normalizePublishedMessageContext`
 * (packages/mini-app-sdk/src/ui/contrib.ts) — the same binding shape arriving over a
 * different transport, so the two must not drift. That helper cannot be called
 * from here: it accepts only the two mini-app-publishable target kinds (`resource`,
 * `snippet`), deliberately, so a sandboxed iframe cannot impersonate a host
 * capability — while a drag legitimately carries every core kind from in-process
 * producers.
 */
const TOKEN_MAX = 4096
const LABEL_MAX = 512
const URI_MAX = 4096
const ATTRIBUTES_MAX = 32
const ATTRIBUTE_KEY_MAX = 64
/** The shape the API accepts for `MessageContextBinding.miniApp`. */
const MINI_APP_NAME = /^[a-z0-9][a-z0-9._-]{0,127}$/iu

const BINDING_SOURCES: Readonly<Record<MessageBindingDragPayload['source'], true>> = {
  drag: true,
  'active-tab': true,
  'mini-app': true,
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
export function normalizeDragEnvelope(value: unknown): MessageBindingDragPayload | null {
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
  // which rejects both because there the producer is an untrusted mini app.)
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
  // The owning mini app of a dragged tab — what brings its tools to the turn. Kept only when it is
  // a mini app name; anything else is dropped rather than failing the drop.
  const miniApp =
    typeof envelope.miniApp === 'string' && MINI_APP_NAME.test(envelope.miniApp)
      ? envelope.miniApp
      : undefined
  return {
    kind: 'context',
    source: envelope.source,
    ...(miniApp ? { miniApp } : {}),
    target: {
      kind: target.kind,
      token: target.token,
      label: target.label,
      ...(typeof uri === 'string' ? { uri } : {}),
      ...(attributes ? { attributes } : {}),
    },
  }
}
