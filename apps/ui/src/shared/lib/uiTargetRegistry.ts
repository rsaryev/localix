import { animateScroll } from './animateScroll'
import { prefersReducedMotion } from '@localixai/kit/environment'

export interface UiRevealOptions {
  behavior?: ScrollBehavior
  block?: ScrollLogicalPosition
  focus?: boolean
  flashClassName?: string
  timeoutMs?: number
}

interface PendingReveal {
  options: Required<UiRevealOptions>
  deadline: number
  settle: (revealed: boolean) => void
  retryTimer: number
  settled: boolean
  materializersStarted: Set<string>
}

const targets = new Map<string, Set<HTMLElement>>()
const pending = new Map<string, Set<PendingReveal>>()
const materializers = new Map<string, UiTargetMaterializer>()

export interface UiTargetMaterializer {
  /** Stable owner id, used to avoid repeating expensive preparation per reveal. */
  id: string
  supports(uri: string): boolean
  /**
   * Mount, expand, load, or virtually scroll the target into the rendered DOM.
   * Concrete element registration remains the success condition.
   */
  materialize(uri: string): void | Promise<void>
}

/**
 * `behavior` is deliberately absent here and resolved per call in
 * {@link revealUiTarget}: an EXPLICIT behavior option beats the
 * `scroll-behavior: auto !important` reduced-motion rule in index.css, so a
 * module-init `'smooth'` would smooth-scroll users who asked for no motion —
 * and would freeze whatever the preference happened to be at import time.
 */
const DEFAULT_REVEAL: Omit<Required<UiRevealOptions>, 'behavior'> = {
  block: 'center',
  focus: true,
  flashClassName: 'lx-target-reveal',
  timeoutMs: 5000,
}

function visible(element: HTMLElement): boolean {
  if (!element.isConnected) return false
  let current: HTMLElement | null = element
  while (current) {
    const style = window.getComputedStyle(current)
    if (style.display === 'none' || style.visibility === 'hidden') return false
    current = current.parentElement
  }
  return true
}

function scrollTarget(element: HTMLElement, options: Required<UiRevealOptions>): void {
  const container = element.closest<HTMLElement>('[data-ui-scroll-container]')
  if (container && container.clientHeight > 0) {
    const targetRect = element.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    const align =
      options.block === 'start'
        ? 0
        : options.block === 'end'
          ? container.clientHeight - targetRect.height
          : (container.clientHeight - targetRect.height) / 2
    const top = container.scrollTop + targetRect.top - containerRect.top - Math.max(0, align)
    // Our own animation rather than `scrollTo({ behavior: 'smooth' })`: the browser's
    // duration is the same for a one-row hop and a ten-screen jump, and it has no way to
    // teleport the long ones. See `animateScroll`.
    animateScroll({ container, top, instant: options.behavior !== 'smooth' })
  } else {
    element.scrollIntoView({
      behavior: options.behavior,
      block: options.block,
      inline: 'nearest',
    })
  }

  if (options.focus) element.focus({ preventScroll: true })
  if (options.flashClassName) {
    element.classList.add(options.flashClassName)
    window.setTimeout(() => element.classList.remove(options.flashClassName), 1400)
  }
}

function targetFor(uri: string): HTMLElement | null {
  const candidates = targets.get(uri)
  if (!candidates) return null
  return Array.from(candidates).reverse().find(visible) ?? null
}

function finish(uri: string, item: PendingReveal, revealed: boolean): void {
  if (item.settled) return
  item.settled = true
  if (item.retryTimer) window.clearTimeout(item.retryTimer)
  const items = pending.get(uri)
  items?.delete(item)
  if (items?.size === 0) pending.delete(uri)
  item.settle(revealed)
}

function startMaterializers(uri: string, item: PendingReveal): void {
  for (const materializer of materializers.values()) {
    if (item.materializersStarted.has(materializer.id) || !materializer.supports(uri)) continue
    item.materializersStarted.add(materializer.id)
    void Promise.resolve(materializer.materialize(uri))
      .catch(() => undefined)
      .then(() => attempt(uri, item))
  }
}

function attempt(uri: string, item: PendingReveal): void {
  if (item.settled) return
  const element = targetFor(uri)
  if (element) {
    requestAnimationFrame(() => {
      if (!visible(element)) {
        // No deadline check is needed on this path: `targetFor` only returns a VISIBLE
        // candidate, so an element that fails here fails that filter on the next attempt
        // too, which lands on the no-element branch below and its deadline. One extra
        // frame, not a spin.
        attempt(uri, item)
        return
      }
      scrollTarget(element, item.options)
      finish(uri, item, true)
    })
    return
  }
  startMaterializers(uri, item)
  if (Date.now() >= item.deadline) {
    finish(uri, item, false)
    return
  }
  item.retryTimer = window.setTimeout(() => attempt(uri, item), 50)
}

/**
 * Register a surface-specific preparation step. This is the generic bridge for
 * targets not currently in the DOM: virtualized rows, collapsed trees, lazy
 * tabs, and paged lists can materialize themselves without entering the
 * navigation kernel.
 */
export function registerUiTargetMaterializer(materializer: UiTargetMaterializer): () => void {
  materializers.set(materializer.id, materializer)
  for (const [uri, items] of pending) {
    if (!materializer.supports(uri)) continue
    for (const item of items) startMaterializers(uri, item)
  }
  return () => {
    if (materializers.get(materializer.id) === materializer) materializers.delete(materializer.id)
  }
}

/**
 * Register one concrete UI element under its canonical resource URI. Any reveal
 * already requested for that URI is retried immediately; registration order is
 * otherwise irrelevant.
 */
export function registerUiTarget(uri: string, element: HTMLElement): () => void {
  const normalized = uri.trim()
  if (!normalized) return () => {}
  const entries = targets.get(normalized) ?? new Set<HTMLElement>()
  entries.add(element)
  targets.set(normalized, entries)
  element.dataset.uiTarget = normalized
  for (const item of pending.get(normalized) ?? []) attempt(normalized, item)

  return () => {
    entries.delete(element)
    if (element.dataset.uiTarget === normalized) delete element.dataset.uiTarget
    if (entries.size === 0) targets.delete(normalized)
  }
}

/**
 * Reveal an addressable UI element, waiting for asynchronous surface mounting,
 * scope changes, registry fetches, and hidden-tab activation.
 */
export function revealUiTarget(uri: string, options: UiRevealOptions = {}): Promise<boolean> {
  const normalized = uri.trim()
  if (!normalized || typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.resolve(false)
  }
  const resolvedOptions: Required<UiRevealOptions> = {
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    ...DEFAULT_REVEAL,
    ...options,
  }
  return new Promise((settle) => {
    const item: PendingReveal = {
      options: resolvedOptions,
      deadline: Date.now() + resolvedOptions.timeoutMs,
      settle,
      retryTimer: 0,
      settled: false,
      materializersStarted: new Set(),
    }
    const items = pending.get(normalized) ?? new Set<PendingReveal>()
    items.add(item)
    pending.set(normalized, items)
    attempt(normalized, item)
  })
}

/** Fire-and-forget entry point used by the navigation kernel. */
export function requestUiReveal(uri: string, options?: UiRevealOptions): void {
  void revealUiTarget(uri, options)
}

/** Test-only reset for the process-local registry. */
export function __resetUiTargets(): void {
  for (const [uri, items] of pending) {
    for (const item of items) finish(uri, item, false)
  }
  pending.clear()
  targets.clear()
  materializers.clear()
}
