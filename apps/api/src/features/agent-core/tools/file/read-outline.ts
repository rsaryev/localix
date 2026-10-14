import { formatOutline, type OutlineProvider } from './outline'
import { MAX_OUTPUT_BYTES, modelFacingFile } from './read-output'
import { renderLineRange } from './read-render'

const OUTLINE_FALLBACK_HEAD_LINES = 40

export interface OutlineRead {
  output: string
  bytes: number
  truncated?: boolean
  /** Model-facing text when it differs from `output`. */
  content?: string
}

/**
 * Outline mode: symbol skeleton from the language server instead of text.
 * When it's unavailable (no LSP wired, unsupported language e.g. .md/.json,
 * server still starting) we do NOT dump the whole file — that was the surprise
 * token spend the old honest-error guarded against — but a bare error just cost
 * the model a wasted turn (measured: outline errored on .md/.tsx).
 * Fall back to a bounded HEAD: enough to orient, cheap, with the total line
 * count + how to read a specific span.
 */
export async function readOutline(
  fileContent: string,
  targetPath: string,
  outlineProvider: OutlineProvider | undefined,
): Promise<OutlineRead> {
  const fallbackHead = (reason: string): OutlineRead => {
    const head = renderLineRange(
      fileContent,
      targetPath,
      1,
      OUTLINE_FALLBACK_HEAD_LINES,
      MAX_OUTPUT_BYTES,
    )
    const output = `Outline unavailable for ${targetPath} (${reason}) — showing the first ${OUTLINE_FALLBACK_HEAD_LINES} lines. Use start_line/end_line for a specific span.\n${head.output}`
    return { output, bytes: head.bytes, truncated: head.truncated }
  }
  if (!outlineProvider) return fallbackHead('no language server in this run context')
  let symbols
  try {
    symbols = await outlineProvider(targetPath)
  } catch (error) {
    return fallbackHead(error instanceof Error ? error.message : 'language server error')
  }
  if (!symbols || symbols.length === 0)
    return fallbackHead('no symbols returned; unsupported language or the server is still starting')
  const outline = formatOutline(targetPath, symbols)
  return {
    output: outline,
    bytes: Buffer.byteLength(fileContent),
    content: modelFacingFile(outline),
  }
}
