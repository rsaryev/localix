import type { KubeEvent } from '../../backend/contracts'
import { EmptyHint } from '@localixai/kit/empty-hint'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { formatResourceAge } from '../../../ui/model/resourceAge'

/**
 * A resource's recent API events, newest first — Warnings tinted. Shared by
 * the pod tab and the deployment/service resource tab so their event feeds stay
 * identical (age via the same `formatResourceAge`).
 */
export function EventsTable({
  events,
  emptyLabel = 'No recent events.',
}: {
  events: KubeEvent[]
  emptyLabel?: string
}) {
  if (events.length === 0) return <EmptyHint className="p-4">{emptyLabel}</EmptyHint>
  return (
    <div className="scrollbar-thin h-full overflow-auto">
      <table className="w-full border-collapse text-2xs">
        {/* `/95`, not plain `bg-background`: under glass the nested ground coat is cleared by the
            paint-the-ground-once rule, so the sticky header went transparent and rows scrolled
            visibly through it. The alpha escapes that rule in the pane's own hue. */}
        {/* The shared sticky-strip recipe — see `.lx-occluder` in index.css for why a coat of the
            pane's own ground reads as a black band under glass. */}
        <thead className="lx-occluder sticky top-0">
          <tr className="text-left text-text-faint">
            <th className="whitespace-nowrap px-3 py-1.5 font-medium uppercase tracking-wide">
              Reason
            </th>
            <th className="w-full px-3 py-1.5 font-medium uppercase tracking-wide">Message</th>
            <th className="whitespace-nowrap px-3 py-1.5 text-right font-medium uppercase tracking-wide">
              Count
            </th>
            <th className="whitespace-nowrap px-3 py-1.5 text-right font-medium uppercase tracking-wide">
              Age
            </th>
          </tr>
        </thead>
        <tbody className="text-text-soft">
          {events.map((ev) => (
            <tr
              key={`${ev.lastSeen}:${ev.source}:${ev.reason}:${ev.message}`}
              className="border-t border-border-soft align-top"
            >
              <td
                className={cn(
                  'whitespace-nowrap px-3 py-1',
                  ev.type === 'Warning' ? 'text-status-warning' : 'text-text-soft',
                )}
              >
                {ev.reason || '—'}
              </td>
              <td className="px-3 py-1">
                {ev.message}
                {ev.source && <span className="ml-1.5 text-text-faint">({ev.source})</span>}
              </td>
              <td className="whitespace-nowrap px-3 py-1 text-right tabular-nums text-text-faint">
                {ev.count}
              </td>
              <td className="whitespace-nowrap px-3 py-1 text-right tabular-nums text-text-faint">
                {formatResourceAge(ev.lastSeen) || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
