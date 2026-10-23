import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { jsonEntries, jsonKind, jsonSummary } from './jsonNodes'

const INDENT = 14

/** A single primitive value, lightly colored by type (monochrome-leaning, on-brand). */
function Primitive({ value }: { value: unknown }) {
  const kind = jsonKind(value)
  if (kind === 'string') return <span className="text-foreground">"{String(value)}"</span>
  if (kind === 'null') return <span className="italic text-text-faint">null</span>
  return <span className="text-foreground">{String(value)}</span> // number | boolean
}

function Node({
  label,
  value,
  depth,
  expandDepth,
}: {
  label?: string | number
  value: unknown
  depth: number
  expandDepth: number
}) {
  const kind = jsonKind(value)
  const branch = kind === 'object' || kind === 'array'
  const [open, setOpen] = useState(depth < expandDepth)
  const key = label != null ? <span className="text-text-soft">{label}: </span> : null

  if (!branch) {
    return (
      <div className="flex items-start gap-1" style={{ paddingLeft: depth * INDENT }}>
        <span className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 break-words">
          {key}
          <Primitive value={value} />
        </span>
      </div>
    )
  }

  const entries = jsonEntries(value)
  if (entries.length === 0) {
    return (
      <div className="flex items-start gap-1" style={{ paddingLeft: depth * INDENT }}>
        <span className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 break-words">
          {key}
          <span className="text-text-faint">{kind === 'array' ? '[]' : '{}'}</span>
        </span>
      </div>
    )
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full cursor-pointer items-start gap-1 rounded-sm text-left hover:bg-surface-hover"
        style={{ paddingLeft: depth * INDENT }}
      >
        <ChevronRight
          className={cn(
            'mt-px size-3.5 shrink-0 text-text-faint transition-transform',
            open && 'rotate-90',
          )}
        />
        <span className="min-w-0 flex-1 break-words">
          {key}
          {!open && <span className="text-text-faint">{jsonSummary(value)}</span>}
        </span>
      </button>
      {open &&
        entries.map(([k, v]) => (
          <Node key={k} label={k} value={v} depth={depth + 1} expandDepth={expandDepth} />
        ))}
    </div>
  )
}

/**
 * Collapsible, syntax-lit JSON tree — the readable alternative to a pretty-printed `<pre>` for
 * nested documents. Branches (objects/arrays) toggle open/closed; the first `expandDepth` levels
 * start expanded. Pure display, no deps beyond the shared token classes.
 */
export function JsonTree({ value, expandDepth = 2 }: { value: unknown; expandDepth?: number }) {
  return (
    <div className="font-mono text-2xs leading-relaxed text-foreground">
      <Node value={value} depth={0} expandDepth={expandDepth} />
    </div>
  )
}
