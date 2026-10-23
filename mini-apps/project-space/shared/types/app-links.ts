import { z } from 'zod'
import type { ElementTypeSpec } from '../registry/contract'

/**
 * A link to anything the app can link — the same thing a person can drag into the chat, dragged
 * onto the board instead: a chat session, one message, a tool call, a terminal, a project, or a
 * provider's resource (`localix://resource/<provider>/…`: a database table, a git commit, a vault
 * item, a mini app's own record). Files, folders and snippets already have their own types; every
 * OTHER link is this one.
 *
 * The element stores the link itself — the binding target every drag in the app carries (kind,
 * `@`-token, label, URI, attributes) — never a copy of what it points at: the card is drawn live
 * by the host (`ContextBindingPreview`), so a session shows its state now and a call the chat's own
 * card for it. `label` is what the link was called when it was made, which is what the card falls
 * back to on a machine where the target does not exist.
 *
 * `kind` is not a closed list: a kind a newer build adds keeps its props and draws as a plain
 * link, rather than failing the whole element.
 */
const primitive = z.union([z.string(), z.number(), z.boolean()])

const refProps = z.object({
  kind: z.string().regex(/^[a-z][a-z-]*$/u),
  token: z.string().default(''),
  label: z.string().default(''),
  uri: z.string().min(1).optional(),
  attributes: z.record(z.string(), primitive).optional(),
  /**
   * The mini app whose tab the link came from, so a chat it is dragged back into gets its tools.
   */
  miniApp: z.string().optional(),
})

export type RefProps = z.infer<typeof refProps>

/**
 * A card sized for what it shows: a session is a few lines, a message a paragraph, a tool call the
 * transcript's card with its input and output. A person's resize is kept.
 */
const SIZES: Record<string, { w: number; h: number }> = {
  session: { w: 320, h: 132 },
  message: { w: 340, h: 200 },
  call: { w: 380, h: 220 },
  project: { w: 300, h: 112 },
}
const DEFAULT = { w: 300, h: 84 }

export const refType: ElementTypeSpec<RefProps> = {
  type: 'ref',
  version: 1,
  label: 'App link',
  description:
    'A live link to anything in the app — a chat session, a message, a tool call, a terminal, a project, or a provider resource — drawn as the app draws it (a call is its transcript card). props: kind (session, message, call, terminal, project, resource), token (the @-token the chat uses: @session:<id or LOCALIX-n>, @message:<sessionId>/<messageId>, @call:<toolCallId>, @terminal:<id>, @project:<id>, @resource:localix://resource/<provider>/…), label; the token alone is enough. For a call from another session add attributes.sessionId. Files, folders and code have their own types.',
  props: refProps,
  size: DEFAULT,
  minSize: { w: 180, h: 48 },
  measure: (props) => SIZES[props.kind] ?? DEFAULT,
  text: (props) => [props.label, props.token || props.uri].filter(Boolean).join(' '),
}
