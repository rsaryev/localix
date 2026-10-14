import { useEffect, useRef, type RefObject } from 'react'

/** Native Edit menu commands follow the focused editor or board before DOM text editing. */
export type NativeEditCommand = 'undo' | 'redo' | 'select_all'
type EditTarget = (command: NativeEditCommand) => boolean
const targets = new Set<EditTarget>()

export function registerNativeEditTarget(target: EditTarget): () => void {
  targets.add(target)
  return () => {
    targets.delete(target)
  }
}

/** Keep the latest actions registered without moving ownership away from DOM text fields. */
export function useNativeEditTarget(
  root: RefObject<HTMLElement | null>,
  run: (command: NativeEditCommand) => void,
) {
  const latest = useRef(run)
  latest.current = run
  useEffect(
    () =>
      registerNativeEditTarget((command) => {
        const focused = document.activeElement
        if (
          !root.current?.contains(focused) ||
          focused?.closest('input, textarea, select, [contenteditable="true"]')
        )
          return false
        latest.current(command)
        return true
      }),
    [root],
  )
}

export function runNativeEditCommand(command: string): boolean {
  if (command !== 'undo' && command !== 'redo' && command !== 'select_all') return false
  for (const target of targets) if (target(command)) return true
  const element = document.activeElement
  if (
    command === 'select_all' &&
    (element instanceof HTMLTextAreaElement ||
      (element instanceof HTMLInputElement && element.selectionStart !== null))
  )
    element.select()
  else document.execCommand(command === 'select_all' ? 'selectAll' : command)
  return true
}
