import { ChevronRight, ExternalLink, FolderOpen, Info } from 'lucide-react'
import { CompletionKeyHint } from './CompletionKeyHint'
import { CompletionMenu, type CompletionMenuItem } from './CompletionMenu'
import { ResourceGlyph } from './ResourceGlyph'
import type { useOpenResourceCommand } from './useOpenResourceCommand'
import { ActivitySignal } from '@localixai/kit/activity-orb'

type OpenMenuModel = ReturnType<typeof useOpenResourceCommand>

export function OpenResourceMenu({ model, menuId }: { model: OpenMenuModel; menuId?: string }) {
  const items: CompletionMenuItem[] = model.rows.map((row, index) => {
    const previous = model.rows[index - 1]
    const firstChild = !row.current && (index === 0 || previous?.current)
    const newGroup = Boolean(row.node.group) && row.node.group !== previous?.node.group
    const sectionHeaders = row.current
      ? [{ label: 'Open current' }]
      : newGroup
        ? [{ label: row.node.group ?? '', divider: index > 0 }]
        : firstChild
          ? [{ label: 'Go deeper', divider: Boolean(previous?.current) }]
          : undefined
    return {
      key: row.id,
      index,
      onSelect: () => model.accept(row),
      sectionHeaders,
      content: (
        <>
          <span className="shrink-0">
            {row.current ? (
              // `--accent-foreground`, not `--accent`: `--accent` is a FILL token — a 6%
              // foreground veil under glass — so this "open it" glyph was invisible.
              <ExternalLink className="size-3.5 text-accent-foreground" />
            ) : (
              <ResourceGlyph icon={row.node.icon} />
            )}
          </span>
          <span className="shrink-0 text-sm font-medium text-foreground">
            {row.current ? `Open ${row.node.label}` : row.node.label}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm text-text-soft">{row.node.detail}</span>
          {index === model.activeIndex && (
            <CompletionKeyHint
              hints={[
                { key: '↵', label: row.current || !row.node.hasChildren ? 'open' : 'browse' },
              ]}
            />
          )}
        </>
      ),
    }
  })

  const top =
    model.breadcrumbs.length > 1 ? (
      <div className="flex items-center gap-0.5 overflow-x-auto px-2 text-xs text-text-soft">
        {model.breadcrumbs.map((crumb, index) => (
          <span key={crumb.uri ?? 'root'} className="flex shrink-0 items-center gap-0.5">
            {index > 0 && <ChevronRight className="size-3 opacity-40" />}
            <button
              type="button"
              className="rounded-sm px-1 py-0.5 outline-none transition-colors hover:bg-surface-hover hover:text-foreground focus-ring"
              onClick={() => model.setParent(crumb.uri)}
            >
              {index === 0 && <FolderOpen className="mr-1 inline size-3" />}
              {crumb.label}
            </button>
          </span>
        ))}
      </div>
    ) : undefined
  const bottom = (
    <>
      {model.pending && (
        <ActivitySignal
          label="Loading resources"
          className="justify-center px-2.5 py-2 text-sm text-text-soft"
          labelClassName="min-w-0"
        />
      )}
      {model.notices.map((notice) => (
        <div
          key={notice.uri}
          className="flex items-center gap-2 px-2.5 py-1.5 text-sm text-text-soft"
        >
          <Info className="size-3.5" />
          <span>{notice.label}</span>
        </div>
      ))}
    </>
  )
  return (
    <CompletionMenu
      id={menuId}
      items={items}
      activeIndex={model.activeIndex}
      onHover={model.setActiveIndex}
      top={top}
      bottom={bottom}
      empty={
        model.pending ? undefined : (
          <div className="px-3 py-2 text-sm text-text-soft">Nothing openable here.</div>
        )
      }
    />
  )
}
