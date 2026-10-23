import type { Box } from './ops/geometry'

/**
 * The agent's hand on the CAMERA of an open board — the one message kind that travels from the
 * backend to the tab, and the one report that comes back.
 *
 * The camera is the person's screen, not the board file, so it is never an operation on the
 * board (no undo, nothing written). A move names where to LOOK — a rectangle of the board, a
 * zoom, a pan by a fraction of the view — never pixels of a screen the backend cannot see; the
 * tab turns it into a viewport with its own size and camera, and answers with what it now shows.
 */
/** What is framed: ONE element (brought to a reading size) or several, fitted whole. */
export type Subject = 'one' | 'many'

export type CameraMove =
  /**
   * Frame a board rectangle; `zoom` pins the zoom instead of fitting. `subject` says whether it
   * is ONE element (brought to a reading size) or several (fitted whole), and `spotlight` which
   * elements to light up on arrival — what the agent is pointing at.
   */
  | {
      kind: 'frame'
      rect: Box
      zoom?: number
      subject?: Subject
      spotlight?: string[]
    }
  /** Zoom about the centre of the view. */
  | { kind: 'zoom'; zoom: number }
  /** Slide by fractions of the view: x 0.5 is half a screen to the right. */
  | { kind: 'pan'; x: number; y: number }

export interface CameraCommand {
  seq: number
  move: CameraMove
}

/** A move pushed to the chat's board tab on the space stream's tag (`backend/ws-frames.ts`). */
export interface CameraFrame {
  sessionId: string
  camera: CameraCommand
}

/** What the tab shows after a move: its camera and the size of the view, in screen pixels. */
export interface CameraReport {
  seq: number
  viewport: { x: number; y: number; zoom: number }
  size: { width: number; height: number }
}

/** The board rectangle a report's view shows. */
export function visibleRect(report: Pick<CameraReport, 'viewport' | 'size'>): Box {
  const { x, y, zoom } = report.viewport
  return { x: -x / zoom, y: -y / zoom, w: report.size.width / zoom, h: report.size.height / zoom }
}

/**
 * The host board's zoom limits (`CAMERA_ZOOM` of `@localixai/kit/canvas`), restated as data: the
 * agent's tool validates a zoom on the backend, which cannot import the host UI.
 */
export const CAMERA_ZOOM = { min: 0.1, max: 2.5 } as const

/**
 * The closest a framing comes on its own, by what is framed (`ui/camera/framing.ts`): one element
 * to a reading size, several or a frame never past 100 %. Here so the agent's tool describes the
 * number the camera uses rather than a copy of it.
 */
export const FRAME_ZOOM_CAP: Readonly<Record<Subject, number>> = { one: 1.25, many: 1 }
