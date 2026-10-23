import { Hono } from 'hono'
import { jsonBody, jsonError, type MiniAppRouteContext } from '@localixai/mini-app-sdk/backend'
import { systemMarkInputSchema } from '../shared/system-marks'
import type { SystemReader } from './system'
import type { ProcessService } from './processes'
import type { SystemMarksService } from './system-marks'

export interface TemplateServices {
  read: SystemReader
  processes: ProcessService
  marks: SystemMarksService
}

/**
 * Read-only GETs for the live data, and the routes that change the marks. A read that fails
 * answers 503 with a fixed message: the readers touch OS APIs and a process list, and an error
 * string from either could carry a path or a command line the mini app promises never to expose.
 * A change answers with the NEW state, so the view shows it without a second request, and reads
 * its body through `jsonBody`: a body that did not arrive as JSON could have come from any page.
 */
export function createTemplateRoutes({ read, processes, marks }: TemplateServices) {
  const unavailable = (context: Parameters<typeof jsonError>[0]) =>
    jsonError(context, 503, 'system_marks_unavailable', 'Marks are temporarily unavailable.')
  return new Hono<MiniAppRouteContext>()
    .get('/system', (context) => {
      context.header('Cache-Control', 'no-store')
      try {
        return context.json(read())
      } catch {
        return jsonError(
          context,
          503,
          'system_overview_unavailable',
          'System information is temporarily unavailable.',
        )
      }
    })
    .get('/processes', async (context) => {
      context.header('Cache-Control', 'no-store')
      try {
        return context.json(await processes.read())
      } catch {
        return jsonError(
          context,
          503,
          'system_processes_unavailable',
          'Processes are temporarily unavailable.',
        )
      }
    })
    .get('/marks', async (context) => {
      context.header('Cache-Control', 'no-store')
      return marks.list().then(
        (state) => context.json(state),
        () => unavailable(context),
      )
    })
    .post('/marks', jsonBody(systemMarkInputSchema), async (context) =>
      marks.add(context.req.valid('json').note).then(
        (state) => context.json(state),
        () => unavailable(context),
      ),
    )
    .delete('/marks/:id', async (context) =>
      marks.remove(context.req.param('id')).then(
        (state) => context.json(state),
        () => unavailable(context),
      ),
    )
}
