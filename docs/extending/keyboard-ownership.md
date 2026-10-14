# Keyboard ownership

Controls and native editors receive a key before workspace shortcuts. A component's `onKeyDown`
handler calls `preventDefault()` when it handles the key, or `stopPropagation()` when the event must
stay local. The host then dispatches unclaimed commands.

For commands spanning a native plugin pane, use `useFocusEntry` from
`@localixai/plugin-sdk/ui/focus` with a unique instance ID, the pane's live DOM `scope`, and its
visibility flag. A mounted pane receives only events whose DOM path includes its scope.

```tsx
import { useId, useRef, type ReactNode } from 'react'
import { useFocusEntry } from '@localixai/plugin-sdk/ui/focus'
import { matchesChord } from '@localixai/kit/keybindings'

export function PluginPane({
  visible,
  hasSelection,
  closeLocalSelection,
  children,
}: {
  visible: boolean
  hasSelection: boolean
  closeLocalSelection: () => void
  children: ReactNode
}) {
  const root = useRef<HTMLDivElement>(null)
  const id = useId()
  useFocusEntry({
    id: `my-pane:${id}`,
    kind: 'surface',
    active: visible,
    scope: () => root.current,
    onKeyDown: (event) => {
      if (!hasSelection || !matchesChord(event, 'escape')) return
      event.preventDefault()
      closeLocalSelection()
      return true
    },
  })
  return (
    <div ref={root} hidden={!visible}>
      {children}
    </div>
  )
}
```

Attach `root` to the pane element. Return `true` only when the pane claims the key. Leave typing and
caret shortcuts to editable descendants. Prefer the shared `matchesChord` helper from
`@localixai/kit/keybindings` for exact, platform-aware modifier matching.

The host skips IME composition and AltGr input. Shared kit dialogs and menus isolate their own
keyboard scope: a focused field inside a dialog does not re-enable workspace commands behind it. Use
an unscoped claim only for ownership that intentionally covers the whole workspace, such as a modal.
Do not install command listeners on `window` or `document`.

Nested pane claims are offered from the innermost DOM scope outward until one handles the key.
Claims with the same scope prefer the latest registration. Modal claims stop fallback to surfaces
underneath them. Cleanup releases a claim when its component unmounts or becomes inactive, and
handlers and scope getters read current component values.

## Choose the global shortcut policy

The `kind` selects a default policy for workspace shortcuts after local handlers have declined:

| Kind                        | Plain workspace keys | Workspace modifier chords |
| --------------------------- | -------------------- | ------------------------- |
| `surface`                   | Allowed              | Allowed                   |
| `text-input`, `editor`      | Blocked              | Allowed                   |
| `dialog`, `menu`, `overlay` | Blocked              | Blocked                   |

`keyboard` can override those booleans. Policies combine restrictively across applicable claims;
registering a field above a modal cannot reopen shortcuts behind it. Overlay-like kinds remain
barriers to the surface-handler walk even when their policy is overridden.

A scope getter returning `null` owns no event. Portalled content outside the pane root is outside
that scope; use the kit's overlay ownership for dialogs and menus rather than assuming the pane
claim covers them. This hook applies to native DOM plugin panes; sandboxed iframe views have a
separate [host boundary](sandboxed-views.md).

See [Keyboard shortcuts](../features/keyboard-shortcuts.md) for user-facing focus behavior.

## Source of truth

- [Hook lifetime and current values](https://github.com/rsaryev/localix/blob/main/packages/plugin-sdk/src/ui/focus/useFocusEntry.ts)
- [Scope routing and modal barriers](https://github.com/rsaryev/localix/blob/main/packages/plugin-sdk/src/ui/focus/store.ts)
- [Default key policies](https://github.com/rsaryev/localix/blob/main/packages/plugin-sdk/src/ui/focus/types.ts)
- [Exact chord matching](https://github.com/rsaryev/localix/blob/main/packages/kit/src/keyboard/chord.ts)
