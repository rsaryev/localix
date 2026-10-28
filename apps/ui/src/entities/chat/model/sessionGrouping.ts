import type { UiSession } from '@/shared/api/contracts'

export interface ActivitySessionGroup<T = UiSession> {
  id: 'today' | 'yesterday' | 'previous-7-days' | 'previous-30-days' | 'older'
  label: string
  sessions: T[]
}

/**
 * Buckets an already-sorted list without changing the order inside each bucket.
 * Local day boundaries match the dates shown by the session rows; elapsed-hour
 * buckets would move a late-night chat between sections in the middle of a day.
 */
export function activitySessionGroups<T extends { updatedAt: number }>(
  sessions: readonly T[],
  now = Date.now(),
): ActivitySessionGroup<T>[] {
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const today = startOfToday.getTime()
  const daysAgo = (days: number) => {
    const boundary = new Date(startOfToday)
    boundary.setDate(boundary.getDate() - days)
    return boundary.getTime()
  }
  const definitions: Array<{
    id: ActivitySessionGroup['id']
    label: string
    minimum: number
  }> = [
    { id: 'today', label: 'Today', minimum: today },
    { id: 'yesterday', label: 'Yesterday', minimum: daysAgo(1) },
    { id: 'previous-7-days', label: 'Previous 7 days', minimum: daysAgo(7) },
    { id: 'previous-30-days', label: 'Previous 30 days', minimum: daysAgo(30) },
    { id: 'older', label: 'Older', minimum: Number.NEGATIVE_INFINITY },
  ]
  const groups = definitions.map((definition) => ({ ...definition, sessions: [] as T[] }))

  for (const session of sessions) {
    const group = groups.find((candidate) => session.updatedAt >= candidate.minimum)
    group?.sessions.push(session)
  }

  return groups
    .filter((group) => group.sessions.length > 0)
    .map(({ id, label, sessions: groupedSessions }) => ({ id, label, sessions: groupedSessions }))
}
