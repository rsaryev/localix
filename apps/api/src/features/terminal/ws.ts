import { upgradeWebSocket } from 'hono/bun'
import type { Context } from 'hono'
import type { AppContext } from '../../app'
import type { Logger } from '../../lib/logger'
import { parseTerminalClientFrame, type TerminalServerFrame } from './contracts'
import type { TerminalService } from './service'
import { createBackpressuredWriter, type BackpressuredWriter } from './backpressure'
import { createOutputCoalescer, type OutputCoalescer } from './output-coalescer'

/**
 * Per-terminal I/O stream. The client opens `/rpc/terminal/:id/stream` after
 * creating a session via REST; this attaches to that session's PTY: it repaints
 * the scrollback, streams live output, and forwards input/resize frames. Auth is
 * the same `userId` middleware as every other route, and ownership is enforced by
 * the service (a foreign id yields no session → the socket closes).
 *
 * Shares Bun's single `websocket` handler with the realtime mux (hono/bun's
 * `upgradeWebSocket` funnels every route through the one exported handler).
 *
 * Backpressure: a fast PTY (a big build log, `yes`) against a STALLED socket would
 * grow Bun's per-socket send buffer without bound → OOM. Terminal frames cannot be
 * dropped mid-stream (that corrupts the render), and Bun exposes neither a PTY
 * pause nor a drain event, so each socket streams through a {@link BackpressuredWriter}
 * that bounds the buffer and SHEDS (closes) a consumer too slow to ever catch up.
 * See `backpressure.ts` for the full mechanism argument.
 */
export function createTerminalStreamRoute(deps: { service: TerminalService; logger: Logger }) {
  return upgradeWebSocket((c: Context<AppContext>) => {
    const userId = c.get('userId')
    const id = c.req.param('id') ?? ''
    let unsubscribe: (() => void) | null = null
    let offExit: (() => void) | null = null
    let writer: BackpressuredWriter | null = null
    let coalescer: OutputCoalescer | null = null

    return {
      onOpen(_evt, ws) {
        const session = deps.service.get(userId, id)
        if (!session) {
          // Single frame before an immediate close — no backpressure concern.
          const archived = deps.service.archivedTerminal(userId, id)
          if (archived?.replay)
            ws.send(
              JSON.stringify({ t: 'data', data: archived.replay } satisfies TerminalServerFrame),
            )
          const final: TerminalServerFrame =
            archived && archived.exitCode !== null
              ? {
                  t: 'exit',
                  code: archived.exitCode,
                  interactive: !archived.command,
                  command: archived.command,
                  cwd: archived.cwd,
                }
              : { t: 'unavailable' }
          ws.send(JSON.stringify(final))
          ws.close()
          return
        }
        // One bounded writer per socket: a slow socket sheds ITSELF without
        // stalling the PTY's other (healthy) subscribers.
        writer = createBackpressuredWriter(ws, {
          onShed: () => deps.logger.warn({ event: 'terminal.ws.shed', userId, terminalId: id }),
        })
        const emit = (frame: TerminalServerFrame) => writer?.write(JSON.stringify(frame))
        // A PTY hands out chunks the size of its read buffer (Bun caps them at 1 KB),
        // not the size of what the program printed, so one frame per chunk made a
        // megabyte of output cost the client ~1,000 messages to parse and write into
        // xterm. Merge the ones that arrive together; the FIRST chunk after idle — the
        // echo of the user's keypress — still goes out synchronously.
        coalescer = createOutputCoalescer((data) => emit({ t: 'data', data }))
        // Repaint what already scrolled by, then stream live output. Replay is already
        // one whole frame and precedes every live chunk, so it bypasses the merge.
        if (session.replay) emit({ t: 'data', data: session.replay })
        unsubscribe = session.subscribe((data) => coalescer?.push(data))
        offExit = session.onExit((code) => {
          // Exit is out-of-band: without this the client could see "process exited"
          // ahead of the process's own last lines, still merged in the open window.
          coalescer?.flush()
          emit({
            t: 'exit',
            code,
            interactive: !session.command,
            command: session.command,
            cwd: session.cwd,
          })
          ws.close()
        })
      },
      onMessage(evt, ws) {
        const session = deps.service.get(userId, id)
        if (!session) {
          ws.close()
          return
        }
        const frame = parseTerminalClientFrame(evt.data)
        if (!frame) return
        if (frame.t === 'input') deps.service.writeUserInput(userId, id, frame.data)
        else if (frame.t === 'resize') session.resize(frame.cols, frame.rows)
      },
      onClose() {
        // Release the backpressure hold FIRST: a socket that closed while backed
        // up must clear its queue + cancel its drain timer so it stops scheduling
        // work (the cancellation angle — a gone consumer wedges nothing).
        coalescer?.dispose()
        writer?.dispose()
        unsubscribe?.()
        offExit?.()
        coalescer = null
        writer = null
        unsubscribe = null
        offExit = null
      },
      onError(evt) {
        const cause = (evt as { error?: unknown }).error
        deps.logger.warn({
          event: 'terminal.ws.error',
          userId,
          terminalId: id,
          detail: cause instanceof Error ? cause.message : evt.type,
        })
      },
    }
  })
}
