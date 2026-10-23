/**
 * The market category bar, drawn by the kit's `TabStrip` so both surfaces get the same ARIA tabs
 * pattern — `tablist`, `tab` + `aria-selected`, a roving tabindex, ←/→/Home/End — instead of two
 * hand-built rows that disagreed on it (see `useMarketTabs`).
 *
 * `tone="sidebar"` is the standalone sidebar mount, which sits on the host's sidebar ground and
 * takes its accent and seam from the sidebar tokens.
 */
import { TabStrip } from '@localixai/kit/tabs'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import type { MarketPickerTab } from '../model/marketPicker'

export function MarketTabStrip({
  tabs,
  active,
  onChange,
  tone = 'default',
  className,
}: {
  tabs: readonly MarketPickerTab[]
  active: string
  onChange: (key: string) => void
  tone?: 'default' | 'sidebar'
  className?: string
}) {
  return (
    <TabStrip
      variant="compact"
      aria-label="Market categories"
      items={tabs.map((t) => ({ id: t.key, label: t.label }))}
      activeId={active}
      onChange={onChange}
      className={cn(tone === 'sidebar' && 'border-sidebar-border', className)}
      {...(tone === 'sidebar'
        ? { activeTabClassName: 'bg-sidebar-accent text-sidebar-foreground' }
        : {})}
    />
  )
}
