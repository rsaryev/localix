import type { SessionSurfaceContribution } from '@localixai/mini-app-sdk/ui'
import { usePluginRegistrySlice } from './usePluginRegistrySlice'

const contributions: SessionSurfaceContribution[] = []

export function registerSessionSurface(contribution: SessionSurfaceContribution): void {
  if (
    contributions.some(
      (candidate) =>
        candidate.surface === contribution.surface &&
        candidate.pluginName === contribution.pluginName,
    )
  ) {
    return
  }
  contributions.push(contribution)
}

/** Drop every surface `owner` registered (a plugin reload or unload). */
export function removeSessionSurfacesOf(owner: string): void {
  for (let index = contributions.length - 1; index >= 0; index -= 1) {
    if (contributions[index]?.pluginName === owner) contributions.splice(index, 1)
  }
}

/** The contributions filling `surface`, in registration order. */
export function sessionSurfacesFor(surface: string): SessionSurfaceContribution[] {
  return contributions.filter((contribution) => contribution.surface === surface)
}

/**
 * The fills of one host surface. Subscribed to its OWN slice of the registry: rendered from a
 * parent that rarely re-renders (the composer, the chat surface), a surface read once at mount
 * never showed a plugin that registered later — the Git plugin's poller did not mount until
 * something else re-rendered its parent, so the panel reported "not a repository" at startup.
 */
export function SessionSurface({
  surface,
  sessionId,
  context,
}: {
  surface: string
  sessionId: string | null
  context?: unknown
}) {
  const contributions = usePluginRegistrySlice(`surface:${surface}`, () =>
    sessionSurfacesFor(surface),
  )
  return (
    <>
      {contributions.map((contribution, index) => (
        <contribution.Component
          key={`${contribution.pluginName ?? 'core'}:${contribution.surface}:${index}`}
          sessionId={sessionId}
          context={context}
        />
      ))}
    </>
  )
}
