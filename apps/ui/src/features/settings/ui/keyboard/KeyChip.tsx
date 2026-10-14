import { cn } from '@localixai/plugin-sdk/ui/classes'
import { Kbd } from '@localixai/kit/kbd'
import { chordToTokens, type Chord } from '@/shared/lib/keybindings'

/**
 * Renders a chord as a row of small keycap chips (⌘ ⇧ O), platform-aware via the
 * chord engine — the shared Kbd primitive with a filled/larger override. An
 * unassigned chord shows a muted "Unassigned" placeholder.
 */
export function KeyChip({ chord, muted = false }: { chord: Chord; muted?: boolean }) {
  const tokens = chordToTokens(chord)
  if (tokens.length === 0) {
    return <span className="text-2xs text-text-faint">Unassigned</span>
  }
  return (
    <span className="inline-flex items-center gap-1">
      {tokens.map((t) => (
        <Kbd
          key={t}
          variant={muted ? 'default' : 'filled'}
          className={cn(
            // Sizing only — the token families (border/bg/text) come from the Kbd
            // primitive so the settings keycaps can't drift from the app baseline.
            'inline-flex min-w-5 items-center justify-center rounded-md px-1.5 py-0.5 text-2xs font-medium tabular-nums',
            muted ? 'text-text-soft' : 'text-foreground',
          )}
        >
          {t}
        </Kbd>
      ))}
    </span>
  )
}
