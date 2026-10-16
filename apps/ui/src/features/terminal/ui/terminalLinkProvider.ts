import type { ILink, ILinkProvider, IBufferRange, Terminal } from '@xterm/xterm'
import { detectFileLinks, detectUrls } from '../model/terminalLinks'

export interface TerminalLinkHandlers {
  /** A `path[:line[:col]]` link was clicked — resolve + reveal in the editor. */
  openFile: (path: string, line?: number) => void
  /** An http(s) URL was clicked. */
  openUrl: (url: string) => void
}

// Bridges the pure link parsers onto xterm's per-buffer-line link provider.
// xterm hands us a 1-based buffer line number; we read that row's text, run the
// parsers, and translate character offsets into 1-based inclusive cell ranges.
// One provider surfaces both file links (the editor jump) and URL links.
export function createTerminalLinkProvider(
  term: Terminal,
  handlers: TerminalLinkHandlers,
): ILinkProvider {
  return {
    provideLinks(bufferLineNumber, callback) {
      const row = term.buffer.active.getLine(bufferLineNumber - 1)
      if (!row) {
        callback(undefined)
        return
      }
      const text = row.translateToString(true)
      if (!text) {
        callback(undefined)
        return
      }

      const links: ILink[] = []
      const range = (start: number, end: number): IBufferRange => ({
        // Offsets are 0-based, half-open [start, end). xterm cell coords are
        // 1-based inclusive: first cell = start+1, last cell = end.
        start: { x: start + 1, y: bufferLineNumber },
        end: { x: end, y: bufferLineNumber },
      })

      for (const f of detectFileLinks(text)) {
        links.push({
          range: range(f.startIndex, f.endIndex),
          text: f.text,
          activate: () => handlers.openFile(f.path, f.line),
        })
      }
      for (const u of detectUrls(text)) {
        links.push({
          range: range(u.startIndex, u.endIndex),
          text: u.url,
          activate: () => handlers.openUrl(u.url),
        })
      }

      callback(links.length ? links : undefined)
    },
  }
}

/**
 * Read up to `maxLines` of the terminal's active buffer (scrollback + view), top-to-bottom, as
 * plain strings for the link parsers. Lives beside the provider because both read the same xterm
 * buffer for the same parsers — the provider one row at a time, the quickpick a whole screen.
 */
export function readBufferLines(term: Terminal, maxLines = 500): string[] {
  const buf = term.buffer.active
  const total = buf.length
  const start = Math.max(0, total - maxLines)
  const lines: string[] = []
  for (let i = start; i < total; i++) {
    const row = buf.getLine(i)
    lines.push(row ? row.translateToString(true) : '')
  }
  return lines
}
