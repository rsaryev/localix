import { spaceTypes } from '../../shared/types'
import { INSERTABLE } from '../elements'

/**
 * The board's keys as DATA — the list the shortcuts sheet (`?`) shows and `boardKeys.ts` answers.
 *
 * The table used to live only in a comment above the key handler, so ⌥A, ⌘→ or Tab-walking were
 * findable by reading the source and by nobody using the board. A comment and a sheet written
 * separately drift the day a binding changes; a list both read from cannot. `shortcuts.test.ts`
 * holds each row to the handler: a row whose keys no longer do anything fails.
 *
 * Keys are written the way `formatChordText` spells chords (`mod`, `shift`, `alt`), so the sheet
 * shows ⌘ on macOS and Ctrl elsewhere.
 */
export interface Shortcut {
  /** One or more chords that do the same, e.g. `['mod+shift+z', 'mod+y']`. */
  keys: readonly string[]
  does: string
}

export interface ShortcutGroup {
  title: string
  shortcuts: readonly Shortcut[]
}

const tools = (): Shortcut[] => [
  { keys: ['v'], does: 'Select' },
  { keys: ['h'], does: 'Hand — drag to pan (or hold Space)' },
  ...INSERTABLE.flatMap((view) =>
    view.insert?.key
      ? [{ keys: [view.insert.key], does: spaceTypes.get(view.type)?.label ?? view.type }]
      : [],
  ),
  { keys: ['q'], does: 'Keep the tool armed after placing' },
  { keys: ['escape'], does: 'Put the tool down' },
]

export function boardShortcuts(): ShortcutGroup[] {
  return [
    { title: 'Tools', shortcuts: tools() },
    {
      title: 'Find and read',
      shortcuts: [
        { keys: ['/'], does: 'Find an element by its text, path or type' },
        { keys: ['tab', 'shift+tab'], does: 'Next element in reading order, and back' },
        { keys: ['escape'], does: 'Clear a trace, leave a group, then let go of the selection' },
        { keys: ['shift+/'], does: 'This sheet' },
        { keys: ['l'], does: 'Layers' },
      ],
    },
    {
      title: 'Edit',
      shortcuts: [
        { keys: ['enter'], does: 'Edit the element, or enter the selected group' },
        { keys: ['delete', 'backspace'], does: 'Delete (a locked element stays)' },
        { keys: ['mod+z'], does: 'Undo' },
        { keys: ['mod+shift+z', 'mod+y'], does: 'Redo' },
        { keys: ['mod+d'], does: 'Duplicate' },
        { keys: ['mod+a'], does: 'Select everything that is not locked' },
        { keys: ['mod+arrowright'], does: 'A connected twin on that side (any arrow)' },
        { keys: ['arrowright', 'shift+arrowright'], does: 'Nudge 1 px, 10 px (any arrow)' },
      ],
    },
    {
      title: 'Arrange',
      shortcuts: [
        { keys: ['mod+g', 'mod+shift+g'], does: 'Group, ungroup' },
        { keys: ['mod+]', 'mod+['], does: 'Forward, backward' },
        { keys: ['mod+alt+]', 'mod+alt+['], does: 'To the front, to the back' },
        { keys: ['mod+shift+l'], does: 'Lock or unlock' },
        { keys: ['alt+a', 'alt+h', 'alt+d'], does: 'Align left, centre, right' },
        { keys: ['alt+w', 'alt+v', 'alt+s'], does: 'Align top, middle, bottom' },
        { keys: ['alt+shift+h', 'alt+shift+v'], does: 'Distribute horizontally, vertically' },
      ],
    },
    {
      title: 'Camera',
      shortcuts: [
        {
          keys: ['alt+arrowleft', 'alt+arrowright'],
          does: 'Back to the view before a jump, and forward',
        },
        { keys: ['shift+2'], does: 'The selection at 100 %; again, the whole of it' },
      ],
    },
  ]
}
