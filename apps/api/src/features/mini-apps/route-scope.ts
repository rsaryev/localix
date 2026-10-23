import type { MiniAppRouteScope } from '@localixai/mini-app-sdk/backend'

/**
 * WHERE a mini app route call is happening, resolved per request from its `?sessionId=` and
 * `?projectId=`.
 *
 * The defect this exists to stop: the session id used to travel into `c.env.sessionId` exactly as
 * the query string spelled it, whether or not the ownership check behind `resolveSessionCwd`
 * passed. A mini app that keys its data by session — a game board, a course, an export — then read
 * and wrote under a session the caller never proved it owned, or one already deleted, which
 * resurrected that session's data after its deletion had removed it. So the session id is passed
 * on ONLY when the check succeeds: `c.env.sessionId` is a verified, live session of `userId`, or
 * absent. A mini app never needs to re-check it.
 *
 * The working directory climbs the same ladder the rest of the app does — the session's cwd, else
 * the project's, else the fallback — so a mini app that keeps state in the workspace lands in the
 * directory the terminal and the file tools see.
 */
export async function resolveMiniAppRouteScope(input: {
  userId: string
  request: Request
  /** The ownership gate: rejects (or resolves null) for a missing, foreign or deleted session. */
  resolveSessionCwd: (userId: string, sessionId: string) => Promise<string | null | undefined>
  resolveProjectCwd: (userId: string, projectId: string) => Promise<string | null | undefined>
  fallbackCwd: string
}): Promise<MiniAppRouteScope> {
  const params = new URL(input.request.url).searchParams
  const requested = params.get('sessionId')?.trim()
  const projectId = params.get('projectId')?.trim() ?? ''
  const sessionCwd = requested
    ? await input.resolveSessionCwd(input.userId, requested).catch(() => null)
    : null
  const projectCwd =
    sessionCwd ?? (projectId ? await input.resolveProjectCwd(input.userId, projectId) : null)
  return {
    userId: input.userId,
    ...(requested && sessionCwd ? { sessionId: requested } : {}),
    projectId,
    cwd: projectCwd ?? input.fallbackCwd,
  }
}
