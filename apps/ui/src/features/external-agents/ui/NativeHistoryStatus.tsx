import { Button } from '@localixai/kit/button'
import type { useExternalHistory } from '../model/useExternalHistory'

export function NativeHistoryStatus({
  history,
}: {
  history: ReturnType<typeof useExternalHistory>
}) {
  return (
    <>
      {history.loading && (
        <p className="px-3 py-2 text-xs text-text-faint">Reading agent history…</p>
      )}
      {history.error && (
        <div role="alert" className="px-3 py-2 text-xs text-text-soft">
          Could not read agent history.{' '}
          <Button variant="ghost" size="sm" onClick={() => void history.refresh()}>
            Retry
          </Button>
        </div>
      )}
      {history.hasMore && (
        <Button
          variant="ghost"
          size="sm"
          disabled={history.loadingMore}
          onClick={() => void history.loadMore()}
        >
          {history.loadingMore ? 'Loading…' : 'Show more agent sessions'}
        </Button>
      )}
    </>
  )
}
