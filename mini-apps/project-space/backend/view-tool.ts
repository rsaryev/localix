import type { MiniAppContext } from '@localixai/mini-app-sdk/backend'
import { describeSpace } from '../shared/agent/describe'
import { CAMERA_ZOOM, FRAME_ZOOM_CAP, visibleRect, type CameraReport } from '../shared/camera'
import { cameraMove, elementsIn } from '../shared/camera-target'
import { SPACE_TOOLS, spaceUri } from '../shared/resource'
import { spaceTypes } from '../shared/types'
import { cameraHub } from './camera-hub'
import { spaceStore } from './space-store'
import type { ResolveRoot } from './tools'

/**
 * The agent's CAMERA on the board: one tool for everything that changes what the person sees —
 * frame elements, groups or frames; frame an area or the whole board; zoom; slide — instead of a
 * tool per gesture. It changes nothing on the board and writes no file.
 *
 * It answers with what the view now SHOWS: the rectangle, the zoom, and the roster of the
 * elements in it, reported by the tab itself after the move. That is the cheap way to look — a
 * few lines instead of a screenshot — and the screenshot stays for when the picture matters.
 */
const ANSWER_MS = 2_500
/** A tab still opening (the person just opened it from a link) needs time to mount and place its camera. */
const OPENING_MS = 6_000
const LISTED = 40

const percent = (zoom: number) => `${Math.round(zoom * 100)}%`

export function createViewTool(ctx: MiniAppContext, resolveRoot: ResolveRoot) {
  const z = ctx.z
  const box = z.object({
    x: z.number(),
    y: z.number(),
    w: z.number().positive(),
    h: z.number().positive(),
  })
  return ctx.defineTool({
    name: SPACE_TOOLS.view,
    label: 'Move the Project Space camera',
    activeVerb: 'Moving the camera',
    description: `Move the camera of the board tab the person is looking at, and see what it then shows (a roster of the elements in view, far cheaper than a screenshot). One call, one move: \`focus\` frames elements, groups or frames by id — ONE element is brought close enough to read (up to ${percent(FRAME_ZOOM_CAP.one)}), several are fitted whole (up to ${percent(FRAME_ZOOM_CAP.many)}), and what you focus glows for a moment so the person sees what you point at; \`area\` frames a board rectangle; \`fit\` frames the whole board; \`zoom\` (${CAMERA_ZOOM.min}–${CAMERA_ZOOM.max}, 1 is 100%) sets how close — with focus/area/fit it pins the zoom instead of fitting, alone it zooms about the centre; \`pan\` slides by fractions of the view ({x: 0.5} is half a screen right, {y: -1} a screen up). Changes nothing on the board.`,
    inputSchema: z.object({
      focus: z
        .array(z.string().trim().min(1))
        .min(1)
        .optional()
        .describe('Element, group or frame ids.'),
      area: box.optional().describe('A board rectangle in board pixels.'),
      fit: z.boolean().optional(),
      zoom: z.number().min(CAMERA_ZOOM.min).max(CAMERA_ZOOM.max).optional(),
      pan: z
        .object({
          x: z.number().min(-5).max(5).optional(),
          y: z.number().min(-5).max(5).optional(),
        })
        .optional(),
    }),
    executionMode: 'sequential',
    mutates: false,
    // Moving the camera changes what the person sees, never the board.
    classify: () => ({ effect: 'view' }),
    behaviorHints: { readOnlyHint: true },
    permissionPaths: () => [],
    async execute(_id, input, _signal, _onUpdate, context) {
      const sessionId = context?.session?.id
      if (!sessionId)
        return {
          content: 'The camera belongs to a chat’s board tab; this run has no chat.',
          isError: true,
        }
      const root = await resolveRoot(sessionId)
      const { space } = await spaceStore.read(root, 'agent')
      const move = cameraMove(space, input)
      if (typeof move === 'string') return { content: `Nothing moved: ${move}.`, isError: true }

      const open = cameraHub.listening(sessionId)
      const seq = cameraHub.send(sessionId, move)
      const report = await cameraHub.awaitReport(sessionId, seq, open ? ANSWER_MS : OPENING_MS)
      const details = {
        reveal: ctx.ui.offer({ uri: spaceUri(sessionId), label: 'Open Project Space' }),
      }
      if (!report)
        return {
          content:
            'The move was sent, but the board tab did not answer: it is not open in a chat the person is looking at. Give the user the App view link to open it, or read it with space_read meanwhile.',
          details,
        }
      return { content: describeView(space, report), details }
    },
  })
}

function describeView(space: Parameters<typeof describeSpace>[0], report: CameraReport): string {
  const rect = visibleRect(report)
  const ids = elementsIn(space, rect)
  const total = Object.keys(space.elements).length
  const where = `The view shows x ${Math.round(rect.x)}…${Math.round(rect.x + rect.w)}, y ${Math.round(rect.y)}…${Math.round(rect.y + rect.h)} at ${Math.round(report.viewport.zoom * 100)}%.`
  if (ids.length === 0) return `${where} Nothing of the board's ${total} elements is in view.`
  const roster = describeSpace(space, spaceTypes, { ids, limit: LISTED })
    .split('\n')
    .slice(1)
    .join('\n')
  return `${where} In view: ${ids.length} of ${total} elements.\n${roster}`
}
