import type { PublishMessageContext, WorkItemKindContribution } from '@localixai/mini-app-sdk/ui'
import { useMiniAppKind, type WorkItem } from '@/entities/workspace-grid/model'
import { recordMiniAppRenderCrash } from '@/shared/contrib/miniAppViewErrors'
import type { ResolvedTheme } from '@/shared/theme/useTheme'
import { SurfaceErrorBoundary } from '@/shared/ui/SurfaceErrorBoundary'
import { LoadingHint } from '@localixai/kit/empty-hint'

/**
 * The body of a kind core does not own: a mini app's.
 *
 * Its registration is REPLACED under an open tab whenever the mini app is rebuilt — the runtime
 * removes the old module's contributions, registers the new module's and announces the swap. The
 * body around this one is a memo boundary on props a rebuild never changes (item, visibility,
 * focus, theme), so the open tab kept rendering the Component of the module the rebuild had
 * replaced: the agent reported the mini app swapped in place while the person was clicking the old
 * code, and a tab that had crashed stayed crashed after the fix.
 *
 * So this component subscribes to its OWN kind's registration (`useMiniAppKind`) — a first load,
 * a rebuild or a give-up re-renders this tab only, never a chat, a terminal or another mini app's
 * tab, and a restored tab no longer waits for the slowest mini app — and keys its error boundary by
 * the REGISTRATION. A new build is a new registration: a crashed tab remounts and shows it. Every
 * other mini app keeps its registration object, so its tab re-renders without remounting and keeps
 * its state through someone else's rebuild. A crash is also written to the mini app's own error
 * buffer, which is what the agent reads when it looks at the view (`miniAppViewErrors.ts`).
 */
export function MiniAppWorkItemBody({
  item,
  visible,
  focused,
  resolvedTheme,
  publishMessageContext,
}: {
  item: WorkItem
  visible: boolean
  focused: boolean
  resolvedTheme: ResolvedTheme
  publishMessageContext: PublishMessageContext
}) {
  const contributed = useMiniAppKind(item.kind)
  if (typeof contributed !== 'string') {
    const Contributed = contributed.Component
    const surface = `The ${item.kind} tab`
    // The session the tab belongs to is provided around every body by `WorkItemBody`.
    return (
      <SurfaceErrorBoundary
        key={`${item.id}#${registrationGeneration(contributed)}`}
        surface={surface}
        onError={(error) =>
          recordMiniAppRenderCrash(contributed.miniAppName ?? item.kind, surface, error)
        }
      >
        <Contributed
          item={item}
          visible={visible}
          focused={focused}
          resolvedTheme={resolvedTheme}
          publishMessageContext={publishMessageContext}
        />
      </SurfaceErrorBoundary>
    )
  }
  if (contributed === 'loading')
    return <LoadingHint className="text-xs">Restoring workspace…</LoadingHint>
  return <div className="p-4 text-xs text-text-faint">Unsupported: {item.kind}</div>
}

const generations = new WeakMap<WorkItemKindContribution, number>()
let lastGeneration = 0

/** A stable number per registration object: the same build keeps it, a rebuild gets a new one. */
function registrationGeneration(contribution: WorkItemKindContribution): number {
  let generation = generations.get(contribution)
  if (generation === undefined) {
    generation = ++lastGeneration
    generations.set(contribution, generation)
  }
  return generation
}
