import {
  MousePointerClick,
  Monitor,
  Server,
  ExternalLink,
  Maximize2,
  Smartphone,
  Tablet,
  Laptop,
  RotateCw,
} from 'lucide-react'
import type { MenuEntry } from '@localixai/plugin-sdk/ui'
import { IconButton } from '@localixai/kit/icon-button'
import { ActionTooltip } from '@localixai/kit/tooltip'
import { WorkbenchToolbar, WorkbenchToolbarSection } from '@localixai/kit/workbench-toolbar'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { platformCapabilities } from '@/shared/lib/platformCapabilities'
import { PreviewAddressBar } from './PreviewAddressBar'
import { PREVIEW_PORT_PRESETS, presetUrl } from '../model/previewPortPresets'
import {
  PREVIEW_VIEWPORT_PRESETS,
  isFixedViewport,
  rotateViewport,
  viewportSizeLabel,
  type PreviewViewportPreset,
} from '../model/previewViewportPresets'

export interface BrowserToolbarProps {
  url: string
  onNavigate?: (url: string) => void
  onReload: () => void
  onBack?: () => void
  onForward?: () => void
  canGoBack?: boolean
  canGoForward?: boolean
  /** A document load is in flight; drawn as a sweep along the toolbar's bottom edge. */
  loading?: boolean
  /** Pick an element to comment on — the frame's probe is the only thing that can. */
  feedback?: { on: boolean; available: boolean; onToggle: () => void }
  viewport?: { preset: PreviewViewportPreset; onChange: (next: PreviewViewportPreset) => void }
}

/**
 * The one toolbar every browser page gets, local or not.
 *
 * Its controls used to depend on which engine rendered the page: the dev preview had frame sizes,
 * ports and "open in browser" but no history, and a native page had history but none of the rest.
 * Each control now appears whenever its engine can do the job, so the two differ only where they
 * must — Visual Feedback and the dev server exist only for a framed local page. History and
 * closing live on the tab strip above, once for every tab.
 */
export function BrowserToolbar({
  url,
  onNavigate,
  onReload,
  onBack,
  onForward,
  canGoBack,
  canGoForward,
  loading = false,
  feedback,
  viewport,
}: BrowserToolbarProps) {
  return (
    <WorkbenchToolbar density="compact" aria-label="Browser controls" className="relative gap-1">
      <PreviewAddressBar
        key={url}
        url={url}
        onNavigate={onNavigate}
        onReload={onReload}
        onBack={onBack}
        onForward={onForward}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
      />
      {(feedback || viewport) && (
        <WorkbenchToolbarSection
          aria-label="Page review controls"
          spacing="compact"
          className="shrink-0 border-l border-border-soft pl-1"
        >
          {feedback && (
            <IconButton
              size="sm"
              aria-label="Visual Feedback"
              tooltip={
                feedback.on
                  ? 'Stop Visual Feedback'
                  : feedback.available
                    ? 'Attach visual feedback'
                    : 'Visual Feedback unavailable'
              }
              aria-pressed={feedback.on}
              disabled={!feedback.available}
              className={cn('shrink-0', feedback.on && 'bg-surface-hover text-status-success')}
              onClick={feedback.onToggle}
            >
              <MousePointerClick className="size-3.5" />
            </IconButton>
          )}
          {viewport && <FrameSizeMenu preset={viewport.preset} onChange={viewport.onChange} />}
        </WorkbenchToolbarSection>
      )}
      <WorkbenchToolbarSection
        align="end"
        aria-label="Page actions"
        spacing="compact"
        className="shrink-0 grow-0 border-l border-border-soft pl-1"
      >
        {onNavigate && <DevServerMenu onNavigate={onNavigate} />}
        {/* The button IS the question — asking "Open localhost:8000?" after a click on
            "Open in browser" is a second question with one answer. Content links keep
            the confirmation; a toolbar action the person chose does not. */}
        <IconButton
          size="sm"
          aria-label="Open in browser"
          tooltip="Open in browser"
          onClick={() => platformCapabilities().external.open(url, true)}
        >
          <ExternalLink className="size-3.5" />
        </IconButton>
      </WorkbenchToolbarSection>
      {loading && (
        <div
          role="progressbar"
          aria-label="Loading page"
          className="lx-page-loading pointer-events-none absolute inset-x-0 bottom-0 h-0.5"
        />
      )}
    </WorkbenchToolbar>
  )
}

/**
 * The device a preset stands for, as its leading glyph — so a size reads at a glance as a phone or
 * a desktop rather than as two numbers. Decided by the listed (portrait) width, the axis the
 * presets are ordered on.
 */
function deviceIcon(preset: PreviewViewportPreset) {
  if (preset.width === null) return Maximize2
  if (preset.width < 600) return Smartphone
  if (preset.width < 1000) return Tablet
  if (preset.width < 1400) return Laptop
  return Monitor
}

/**
 * The frame-size choices as described entries.
 *
 * They were Radix radio items with a hand-made two-column label (a fixed `w-24` column for the
 * size, the checkmark in the leading slot), a second menu shape beside the one every other pick in
 * the app uses. As `selected` rows each size keeps its device icon in front, the check moves to the
 * end, and the size sits in the shared `hint` column.
 */
export function frameSizeMenuEntries(
  preset: PreviewViewportPreset,
  onChange: (next: PreviewViewportPreset) => void,
): MenuEntry[] {
  return [
    { header: 'Page frame' },
    ...PREVIEW_VIEWPORT_PRESETS.map(
      (item): MenuEntry => ({
        id: `frame:${item.label}`,
        label: item.label,
        icon: deviceIcon(item),
        hint: viewportSizeLabel(item) ?? 'Fill panel',
        selected: item.label === preset.label,
        onSelect: () => onChange(item),
      }),
    ),
    ...(isFixedViewport(preset)
      ? [
          { separator: true } as const,
          {
            id: 'rotate',
            label: 'Rotate frame',
            icon: RotateCw,
            onSelect: () => onChange(rotateViewport(preset)),
          },
        ]
      : []),
  ]
}

export function FrameSizeMenu({
  preset,
  onChange,
}: {
  preset: PreviewViewportPreset
  onChange: (next: PreviewViewportPreset) => void
}) {
  return (
    <DropdownMenu>
      <ActionTooltip label={`Frame size · ${viewportSizeLabel(preset) ?? 'Responsive'}`} side="top">
        <DropdownMenuTrigger asChild>
          <IconButton size="sm" aria-label="Page frame size" className="shrink-0">
            <Monitor className={cn('size-3.5', isFixedViewport(preset) && 'text-status-info')} />
          </IconButton>
        </DropdownMenuTrigger>
      </ActionTooltip>
      <DropdownMenuContent align="end" className="w-64">
        <MenuEntries family="dropdown" entries={frameSizeMenuEntries(preset, onChange)} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function DevServerMenu({ onNavigate }: { onNavigate: (url: string) => void }) {
  return (
    <DropdownMenu>
      <ActionTooltip label="Dev-server ports" side="top">
        <DropdownMenuTrigger asChild>
          <IconButton size="sm" aria-label="Dev-server ports">
            <Server className="size-3.5" />
          </IconButton>
        </DropdownMenuTrigger>
      </ActionTooltip>
      <DropdownMenuContent align="end" className="w-64">
        {/* The port is the row's `hint`, not a hand-sized second column: the same right edge
            the frame-size menu beside it aligns its sizes on. */}
        <MenuEntries
          family="dropdown"
          entries={PREVIEW_PORT_PRESETS.map((port) => ({
            id: `port:${port.port}`,
            label: port.label,
            hint: `:${port.port}`,
            onSelect: () => onNavigate(presetUrl(port.port)),
          }))}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
