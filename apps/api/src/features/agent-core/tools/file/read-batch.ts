/**
 * `read` with several files (`reads`): one call instead of a round-trip per file.
 *
 * Each item runs through the same single-file reader, concurrently and bounded, against STAGED
 * session stores (`read-stores.ts`). The answer is then assembled in the order asked, inside three
 * budgets — item count, model-facing text and attached images. An item past a budget is not
 * delivered, its staged bookkeeping is discarded, and the model is told by name to read it
 * separately. One item's failure is that item's section, never the call's error: the call fails
 * only when every item did.
 */
import type { ImageContent, TextContent } from '@localixai/agent'
import { formatSize } from '@localixai/agent'
import type { AgentSource } from '@localixai/agent/agents'
import { mapLimit } from '../../../../lib/map-limit'
import type { ReadItemDetails, ReadToolDetails } from './read-contracts'
import { MAX_READ_ITEMS, type ReadItemInput } from './read-items'
import type { ReadItemResult } from './read-results'
import { stageReadStores, type ReadStores } from './read-stores'

export type { ReadStores } from './read-stores'

/** Items read at once. Reads are I/O-bound; a few in flight is all a backend needs. */
export const READ_BATCH_CONCURRENCY = 4
/** Model-facing text of one batch: about two and a half full single reads. */
export const MAX_BATCH_TEXT_BYTES = 160_000
/** Pictures one batch attaches, by count and by base64 size. */
export const MAX_BATCH_IMAGES = 6
export const MAX_BATCH_IMAGE_BYTES = 10_000_000

/** The window an item asked for, as its section header and card row name it. */
export function readItemRange(item: ReadItemInput): string | undefined {
  if (item.mode === 'outline') return 'outline'
  if (item.start_line != null) return `L${item.start_line}-${item.end_line ?? 'end'}`
  if (item.limit != null) return `L1-${item.limit}`
  if (item.offset != null) return `from byte ${item.offset}`
  if (item.pages) return `pages ${item.pages}`
  if (item.sheet) return `sheet ${item.sheet}`
  return undefined
}

type ReadOne = (item: ReadItemInput, stores: ReadStores) => Promise<ReadItemResult>

export async function runReadBatch(
  items: ReadItemInput[],
  readOne: ReadOne,
  session: ReadStores,
): Promise<ReadItemResult> {
  const accepted = items.slice(0, MAX_READ_ITEMS)
  const results = await mapLimit(accepted, READ_BATCH_CONCURRENCY, async (item) => {
    const stores = stageReadStores(session)
    try {
      return { item, stores, result: await readOne(item, stores) }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { item, stores, result: undefined, message }
    }
  })

  const sections: string[] = []
  const images: ImageContent[] = []
  const rows: ReadItemDetails[] = []
  const sources: AgentSource[] = []
  const skipped: string[] = items.slice(MAX_READ_ITEMS).map((item) => item.path)
  let textBytes = 0
  let imageBytes = 0
  let failures = 0

  for (const { item, stores, result, message } of results) {
    const range = readItemRange(item)
    const path = result?.details.path ?? item.path
    const label = `${path}${range ? ` (${range})` : ''}`
    const window = range ? { range } : {}
    const skip = () => {
      skipped.push(item.path)
      rows.push({ path, ...window, bytes: 0, truncated: false, output: '', skipped: true })
    }
    if (!result) {
      failures += 1
      const text = `Failed to read file: ${item.path}\n${message}`
      sections.push(`### ${label}\n${text}`)
      rows.push({ path, ...window, bytes: 0, truncated: false, output: text, isError: true })
      continue
    }
    const section = `### ${label}\n${result.content}`
    const sectionBytes = Buffer.byteLength(section)
    // The first item always fits: a single read has never been refused for its size.
    if (sections.length > 0 && textBytes + sectionBytes > MAX_BATCH_TEXT_BYTES) {
      skip()
      continue
    }
    const pictures = (result.contentParts ?? []).filter(
      (part): part is ImageContent => part.type === 'image',
    )
    const pictureBytes = pictures.reduce((sum, part) => sum + part.data.length, 0)
    if (
      pictures.length > 0 &&
      (images.length + pictures.length > MAX_BATCH_IMAGES ||
        imageBytes + pictureBytes > MAX_BATCH_IMAGE_BYTES)
    ) {
      skip()
      continue
    }
    stores.commit()
    textBytes += sectionBytes
    imageBytes += pictureBytes
    const first = images.length + 1
    images.push(...pictures)
    const imageNote =
      pictures.length === 0
        ? ''
        : `\n[image ${pictures.length === 1 ? first : `${first}-${images.length}`} of this call, below]`
    sections.push(section + imageNote)
    sources.push(...result.sources)
    if (result.isError) failures += 1
    const { items: _nested, ...details } = result.details
    rows.push({
      ...details,
      ...window,
      ...(result.isError ? { isError: true as const } : {}),
    })
  }

  if (skipped.length > 0) {
    sections.push(
      `[${skipped.length} more not shown — over this call's budget (${MAX_READ_ITEMS} files, ${formatSize(MAX_BATCH_TEXT_BYTES)} of text, ${MAX_BATCH_IMAGES} images). Read them separately: ${skipped.join(', ')}]`,
    )
  }

  const content = sections.join('\n\n')
  const delivered = rows.filter((row) => !row.skipped)
  const details: ReadToolDetails = {
    path: delivered[0]?.path ?? items[0]?.path ?? '',
    bytes: delivered.reduce((sum, row) => sum + row.bytes, 0),
    truncated: delivered.some((row) => row.truncated),
    output: summaryLine(rows),
    items: rows,
  }
  const contentParts: Array<TextContent | ImageContent> | undefined = images.length
    ? [{ type: 'text', text: content }, ...images]
    : undefined
  return {
    content,
    ...(contentParts ? { contentParts } : {}),
    details,
    sources,
    // A batch is an error only when nothing in it could be read.
    ...(failures > 0 && failures === delivered.length ? { isError: true as const } : {}),
  }
}

/** One line per file for consumers that render only `details.output`. */
function summaryLine(rows: ReadItemDetails[]): string {
  return rows
    .map((row) => {
      const state = row.skipped
        ? 'not shown'
        : row.isError
          ? 'failed'
          : row.kind === 'image'
            ? 'image'
            : formatSize(row.bytes)
      return `${row.path}${row.range ? ` (${row.range})` : ''}: ${state}`
    })
    .join('\n')
}
