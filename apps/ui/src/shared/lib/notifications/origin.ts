import type { NotificationOrigin, SessionCoordinates } from './types'

function decoded(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** Parse the React Router pathname into typed event provenance. */
export function routeEventOrigin(pathname: string): NotificationOrigin {
  const parts = pathname.split('/').filter(Boolean)
  // `/project/:projectId/:sessionId`, or a legacy `/chat/:sessionId` link that has not
  // been redirected to its scope yet.
  const sessionId = decoded(
    parts[0] === 'project' ? parts[2] : parts[0] === 'chat' ? parts[1] : undefined,
  )
  if (!sessionId) return { kind: 'application' }
  return {
    kind: 'session',
    sessionId,
    projectId: parts[0] === 'project' ? (decoded(parts[1]) ?? null) : null,
  }
}

export function originSession(origin: NotificationOrigin): SessionCoordinates | null {
  return origin.kind === 'application'
    ? null
    : { sessionId: origin.sessionId, projectId: origin.projectId }
}

export function sameOrigin(left: NotificationOrigin, right: NotificationOrigin): boolean {
  if (left.kind !== right.kind) return false
  if (left.kind === 'application' || right.kind === 'application') return true
  if (left.sessionId !== right.sessionId || left.projectId !== right.projectId) return false
  return left.kind !== 'resource' || right.kind !== 'resource'
    ? true
    : left.resourceKind === right.resourceKind && left.resourceId === right.resourceId
}
