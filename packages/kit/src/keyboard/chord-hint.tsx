import { chordToTokens } from './chord'
import { useCommandChord } from './chord-store'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { Kbd } from './kbd'

/**
 * Right-aligned keyboard-chord hint for a menu row. Resolves the command's LIVE
 * binding through the registry (so a rebind reflects here) and renders it as
 * small, faint keycap chips — the same visual language as the HITL confirm
 * footer. Renders nothing when the command has no bound chord, so an unbound
 * action never gains a stray hint.
 *
 * Kept in `shared/ui` (not the settings feature) so any menu — file-tree
 * context menu, editor tab menu, the command palette — can annotate its rows
 * from one source without a same-layer cross-import. `chipClassName` lets a
 * surface (e.g. the palette) restyle the individual keycaps without forking the
 * token-rendering loop.
 */
export function ChordHint({
  commandId,
  className,
  chipClassName,
  chipVariant,
}: {
  commandId: string
  className?: string
  chipClassName?: string
  /** Kbd variant for the keycaps — `filled` for the raised palette-style chips. */
  chipVariant?: 'default' | 'filled'
}) {
  const tokens = chordToTokens(useCommandChord(commandId))
  if (tokens.length === 0) return null
  return (
    <span className={cn('ml-auto flex shrink-0 items-center gap-0.5 pl-6', className)}>
      {tokens.map((t) => (
        <Kbd key={t} variant={chipVariant} className={chipClassName}>
          {t}
        </Kbd>
      ))}
    </span>
  )
}
