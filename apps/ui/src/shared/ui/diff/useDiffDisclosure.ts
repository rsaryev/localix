import { useCallback, useRef, useState } from 'react'
import type { DiffDocument } from './document/diffDocument'
import { isLargeFile } from './document/diffRows'

/** Large files start collapsed only where there is something else to read. */
function defaultCollapsed(doc: DiffDocument, multiFile: boolean, large: boolean): Set<number> {
  if (!large || !multiFile || doc.files.length < 2) return new Set()
  return new Set(doc.files.flatMap((file, id) => (isLargeFile(file) ? [id] : [])))
}

/**
 * The disclosure boundary is the file LIST, not the document object: a stream or a
 * staging refresh rebuilds the document on every change, and resetting on identity
 * threw the reader's expand/collapse choices away each time.
 */
const fileSignature = (doc: DiffDocument) => doc.files.map((file) => file.path).join('\0')

/**
 * Which files of a multi-file diff are collapsed, plus the file whose header must be
 * revealed after a toggle: collapsing a file from its PINNED header, deep inside it,
 * would otherwise leave the scroll offset pointing into whatever file slid up underneath.
 */
export function useDiffDisclosure(doc: DiffDocument, multiFile: boolean, collapseLarge: boolean) {
  const signature = fileSignature(doc)
  const [disclosure, setDisclosure] = useState<{ signature: string; collapsed: Set<number> }>(
    () => ({ signature, collapsed: defaultCollapsed(doc, multiFile, collapseLarge) }),
  )
  let collapsed: ReadonlySet<number> = disclosure.collapsed
  if (disclosure.signature !== signature) {
    const next = { signature, collapsed: defaultCollapsed(doc, multiFile, collapseLarge) }
    collapsed = next.collapsed
    setDisclosure(next)
  }
  const revealFile = useRef<number | null>(null)
  const toggleFile = useCallback(
    (file: number) =>
      setDisclosure((prev) => {
        revealFile.current = file
        const next = new Set(prev.collapsed)
        if (!next.delete(file)) next.add(file)
        return { signature: prev.signature, collapsed: next }
      }),
    [],
  )
  return { collapsed, toggleFile, revealFile }
}
