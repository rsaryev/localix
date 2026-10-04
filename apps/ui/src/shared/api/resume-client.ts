/**
 * "Continue" on the conversation's unfinished work (`/rpc/sessions/:id/resume`). One of the
 * `backendClient` domain modules spread into the facade in `./client`.
 *
 * Every answer carries the conversation's points as they are now — after the wake, or beside the
 * 409 of a point that no longer holds — so the caller replaces what it shows at once instead of
 * keeping a Continue that cannot work.
 */
import type { ResumePoint } from '@localixai/api/client'
import { client, unwrap } from './internal'

/** `delivered` reached the agent; `missed`/`failed` mean nobody was woken. */
export type ResumeWakeStatus = 'delivered' | 'missed' | 'failed'

export type ResumeAnswer =
  | { points: ResumePoint[]; wake: ResumeWakeStatus; gone?: undefined }
  | { points: ResumePoint[]; gone: { message: string } }

export const resumeApi = {
  /** The root conversation's unfinished work, for a surface whose copy is still unknown. */
  async listResumePoints(rootSessionId: string): Promise<ResumePoint[]> {
    const json = await unwrap<{ points: ResumePoint[] }>(
      await client.rpc.sessions[':id'].resume.$get({ param: { id: rootSessionId } }),
    )
    return json.points
  },

  async resumeWork(rootSessionId: string, key: string): Promise<ResumeAnswer> {
    const response = await client.rpc.sessions[':id'].resume.$post({
      param: { id: rootSessionId },
      json: { key },
    })
    if (response.status === 409) {
      const body = (await response
        .clone()
        .json()
        .catch(() => null)) as { points?: ResumePoint[]; error?: { message?: string } } | null
      if (body && Array.isArray(body.points))
        return {
          points: body.points,
          gone: {
            message: body.error?.message ?? 'This work is no longer waiting to be continued',
          },
        }
    }
    return unwrap<{ points: ResumePoint[]; wake: ResumeWakeStatus }>(response)
  },
}
