import type { VaultAuditEntry } from '@localixai/api/client'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { DIVIDED_LIST } from '@localixai/kit/divided-list'
import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'

const formatTime = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp)

export function VaultActivityView({
  entries,
  loading,
}: {
  entries: VaultAuditEntry[]
  loading: boolean
}) {
  if (loading && entries.length === 0) {
    return <LoadingHint className="py-16 text-xs">Loading value-free audit trail</LoadingHint>
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto p-3">
      <div className="grid gap-3">
        <header className="border-b border-border-faint pb-3">
          <h2 className="text-sm font-medium">Vault activity</h2>
          <p className="mt-1 max-w-2xl text-xs/relaxed text-text-soft">
            This audit trail records who used an item and the outcome. Secret values, provider
            headers, request bodies and query strings are never included.
          </p>
        </header>
        {entries.length === 0 ? (
          <EmptyHint className="py-14 text-xs">No Vault activity yet.</EmptyHint>
        ) : (
          <div className={DIVIDED_LIST}>
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-2.5"
              >
                <span
                  className={cn(
                    'size-2 rounded-full',
                    entry.result === 'success' ? 'bg-status-success' : 'bg-status-error',
                  )}
                />
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2 text-xs">
                    <span className="font-medium capitalize">{entry.operation}</span>
                    <span className="truncate text-text-soft">
                      {entry.label ?? entry.key ?? 'Deleted item'}
                    </span>
                    <span className="shrink-0 font-mono text-2xs text-text-faint">
                      · {entry.actorType}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-2xs text-text-faint">
                    {entry.actorId}
                    {entry.consumerType
                      ? ` · ${entry.consumerType}${entry.consumerId ? `:${entry.consumerId}` : ''}`
                      : ''}
                  </div>
                </div>
                <time className="text-2xs text-text-faint">{formatTime(entry.createdAt)}</time>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
