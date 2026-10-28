/**
 * `read` on a Jupyter notebook: the cells as text, not the JSON envelope.
 *
 * A raw `.ipynb` is mostly escaping, metadata and base64 output — a 40-line notebook with one
 * plot costs tens of kilobytes of context and hides its own code. The rendered view keeps what
 * a reader needs: each cell's index, type and source, and its text outputs. Rich outputs are
 * NAMED by MIME type instead of dumped; the first few PNG/JPEG outputs ride along as image parts
 * when the model can see them. A line range still reads the raw JSON, which is what `edit`
 * changes.
 */
import type { ImageContent } from '@localixai/agent'

/** Image outputs attached per read — enough to see the plots, bounded against a gallery. */
export const MAX_NOTEBOOK_IMAGES = 3
/** Characters kept per text output; a training log can print megabytes. */
const MAX_OUTPUT_CHARS = 4_000

export function isNotebookPath(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('.ipynb')
}

export interface RenderedNotebook {
  text: string
  images: ImageContent[]
}

type Json = Record<string, unknown>

const asRecord = (v: unknown): Json | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : undefined

/** nbformat stores multi-line strings as either a string or an array of lines. */
const joinText = (v: unknown): string =>
  Array.isArray(v)
    ? v.filter((s) => typeof s === 'string').join('')
    : typeof v === 'string'
      ? v
      : ''

const clip = (text: string): string =>
  text.length > MAX_OUTPUT_CHARS
    ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n… [${text.length - MAX_OUTPUT_CHARS} more characters]`
    : text

// oxlint-disable-next-line no-control-regex -- ANSI colour codes in tracebacks are noise to a model
const stripAnsi = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, '')

const IMAGE_MIMES = ['image/png', 'image/jpeg'] as const

/** A notebook field as text: a string as is, nothing as `fallback`, anything else as JSON. */
function scalarText(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value
  return value === undefined || value === null ? fallback : JSON.stringify(value)
}

function renderOutput(output: Json, images: ImageContent[], attachImages: boolean): string {
  const type = output.output_type
  if (type === 'stream') {
    return `[${typeof output.name === 'string' ? output.name : 'stream'}]\n${clip(joinText(output.text))}`
  }
  if (type === 'error') {
    const trace = Array.isArray(output.traceback)
      ? stripAnsi(joinText(output.traceback.map((l) => `${l}\n`)))
      : ''
    return `[error] ${scalarText(output.ename, 'Error')}: ${scalarText(output.evalue, '')}${trace ? `\n${clip(trace)}` : ''}`
  }
  const data = asRecord(output.data)
  if (!data) return ''
  const parts: string[] = []
  for (const mime of Object.keys(data)) {
    if (mime === 'text/plain') continue
    const image = IMAGE_MIMES.find((m) => m === mime)
    if (image && attachImages && images.length < MAX_NOTEBOOK_IMAGES) {
      images.push({
        type: 'image',
        mediaType: image,
        data: joinText(data[mime]).replace(/\s+/g, ''),
      })
      parts.push(`[${mime} output: attached as image ${images.length}]`)
    } else {
      parts.push(`[${mime} output not shown]`)
    }
  }
  const plain = joinText(data['text/plain'])
  if (plain) parts.unshift(clip(plain))
  return parts.join('\n')
}

/**
 * Render notebook JSON as text, or undefined when it is not a notebook this can read (the caller
 * then reads the file as plain text).
 */
export function renderNotebook(raw: string, attachImages: boolean): RenderedNotebook | undefined {
  let nb: Json | undefined
  try {
    nb = asRecord(JSON.parse(raw))
  } catch {
    return undefined
  }
  // nbformat 4 keeps `cells` at the top; nbformat 3 nests them in the first worksheet.
  const worksheet = Array.isArray(nb?.worksheets) ? asRecord(nb.worksheets[0]) : undefined
  const cells = Array.isArray(nb?.cells) ? nb.cells : worksheet?.cells
  if (!Array.isArray(cells)) return undefined
  const meta = asRecord(nb?.metadata)
  const language =
    asRecord(meta?.kernelspec)?.language ?? asRecord(meta?.language_info)?.name ?? 'python'
  const lang = typeof language === 'string' ? language : 'python'

  const images: ImageContent[] = []
  const blocks = cells.map((rawCell, index) => {
    const cell = asRecord(rawCell) ?? {}
    const kind = typeof cell.cell_type === 'string' ? cell.cell_type : 'unknown'
    const count = typeof cell.execution_count === 'number' ? ` · run ${cell.execution_count}` : ''
    const source = joinText(cell.source ?? cell.input)
    const lines = [`## Cell ${index} [${kind}${count}]`]
    lines.push(kind === 'code' ? `\`\`\`${lang}\n${source}\n\`\`\`` : source)
    const outputs = (Array.isArray(cell.outputs) ? cell.outputs : [])
      .map((o) => renderOutput(asRecord(o) ?? {}, images, attachImages))
      .filter(Boolean)
    if (outputs.length > 0) lines.push(`Output:\n${outputs.join('\n')}`)
    return lines.join('\n')
  })
  const header = `[Jupyter notebook · ${cells.length} cell${cells.length === 1 ? '' : 's'} · ${lang}] Rendered view — read with start_line/end_line for the raw JSON before editing it.`
  return { text: [header, ...blocks].join('\n\n'), images }
}
