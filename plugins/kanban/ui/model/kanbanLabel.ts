import { KANBAN_LABEL_MAX_LENGTH } from '../../shared/contracts'

/**
 * One owner for how a board LABEL looks.
 *
 * Labels have no table, no ids and no stored colour — the name is the whole label. So the colour
 * has to be a function of the name, or the same label would look different on the card, in the
 * detail panel and in the filter menu, and different again after a reload.
 *
 * A hash picks from a fixed palette rather than generating a hue: the palette is drawn from the
 * app's own tokens, so every chip stays legible in both themes and none of them can collide with
 * the status colours, which carry meaning on the same card. Two labels can share a colour — with a
 * handful of labels on a board that reads as coincidence, whereas an arbitrary generated hue reads
 * as a bug.
 */

/** Tailwind token pairs (text + surface + border), safe on light and dark. */
const LABEL_TONES = [
  'text-status-info bg-status-info/10 border-status-info/25',
  'text-status-success bg-status-success/10 border-status-success/25',
  'text-status-warning bg-status-warning/10 border-status-warning/25',
  'text-status-error bg-status-error/10 border-status-error/25',
  'text-foreground bg-foreground/10 border-foreground/20',
] as const

/**
 * FNV-1a, so the same name lands on the same tone in every surface and every session.
 * Deliberately not `Math.random` or an index: a chip's colour is part of how a user recognizes a
 * label at a glance.
 */
function hashName(name: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < name.length; i += 1) {
    hash ^= name.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function kanbanLabelTone(name: string): string {
  return LABEL_TONES[hashName(name) % LABEL_TONES.length]!
}

/**
 * Normalize a typed label the way the contract's `kanbanLabelSchema` does, so the view dedupes and
 * matches on exactly what the server will store — otherwise `Flaky` would look like a new label
 * until the round-trip came back as `flaky`.
 */
export function normalizeKanbanLabel(raw: string): string {
  return raw.trim().toLowerCase().slice(0, KANBAN_LABEL_MAX_LENGTH)
}
