import { useCallback, useRef, useState, type DragEvent as ReactDragEvent } from 'react'
import { isPathDrop, pathTextFromDrop } from './terminalPathDrop'

/**
 * Dropping a file onto the terminal pastes its shell-quoted PATH at the prompt.
 * Never run — the text arrives without a trailing newline, so it lands on
 * the prompt for the user to complete.
 *
 * The knowledge here is the DEPTH COUNT. `dragenter`/`dragleave` fire for every nested
 * child the cursor crosses, so a naive `dragleave -> hide` flickers the overlay off the
 * moment the pointer moves from the pane onto the xterm canvas inside it. Counting
 * enter/leave pairs and only hiding at zero makes the overlay track the PANE, not
 * whatever element happens to be under the cursor.
 *
 * `paste` is passed as a getter, not a value: the paste function only exists once xterm
 * has been created, which happens after these handlers are already bound.
 */
export function useTerminalPathDrop(paste: () => ((text: string) => void) | null) {
  const [active, setActive] = useState(false)
  const depth = useRef(0)

  const onDragEnter = useCallback((e: ReactDragEvent) => {
    if (!isPathDrop(e.dataTransfer.types)) return
    e.preventDefault()
    depth.current += 1
    setActive(true)
  }, [])

  const onDragOver = useCallback((e: ReactDragEvent) => {
    if (!isPathDrop(e.dataTransfer.types)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const onDragLeave = useCallback((e: ReactDragEvent) => {
    if (!isPathDrop(e.dataTransfer.types)) return
    depth.current = Math.max(0, depth.current - 1)
    if (depth.current === 0) setActive(false)
  }, [])

  const onDrop = useCallback(
    (e: ReactDragEvent) => {
      if (!isPathDrop(e.dataTransfer.types)) return
      e.preventDefault()
      depth.current = 0
      setActive(false)
      const text = pathTextFromDrop(e.dataTransfer)
      if (text) paste()?.(text)
    },
    [paste],
  )

  return { active, handlers: { onDragEnter, onDragOver, onDragLeave, onDrop } }
}
