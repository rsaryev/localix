import { useEffect, useRef } from 'react'
import { useCanvasCamera, zoomAt, type CameraViewport } from '@localixai/kit/canvas'
import type { CameraMove } from '../../shared/camera'
import { spaceApi } from '../api'
import type { CameraDirector } from './useCameraDirector'

/**
 * The tab's end of the agent's camera (`backend/camera-hub.ts`): hold a request open for the
 * next move, have the director take the camera there — remembered, glided, the target lit up —
 * and report what the view then shows, so `space_view` answers with what the person sees.
 *
 * A frame is framed by the board's one policy (`camera/framing.ts`): one element comes to a
 * reading size, several are fitted whole, a named zoom wins. A zoom or a slide is a jump from the
 * view as it is. A tab the same call just opened waits for its first placement before it moves.
 */
const PLACEMENT_MS = 450
const RETRY_MS = 2_000

export function useCameraBridge(
  sessionId: string,
  director: CameraDirector,
  /** The agent has taken the camera to these elements: what the board says out loud. */
  onShown: (ids: readonly string[]) => void,
) {
  const camera = useCanvasCamera()
  // The director changes identity with its history; the long poll must not restart with it.
  const current = useRef(director)
  current.current = director
  const shown = useRef(onShown)
  shown.current = onShown

  useEffect(() => {
    const stop = new AbortController()
    const mounted = Date.now()
    const pause = (ms: number) =>
      new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer)
          stop.signal.removeEventListener('abort', finish)
          resolve()
        }
        const timer = setTimeout(finish, ms)
        stop.signal.addEventListener('abort', finish, { once: true })
        if (stop.signal.aborted) finish()
      })
    void (async () => {
      let after = 0
      while (!stop.signal.aborted) {
        try {
          const command = await spaceApi.cameraWait(sessionId, after, stop.signal)
          if (!command || stop.signal.aborted) continue
          after = command.seq
          const settling = PLACEMENT_MS - (Date.now() - mounted)
          if (settling > 0) await pause(settling)
          if (stop.signal.aborted) break
          const size = current.current.size()
          if (!size) continue
          await move(current.current, camera.get(), command.move, size)
          if (stop.signal.aborted) break
          if (command.move.kind === 'frame' && command.move.spotlight?.length)
            shown.current(command.move.spotlight)
          await spaceApi.cameraReport(sessionId, {
            seq: command.seq,
            viewport: camera.get(),
            size,
          })
        } catch {
          if (!stop.signal.aborted) await pause(RETRY_MS)
        }
      }
    })()
    return () => stop.abort()
  }, [camera, sessionId])
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
