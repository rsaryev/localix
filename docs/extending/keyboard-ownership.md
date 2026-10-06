# Keyboard ownership

Controls and native editors receive a key before workspace shortcuts. A component's `onKeyDown`
handler calls `preventDefault()` when it handles the key, or `stopPropagation()` when the event must
stay local. The host then dispatches unclaimed commands.

For commands spanning a native plugin pane, use `useFocusEntry` from
`@localixai/plugin-sdk/ui/focus` with a unique instance ID, the pane's live DOM `scope`, and its
visibility flag. A mounted pane receives only events whose DOM path includes its scope.

```tsx
const root = useRef<HTMLDivElement>(null)
const id = useId()
useFocusEntry({
  id: `my-pane:${id}`,
  kind: 'surface',
  active: visible,
  scope: () => root.current,
  onKeyDown: (event) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    closeLocalSelection()
    return true
  },
})
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

See [Keyboard shortcuts](../features/keyboard-shortcuts.md) for user-facing focus behavior.
