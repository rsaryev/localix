import { ChevronRight } from 'lucide-react'
import type { LspDocumentSymbol } from '@/shared/api/contracts'
import { BreadcrumbSelect } from '@localixai/kit/breadcrumb-select'
import { WorkbenchBreadcrumb } from '@localixai/kit/workbench-breadcrumb'
import { symbolKindMeta } from '../model/symbolKindMeta'
import { symbolSiblings } from './symbolSiblings'

/**
 * A symbol-only trail strands navigation when the caret is outside a symbol.
 * The file segment of the file + symbol breadcrumbs keeps the entire
 * document searchable there; each scope also exposes its peers and children.
 */
export function SymbolBreadcrumbBar({
  fileName,
  symbolPath,
  docSymbols,
  onJump,
  bordered = true,
}: {
  fileName: string
  symbolPath: LspDocumentSymbol[]
  docSymbols: LspDocumentSymbol[]
  onJump: (line: number) => void
  bordered?: boolean
}) {
  const current = symbolPath.at(-1)
  const children = current
    ? docSymbols.filter(
        (s) =>
          s.depth === current.depth + 1 && s.line >= current.line && s.endLine <= current.endLine,
      )
    : []
  const items = (symbols: LspDocumentSymbol[]) =>
    symbols.map((s) => {
      const { Icon } = symbolKindMeta(s.kind)
      return {
        id: `${s.name}:${s.line}:${s.character}:${s.depth}`,
        label: s.name,
        description: s.detail,
        hint: `L${s.line + 1}`,
        icon: <Icon className="size-3.5" />,
        active: s === current,
        onSelect: () => onJump(s.line),
      }
    })

  return (
    <WorkbenchBreadcrumb aria-label="Document symbols" density="compact" bordered={bordered}>
      <li className="flex min-w-0 items-center">
        <BreadcrumbSelect
          label={fileName}
          density="compact"
          ariaLabel={`Browse symbols in ${fileName}`}
          ariaCurrent={current ? undefined : 'location'}
          items={items(docSymbols)}
          searchPlaceholder="Filter symbols…"
          placeholder="No symbols in this file"
        />
      </li>
      {symbolPath.map((s, i) => (
        <li key={`${s.name}:${s.line}:${s.character}`} className="flex min-w-0 items-center gap-1">
          <ChevronRight className="size-2.5 shrink-0 opacity-60" aria-hidden="true" />
          <BreadcrumbSelect
            label={s.name}
            density="compact"
            ariaLabel={`Browse siblings of ${s.name}`}
            ariaCurrent={s === current ? 'location' : undefined}
            onNavigate={() => onJump(s.line)}
            items={items(symbolSiblings(docSymbols, symbolPath, i))}
            searchPlaceholder="Filter symbols…"
          />
        </li>
      ))}
      {children.length > 0 && (
        <li className="flex min-w-0 items-center gap-1">
          <ChevronRight className="size-2.5 shrink-0 opacity-60" aria-hidden="true" />
          <BreadcrumbSelect
            label="…"
            density="compact"
            ariaLabel={`Browse children of ${current!.name}`}
            items={items(children)}
            searchPlaceholder="Filter symbols…"
          />
        </li>
      )}
    </WorkbenchBreadcrumb>
  )
}
