import { Button } from '@localixai/kit/button'
import type { useResumes } from './useResumes'

export function WorkspaceNotices({
  state,
  confirm,
  setConfirm,
}: {
  state: ReturnType<typeof useResumes>
  confirm: 'discard' | 'delete' | null
  setConfirm: (value: 'discard' | 'delete' | null) => void
}) {
  return (
    <>
      {state.error && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 text-xs text-status-error"
        >
          <span className="flex-1">{state.error}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void state.refresh()
            }}
          >
            Retry read
          </Button>
        </div>
      )}
      {state.recovered && state.dirty && (
        <p role="status" className="border-b border-border px-4 py-3 text-xs text-text-soft">
          Recovered your unsaved draft from this device. Save when ready.
        </p>
      )}
      {state.remoteDeleted && state.dirty && (
        <p role="status" className="border-b border-border px-4 py-3 text-xs text-status-warning">
          The saved resume was deleted. Your draft is retained; save it as a variant to keep your
          work.
        </p>
      )}
      {state.remoteChanged && !state.remoteDeleted && state.dirty && (
        <p role="status" className="border-b border-border px-4 py-3 text-xs text-status-warning">
          Saved state changed while you edited. Your draft is retained; saving requires the current
          revision. Merge independent edits, or save your draft as a variant.
          <Button
            variant="field"
            size="sm"
            className="ml-2"
            disabled={state.pending}
            onClick={state.rebase}
          >
            Merge saved changes
          </Button>
        </p>
      )}
      {confirm && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 text-xs">
          <span className="flex-1">
            {confirm === 'delete'
              ? 'Permanently delete this resume? Variants remain.'
              : 'Discard your unsaved changes and load the saved version?'}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={state.pending}
            onClick={() => setConfirm(null)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={state.pending}
            onClick={() => {
              if (confirm === 'delete') state.remove()
              else state.discard()
              setConfirm(null)
            }}
          >
            {confirm === 'delete' ? 'Delete resume' : 'Discard draft'}
          </Button>
        </div>
      )}
    </>
  )
}
