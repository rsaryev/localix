import type { MessageBindingDraft, MessageBindingTargetKind } from './contrib'

/** Canonical drag transport for linking any resource/context into a message. */
/** Tabs exclusively reorder or move between workspaces; they are never message links. */
export const WORKSPACE_TAB_DRAG_MIME = 'application/x-localix-tab'

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
 * at `SNIPPET_CONTENT_MAX` (100_000 chars, apps/api/src/contracts/context-ref-kinds.ts),
 * which is ~300 KB once the text is not ASCII. Everything past that is a corrupt
 * or hostile payload, and rejecting it keeps the synchronous `JSON.parse` in a
 * drop handler off the frame budget. Nothing else bounds these bytes: the
 * server's `bindingsTotalBytes` guard counts only `resolution.contributions`.
 */
export const MESSAGE_BINDING_DRAG_MAX_BYTES = 512 * 1024
