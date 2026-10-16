import { CMD, chordToTokens, useKeybindingsStore } from '@/shared/lib/keybindings'
import { Kbd } from '@localixai/kit/kbd'

/**
 * The footer every app palette shares: the sibling palettes' shortcuts, so opening one palette
 * teaches the others.
 *
 * It lives with the app, not beside the `command` primitive, because its content is the app's —
 * which palettes exist and which catalog commands open them. Inside the primitive it tied the kit
 * to the command catalog, and no kit consumer outside the app has these palettes.
 */
type PaletteKey =
  | 'files'
  | 'commands'
  | 'sessions'
  | 'symbols'
  | 'workspace-symbols'
  | 'projects'
  | 'themes'

/** Sibling palettes surfaced in the footer, in teaching-priority order. */
const PALETTE_HINTS: { key: PaletteKey; commandId: string; label: string }[] = [
  { key: 'files', commandId: CMD.goToFile, label: 'Files' },
  { key: 'commands', commandId: CMD.commandPalette, label: 'Commands' },
  { key: 'sessions', commandId: CMD.switchSession, label: 'Sessions' },
  { key: 'symbols', commandId: CMD.goToSymbol, label: 'Symbols' },
]

/**
 * `active` is the current palette's key (its own hint is omitted; at most three siblings are
 * shown). Chords resolve through the LIVE keybinding registry — a rebind reflects here — and
 * unbound commands are skipped. Monochrome, one line — pinned below the result list.
 */
export function CommandHints({ active, tip }: { active: PaletteKey; tip?: string }) {
  const resolved = useKeybindingsStore((s) => s.resolved)
  const hints = PALETTE_HINTS.filter((h) => h.key !== active)
    .map((h) => ({ ...h, tokens: chordToTokens(resolved[h.commandId] ?? null) }))
    .filter((h) => h.tokens.length > 0)
    .slice(0, 3)
  // A palette-specific usage tip shown on the right of the footer.
  const rightTip = tip ?? (active === 'files' ? 'name:line to jump' : undefined)
  return (
    <div className="flex items-center gap-3 border-t border-border-soft px-3 py-1.5 text-2xs text-text-faint">
      {hints.map((h) => (
        <span key={h.key} className="inline-flex items-center gap-1">
          <Kbd variant="filled" className="text-text-soft">
            {h.tokens.join('')}
          </Kbd>
          {h.label}
        </span>
      ))}
      {rightTip && <span className="ml-auto truncate pl-3">{rightTip}</span>}
    </div>
  )
}
