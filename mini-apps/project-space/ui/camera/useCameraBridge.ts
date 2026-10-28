import { useEffect, useEffectEvent } from 'react'
import { useCanvasCamera, zoomAt, type CameraViewport } from '@localixai/kit/canvas'
import type { CameraCommand, CameraMove } from '../../shared/camera'
import { spaceApi } from '../api'
import { cameraFeed } from '../spaceStream'
import type { CameraDirector } from './useCameraDirector'

/**
 * The tab's end of the agent's camera (`backend/camera-hub.ts`): follow the chat's moves on the
 * board's stream, have the director take the camera to each — remembered, glided, the target lit
 * up — and report what the view then shows, so `space_view` answers with what the person sees.
 *
 * A frame is framed by the board's one policy (`camera/framing.ts`): one element comes to a
 * reading size, several are fitted whole, a named zoom wins. A zoom or a slide is a jump from the
 * view as it is. A tab the same call just opened waits for its first placement before it moves.
 *
 * Moves are taken one at a time, in the order sent. The backend re-sends a fresh last move when
 * the stream starts (a tab just opened, a socket back), so one already taken is skipped by its
 * sequence number.
 */
const PLACEMENT_MS = 450

export interface CameraBridgeOptions {
  /** The backend advertises its live stream (`SpaceView.liveUpdates`): follow only then. */
  readonly live: boolean
  /** Wait `ms`, ending early on abort. A test passes its own; the default is a timer. */
  readonly pause?: (ms: number, signal: AbortSignal) => Promise<void>
  readonly now?: () => number
}

export function useCameraBridge(
  sessionId: string,
  director: CameraDirector,
  /** The agent has taken the camera to these elements: what the board says out loud. */
  onShown: (ids: readonly string[]) => void,
  { live, pause = abortablePause, now = Date.now }: CameraBridgeOptions,
) {
  const camera = useCanvasCamera()
  // The director changes identity with its history; the subscription must not restart with it.
  const currentDirector = useEffectEvent(() => director)
  const shown = useEffectEvent(onShown)
  const wait = useEffectEvent(pause)
  const clock = useEffectEvent(now)

  useEffect(() => {
    if (!live) return
    const stop = new AbortController()
    const mounted = clock()
    let taken = 0
    let queue = Promise.resolve()
    const take = async (command: CameraCommand) => {
      const settling = PLACEMENT_MS - (clock() - mounted)
      if (settling > 0) await wait(settling, stop.signal)
      if (stop.signal.aborted) return
      const size = currentDirector().size()
      if (!size) return
      await move(currentDirector(), camera.get(), command.move, size)
      if (stop.signal.aborted) return
      if (command.move.kind === 'frame' && command.move.spotlight?.length)
        shown(command.move.spotlight)
      await spaceApi.cameraReport(sessionId, { seq: command.seq, viewport: camera.get(), size })
    }
    const release = cameraFeed.follow(sessionId, {
      frame: ({ camera: command }) => {
        if (command.seq === taken) return
        taken = command.seq
        // A failed move or report leaves the tool to time out; the next move still runs.
        queue = queue.then(() => take(command)).catch(() => {})
      },
    })
    return () => {
      stop.abort()
      release()
    }
  }, [camera, sessionId, live])
}

function abortablePause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    signal.addEventListener('abort', finish, { once: true })
    if (signal.aborted) finish()
  })
}

async function move(
  director: CameraDirector,
  now: CameraViewport,
  move: CameraMove,
  size: { width: number; height: number },
) {
  if (move.kind === 'frame') {
    await director.frame(move.rect, move.subject ?? 'many', {
      ...(move.zoom !== undefined ? { zoom: move.zoom } : {}),
      ...(move.spotlight ? { spotlight: move.spotlight } : {}),
    })
    return
  }
  if (move.kind === 'zoom') {
    // About the centre of the view: the board point there stays there.
    await director.jump(zoomAt(now, { x: size.width / 2, y: size.height / 2 }, move.zoom))
    return
  }
  await director.jump({
    x: now.x - move.x * size.width,
    y: now.y - move.y * size.height,
    zoom: now.zoom,
  })
}
