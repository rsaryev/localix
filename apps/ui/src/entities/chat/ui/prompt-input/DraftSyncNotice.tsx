import { Button } from '@localixai/kit/button'
import type { useViewState } from '@/shared/lib/view-state/useViewState'
import { viewStateStore } from '@/shared/lib/view-state/store'

/** A concurrent draft is an explicit choice; neither channel silently discards the other's text. */
export function DraftSyncNotice({ state }: { state: ReturnType<typeof useViewState> }) {
  const address = state.address
  if (!address || (!state.conflict && !state.error)) return null
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-1.5 px-3 py-2 text-xs text-text-soft"
    >
      <span className="mr-auto">
        {state.conflict ? 'Draft edited in another channel' : 'Draft sync unavailable'}
      </span>
      {state.conflict ? (
        <>
          <Button variant="ghost" size="xs" onClick={() => viewStateStore.acceptRemote(address)}>
            Use other draft
          </Button>
          <Button variant="field" size="xs" onClick={() => viewStateStore.keepLocal(address)}>
            Keep mine
          </Button>
        </>
      ) : (
        <Button
          variant="ghost"
          size="xs"
          onClick={() => {
            void viewStateStore.flush(address)
          }}
        >
          Retry
        </Button>
      )}
    </div>
  )
}
