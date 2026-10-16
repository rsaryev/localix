import { useEffect, useState } from 'react'

/**
 * Roving tabindex + arrow-key navigation for tree sidebars.
 *
 * A tree is ONE Tab stop: every row renders `tabIndex={-1}` except the current
 * roving target (last focused row, falling back to the first visible row),
 * which renders `tabIndex={0}`. Arrow keys move focus across the visible rows;
 * Tab/Shift-Tab leaves the tree entirely.
 *
 * Rows are identified by a `data-tree-path` attribute ON THE FOCUSABLE element
 * (DOM order of `[data-tree-path]` = rendered tree order). Directory rows carry
 * `aria-expanded`; leaf rows don't — that's how the key handler tells them apart.
 */

const ROW_SELECTOR = '[data-tree-path]'

const rowPathOf = (target: EventTarget | null): string | undefined =>
  target instanceof Element
    ? target.closest<HTMLElement>(ROW_SELECTOR)?.dataset.treePath
    : undefined

/**
 * Tracks the roving-tabindex target for a tree container. Focus moves (arrow
 * keys, clicks) update the target via the delegated `onFocus`; when the
 * remembered row vanishes from the DOM (collapsed, filtered, deleted), the
 * target falls back to the first visible row so the tree always keeps exactly
 * one Tab stop. Attach the returned `attachContainer` CALLBACK ref to the tree
 * container (merge it when the caller keeps its own ref) — a callback ref, not
 * a RefObject, so a conditionally-mounted container re-arms the observer.
 */
export function useTreeRovingFocus() {
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const [rovingPath, setRovingPath] = useState<string | null>(null)

  // Validate the remembered row against the real DOM whenever rows appear or
  // disappear (the render inputs — filters, expansion, loaded children — are
  // spread across several structures; the DOM is the single source of truth
  // for "visible"). Functional setState keeps the observer closure fresh.
  useEffect(() => {
    if (!container) return
    const validate = () =>
      setRovingPath((current) => {
        if (current && container.querySelector(`[data-tree-path="${CSS.escape(current)}"]`))
          return current
        return container.querySelector<HTMLElement>(ROW_SELECTOR)?.dataset.treePath ?? null
      })
    validate()
    const observer = new MutationObserver(validate)
    observer.observe(container, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [container])

  /** Callback ref for the tree container element. */
  const attachContainer = (el: HTMLElement | null) => {
    setContainer(el)
  }

  /** Delegated focus handler for the tree container (focus events bubble in React). */
  const onFocus = (e: React.FocusEvent) => {
    const path = rowPathOf(e.target)
    if (path) setRovingPath(path)
  }

  /** tabIndex for a row: 0 only on the roving target. */
  const tabIndexFor = (path: string): 0 | -1 => (path === rovingPath ? 0 : -1)

  return { attachContainer, onFocus, tabIndexFor }
}

/**
 * Delegated keydown handler for tree navigation, attached to the tree
 * container. Up/Down move focus across the visible rows, Home/End jump to the
 * first/last row, Right expands a collapsed dir (or steps into an open one),
 * Left collapses an open dir (or jumps to the parent row). Ignores keys when
 * focus isn't on a `[data-tree-path]` row (e.g. an inline rename input).
 */
export function treeNavKeyDown(
  e: React.KeyboardEvent<HTMLElement>,
  opts: {
    /** Toggle a directory row open/closed. */
    toggleDir: (path: string) => void
    /** Parent ROW path for ArrowLeft on a leaf/collapsed row; null = at top level. */
    parentOf: (path: string) => string | null
  },
): void {
  const key = e.key
  if (
    key !== 'ArrowUp' &&
    key !== 'ArrowDown' &&
    key !== 'ArrowLeft' &&
    key !== 'ArrowRight' &&
    key !== 'Home' &&
    key !== 'End'
  )
    return
  const container = e.currentTarget
  const row = (e.target as HTMLElement).closest<HTMLElement>(ROW_SELECTOR)
  const path = row?.dataset.treePath
  if (!row || !path) return
  e.preventDefault() // suppress container scroll; focus() scrolls into view
  const rows = Array.from(container.querySelectorAll<HTMLElement>(ROW_SELECTOR))
  const idx = rows.indexOf(row)
  if (key === 'Home' || key === 'End') {
    rows[key === 'Home' ? 0 : rows.length - 1]?.focus()
    return
  }
  if (key === 'ArrowUp' || key === 'ArrowDown') {
    rows[idx + (key === 'ArrowDown' ? 1 : -1)]?.focus()
    return
  }
  // Dirs carry aria-expanded; leaves don't.
  const expandedAttr = row.getAttribute('aria-expanded')
  if (key === 'ArrowRight') {
    if (expandedAttr === 'false') opts.toggleDir(path)
    else if (expandedAttr === 'true') rows[idx + 1]?.focus() // into first child
    return
  }
  // ArrowLeft: collapse an open dir, else jump to the parent row.
  if (expandedAttr === 'true') {
    opts.toggleDir(path)
    return
  }
  // Walk up until an actually-rendered row (trees may compress path segments).
  for (let parent = opts.parentOf(path); parent; parent = opts.parentOf(parent)) {
    const el = container.querySelector<HTMLElement>(`[data-tree-path="${CSS.escape(parent)}"]`)
    if (el) {
      el.focus()
      return
    }
  }
}
