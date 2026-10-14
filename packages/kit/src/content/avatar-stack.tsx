/**
 * Several identities in the footprint of one avatar.
 *
 * A room heading has no single face. Listing every member's avatar in a row would give a
 * six-member room a heading six tiles wide and break the fixed-height list rows around it, so
 * the tiles OVERLAP and the list is CAPPED: past the cap, one more tile says how many are left.
 *
 * The cap is a layout fact, not a product one — it is the number of overlapping tiles that
 * still read as distinct at this size. Callers that need every member name it beside the stack.
 */
import { MonogramAvatar } from './monogram-avatar'

export interface AvatarStackProps {
  /** Stable identities (agent handles) — the colour of each tile. */
  identities: readonly string[]
  /** Display names, positionally matched; falls back to the identity. */
  labels?: readonly string[]
  size?: number
  /** Tiles shown before the overflow tile takes the rest. */
  max?: number
  className?: string
}

export function AvatarStack({
  identities,
  labels,
  size = 22,
  max = 3,
  className,
}: AvatarStackProps) {
  const shown = identities.slice(0, max)
  const rest = identities.length - shown.length
  // Each tile after the first is pulled back by a third of its width: enough overlap to read as
  // one object, little enough that every face stays visible.
  const overlap = Math.round(size / 3)
  return (
    <span
      className={`inline-flex shrink-0 items-center ${className ?? ''}`}
      // The stack's width is what the layout reserves; computed so a row never reflows when
      // membership changes between two and six.
      style={{ width: size + (shown.length - 1 + (rest > 0 ? 1 : 0)) * (size - overlap) }}
      aria-hidden="true"
    >
      {shown.map((identity, index) => (
        <span
          key={identity}
          className="rounded-md ring-2 ring-sidebar"
          style={{ marginLeft: index === 0 ? 0 : -overlap, zIndex: shown.length - index }}
        >
          <MonogramAvatar identity={identity} label={labels?.[index] ?? identity} size={size} />
        </span>
      ))}
      {rest > 0 ? (
        <span
          className="flex items-center justify-center rounded-md bg-sidebar-accent font-mono text-2xs text-sidebar-foreground/70 ring-2 ring-sidebar tabular-nums"
          style={{ width: size, height: size, marginLeft: -overlap }}
        >
          +{rest}
        </span>
      ) : null}
    </span>
  )
}
