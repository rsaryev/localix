import { Kbd } from '@localixai/kit/kbd'

export interface KeyHint {
  /** The key glyph — `↵`, `⇥`, `→`. */
  key: string
  /** What it does, when the row offers more than one key. */
  label?: string
}

/**
 * The trailing "what the keys do" hint on the active row of a composer completion menu.
 *
 * Three menus wrote these as bare text (`'↵ open · → link'`), while every other shortcut hint in
 * the app is a keycap — so the one place a key hint appears most often was the one where it did
 * not look like a key. The glyphs are `Kbd` now; the whole hint stays quiet (`opacity-50`) because
 * it repeats on every keystroke and must not compete with the row it annotates.
 */
export function CompletionKeyHint({ hints }: { hints: readonly KeyHint[] }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-2xs text-text-soft opacity-50">
      {hints.map((hint, index) => (
        <span key={hint.key} className="flex items-center gap-1">
          {index > 0 && <span aria-hidden="true">·</span>}
          <Kbd>{hint.key}</Kbd>
          {hint.label}
        </span>
      ))}
    </span>
  )
}
