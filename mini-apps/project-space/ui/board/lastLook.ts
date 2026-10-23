import { STYLE_PROPS } from './commands'

/**
 * The look a person last gave each kind of element, which the next one placed takes — recolour
 * a sticky note green and the next note is green, as on every whiteboard, until the app reloads.
 * It is the person's habit, not the board's content: nothing is written, and only the style props
 * (`STYLE_PROPS`) are remembered, never a text or a kind.
 */
const looks = new Map<string, Record<string, unknown>>()

export function rememberLook(type: string, props: Record<string, unknown>) {
  const look = { ...looks.get(type) }
  for (const prop of STYLE_PROPS) {
    if (!(prop in props)) continue
    if (props[prop] === null || props[prop] === undefined) delete look[prop]
    else look[prop] = props[prop]
  }
  looks.set(type, look)
}

export const lastLook = (type: string): Record<string, unknown> => looks.get(type) ?? {}

/** For tests: start from a person with no habits. */
export const forgetLooks = () => {
  looks.clear()
  line = {}
}

/** How a line runs and looks: what a connector's bar sets, and what the next connector takes. */
const LINE_PROPS = ['route', 'start', 'end', 'stroke', 'weight', 'color'] as const
let line: Record<string, unknown> = {}

export function rememberLine(changes: Record<string, unknown>) {
  const next = { ...line }
  for (const prop of LINE_PROPS) {
    if (!(prop in changes)) continue
    if (changes[prop] === null || changes[prop] === undefined) delete next[prop]
    else next[prop] = changes[prop]
  }
  line = next
}

/** The style the next connector a person draws takes; empty until one is restyled. */
export const lastLine = (): Record<string, unknown> => ({ ...line })
