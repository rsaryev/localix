/**
 * The rows a terminal command printed, read as spans a screen can draw: each line is a row, and
 * within it the SGR colors and styles (`ESC [ … m`) and OSC 8 hyperlinks become properties of the
 * text they cover. Nothing here builds markup — a caller draws each span as an element, so the
 * text stays text. Colors are named as a terminal names them (`red`, `redBright`) or as `#rrggbb`;
 * mapping them onto the app's own palette is the caller's, so a script's hue is never a raw one.
 * Escape sequences that are not drawn (cursor moves, titles, unknown SGR) leave no trace.
 */

export interface AnsiSpan {
  text: string
  fg?: string
  bg?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  inverse?: boolean
  /** Only an http, https or mailto destination. */
  href?: string
}

export type AnsiRow = AnsiSpan[]

const NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'] as const

const hex = (value: number) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0')
const rgbHex = (r: number, g: number, b: number) => `#${hex(r)}${hex(g)}${hex(b)}`

/** The color a 256-color index names. */
function indexed(index: number): string | undefined {
  if (!Number.isInteger(index) || index < 0 || index > 255) return undefined
  if (index < 8) return NAMES[index]
  if (index < 16) return `${NAMES[index - 8]}Bright`
  if (index < 232) {
    const level = (n: number) => (n === 0 ? 0 : 55 + n * 40)
    const n = index - 16
    return rgbHex(level(Math.floor(n / 36)), level(Math.floor(n / 6) % 6), level(n % 6))
  }
  const grey = 8 + (index - 232) * 10
  return rgbHex(grey, grey, grey)
}

type Style = Omit<AnsiSpan, 'text' | 'href'>

/** Apply one SGR parameter list to `style`. */
function applySgr(style: Style, params: number[]): Style {
  const next: Style = { ...style }
  const set = <K extends keyof Style>(key: K, value: Style[K] | undefined) => {
    if (value === undefined || value === false) delete next[key]
    else next[key] = value
  }
  for (let at = 0; at < params.length; at++) {
    const code = params[at] ?? 0
    if (code === 0) for (const key of Object.keys(next)) delete next[key as keyof Style]
    else if (code === 1) set('bold', true)
    else if (code === 2) set('dim', true)
    else if (code === 3) set('italic', true)
    else if (code === 4) set('underline', true)
    else if (code === 7) set('inverse', true)
    else if (code === 9) set('strike', true)
    else if (code === 22) {
      set('bold', false)
      set('dim', false)
    } else if (code === 23) set('italic', false)
    else if (code === 24) set('underline', false)
    else if (code === 27) set('inverse', false)
    else if (code === 29) set('strike', false)
    else if (code >= 30 && code <= 37) set('fg', NAMES[code - 30])
    else if (code >= 90 && code <= 97) set('fg', `${NAMES[code - 90]}Bright`)
    else if (code >= 40 && code <= 47) set('bg', NAMES[code - 40])
    else if (code >= 100 && code <= 107) set('bg', `${NAMES[code - 100]}Bright`)
    else if (code === 39) set('fg', undefined)
    else if (code === 49) set('bg', undefined)
    else if (code === 38 || code === 48) {
      const key = code === 38 ? 'fg' : 'bg'
      const mode = params[at + 1]
      if (mode === 5) {
        set(key, indexed(params[at + 2] ?? -1))
        at += 2
      } else if (mode === 2) {
        const [r, g, b] = [params[at + 2], params[at + 3], params[at + 4]]
        if ([r, g, b].every((n) => n !== undefined && n >= 0 && n <= 255))
          set(key, rgbHex(r!, g!, b!))
        at += 4
      } else break
    }
  }
  return next
}

function linkOf(uri: string): string | undefined {
  try {
    const { protocol } = new URL(uri)
    return protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:' ? uri : undefined
  } catch {
    return undefined
  }
}

// oxlint-disable no-control-regex -- the escape sequences are what this reads
const TOKEN =
  /\u001b\[([0-9;]*)m|\u001b\]8;[^;\u001b\u0007]*;([^\u001b\u0007]*)(?:\u001b\\|\u0007)|\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|[\s\S]?)|([^\u001b]+)/g
// oxlint-enable no-control-regex

function parseRow(line: string): AnsiRow {
  const spans: AnsiRow = []
  let style: Style = {}
  let href: string | undefined
  for (const match of line.matchAll(TOKEN)) {
    const [, sgr, uri, text] = match
    if (text !== undefined) spans.push({ text, ...style, ...(href ? { href } : {}) })
    else if (sgr !== undefined)
      style = applySgr(style, sgr === '' ? [0] : sgr.split(';').map((part) => Number(part || 0)))
    else if (uri !== undefined) href = uri === '' ? undefined : linkOf(uri)
  }
  return spans
}

/** The rows of `text`: one per line, each starting plain. */
export function parseAnsiRows(text: string): AnsiRow[] {
  return text.split('\n').map(parseRow)
}

export const plainAnsiText = (row: AnsiRow): string => row.map((span) => span.text).join('')
