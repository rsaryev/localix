import { capabilityResourceUri } from '@localixai/mini-app-sdk/navigation'
import { railSectionRegistry, railViewletRegistry } from '@/shared/contrib/uiContrib'
import { useMiniAppRegistrySlice } from '@/shared/contrib/useMiniAppRegistrySlice'
import { SurfaceErrorBoundary } from '@/shared/ui/SurfaceErrorBoundary'

const listRailSections = () => railSectionRegistry.list()
const listRailViewlets = () => railViewletRegistry.list()

/**
 * Rail sections contributed by mini apps through the open registry, in the shell's RailSection
 * shape; workbench sections default into the "…" overflow, matching the core db entry.
 *
 * The registry is read through its subscription, so a mini app whose UI loads after the page
 * painted (an install, an enable) gets its section at once. A memo that only listed the registry
 * kept its first answer in the built app: the React Compiler memoizes on what the body reads.
 */
export function useContributedRailSections(capabilityScope: string) {
  const sections = useMiniAppRegistrySlice('rail-sections', listRailSections)
  return sections.map((s) => ({
    id: s.id,
    icon: <s.Icon className="size-4.5" />,
    label: s.title,
    content: <s.Sidebar />,
    defaultArea: 'overflow' as const,
    miniApp: true,
    miniAppName: s.miniAppName,
    resourceUri: capabilityResourceUri({
      kind: 'view',
      id: s.id,
      scope: capabilityScope,
      label: s.title,
      description: `View contributed by ${s.miniAppName || 'a mini app'}`,
      enabled: true,
    }),
  }))
}

/**
 * Always-mounted lifecycle components mini apps contribute (render null): a rail SECTION's Mount
 * (a port-forward cleanup) and a rail VIEWLET's. Core mounts them generically, naming none, and
 * mounts one that registers later — an install, an enable — without a reload.
 *
 * Each behind its own boundary. These are ALWAYS mounted, so a mini app that throws here is
 * strictly worse than one that throws in a tab: without containment it takes the workspace down at
 * composition, on every start, with no tab to close. The fallback renders nothing visible for a
 * render-null component — the console name and the surviving app are the signal.
 */
export function MiniAppBackgroundMounts() {
  const sections = useMiniAppRegistrySlice('rail-sections', listRailSections)
  const viewlets = useMiniAppRegistrySlice('rail-viewlets', listRailViewlets)
  return (
    <>
      {sections.flatMap((s) =>
        s.Mount
          ? [
              <SurfaceErrorBoundary
                key={`mount:${s.id}`}
                surface={`The ${s.id} background`}
                fallback="silent"
              >
                <s.Mount />
              </SurfaceErrorBoundary>,
            ]
          : [],
      )}
      {viewlets.map((v) =>
        v.Mount ? (
          <SurfaceErrorBoundary
            key={`vmount:${v.kind}`}
            surface={`The ${v.kind} background`}
            fallback="silent"
          >
            <v.Mount />
          </SurfaceErrorBoundary>
        ) : null,
      )}
    </>
  )
}
