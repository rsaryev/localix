/**
 * What a delegated child leaves open when its run ends, put away in one place.
 *
 * A sub-session shares its root's workspace, so whatever a finished child left open stays beside
 * its parent's work, where nobody drives it: its pages in the shared Browser strip, its
 * interactive terminals. The pages were closed here and the panes were not, so a child's `python3`
 * or `psql` outlived it. Everything is scoped to the CHILD's session: the pages it opened (the
 * client's `backgroundOnly` close keeps the ones the person opened) and the panes it listed — never its parent's.
 */
import type { RunnerDeps } from '../agent-runner-types'

export type ChildSurfaceDeps = Partial<Pick<RunnerDeps, 'streamRegistry' | 'terminalControl'>>

export function releaseChildSurfaces(deps: ChildSurfaceDeps, userId: string, sessionId: string) {
  deps.streamRegistry?.publish(userId, sessionId, {
    type: 'preview.closed',
    sessionId,
    backgroundOnly: true,
  })
  const panes = deps.terminalControl
  for (const { terminalId } of panes?.list({ userId, sessionId }) ?? [])
    panes?.close({ userId, sessionId, terminalId })
}
