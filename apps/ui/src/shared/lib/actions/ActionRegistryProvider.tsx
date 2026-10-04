import { useEffect, type ReactNode } from 'react'

import { currentKeyPolicy, offerKeyToFocusedSurface } from '@localixai/plugin-sdk/ui/focus'
import { SHORTCUT_CATALOG } from '@/shared/lib/keybindings/catalog'
import { matchesChord } from '@localixai/kit/keybindings'
import { useKeybindingsStore } from '@/shared/lib/keybindings/store'
import { editorOwnsDefaultBinding } from '@/shared/lib/keybindings/editorKeyOwnership'
import { actionContextFromTarget } from './context'
import { executeAction } from './registry'

/**
 * One capture-phase keyboard dispatcher for registered actions. The catalog,
 * settings, command palette and handler registry now share the same command id;
 * component code registers behaviour instead of installing another global key listener.
 *
 * Before resolving a chord, the dispatcher asks the focus stack what the focused surface tolerates.
 * The inversion is what keeps this scalable: a dialog says "no global keys while I am up" once, and
 * never has to know which shortcuts exist — so adding a shortcut cannot silently start firing behind
 * a modal, and no surface accumulates a list of keys to defend against.
 */
export function ActionRegistryProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // The surface that owns the keyboard answers first. It is the only listener that knows what
      // is on screen, and letting it act here is what removes the need for a second global one.
      if (offerKeyToFocusedSurface(event)) return

      const policy = currentKeyPolicy()
      const withModifier = event.metaKey || event.ctrlKey || event.altKey
      if (withModifier ? !policy.modifierKeys : !policy.plainKeys) return

      const resolved = useKeybindingsStore.getState().resolved
      const context = actionContextFromTarget(event.target)
      const codeInputFocus =
        context.inputFocus &&
        event.target instanceof Element &&
        event.target.closest('.localix-monaco-editor') !== null
      for (const command of SHORTCUT_CATALOG) {
        const chord = resolved[command.id] ?? null
        if (!matchesChord(event, chord)) continue
        if (editorOwnsDefaultBinding(command, chord, codeInputFocus)) continue
        if (!executeAction(command.id, context, command.when)) continue
        event.preventDefault()
        event.stopPropagation()
        return
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  return children
}
