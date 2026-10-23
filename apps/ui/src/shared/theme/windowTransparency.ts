/**
 * How much of the desktop shows through the workspace — a device preference beside the theme.
 *
 * The coats themselves live in `packages/kit/styles/window-material.css`: each level is one
 * attribute on `<html>` that scales the theme's tuned densities, so a level never restates a
 * colour. `standard` is the tuned look and is stored as an absent key, which lets a future change
 * of default reach everyone who never chose. The index.html boot script stamps the same attribute
 * before first paint, so a reload does not flash the standard coat.
 */

import { useSyncExternalStore } from 'react'
import { loadString, saveString } from '@localixai/mini-app-sdk/ui/storage'

export const WINDOW_TRANSPARENCY_STORAGE_KEY = 'localix.window.transparency'

/** Ordered from opaque to clearest, the order the Preferences slider shows them in. */
export const WINDOW_TRANSPARENCY_LEVELS = ['off', 'low', 'standard', 'high'] as const

export type WindowTransparency = (typeof WINDOW_TRANSPARENCY_LEVELS)[number]

export const DEFAULT_WINDOW_TRANSPARENCY: WindowTransparency = 'standard'

/** Each level's name wherever it is offered: the Preferences slider and the welcome tip. */
export const WINDOW_TRANSPARENCY_LABELS: Record<WindowTransparency, string> = {
  off: 'Off',
  low: 'Low',
  standard: 'Standard',
  high: 'High',
}

/** Narrow an unknown persisted value; anything foreign falls back to the default. */
export function parseWindowTransparency(raw: string | null): WindowTransparency {
  return WINDOW_TRANSPARENCY_LEVELS.includes(raw as WindowTransparency)
    ? (raw as WindowTransparency)
    : DEFAULT_WINDOW_TRANSPARENCY
}

/** Stamp the level on `<html>`; the standard level is the absence of the attribute. */
export function applyWindowTransparencyToDom(level: WindowTransparency): void {
  const root = document.documentElement
  if (level === DEFAULT_WINDOW_TRANSPARENCY) delete root.dataset.windowTransparency
  else root.dataset.windowTransparency = level
}

let level: WindowTransparency =
  typeof window === 'undefined'
    ? DEFAULT_WINDOW_TRANSPARENCY
    : parseWindowTransparency(loadString(WINDOW_TRANSPARENCY_STORAGE_KEY))
const listeners = new Set<() => void>()
let afterApply: (() => void) | undefined

/**
 * Run after every applied change. The theme module registers the native chrome resync here: the
 * macOS titlebar is tinted from `--sidebar`, which this level just changed. A registration rather
 * than an import keeps this module free of the Tauri bridge.
 */
export function onWindowTransparencyApplied(callback: () => void): void {
  afterApply = callback
}

function commit(next: WindowTransparency): void {
  level = next
  applyWindowTransparencyToDom(next)
  afterApply?.()
  for (const fn of listeners) fn()
}

export function getWindowTransparency(): WindowTransparency {
  return level
}

export function setWindowTransparency(next: WindowTransparency): void {
  if (next === level) return
  saveString(WINDOW_TRANSPARENCY_STORAGE_KEY, next === DEFAULT_WINDOW_TRANSPARENCY ? null : next)
  commit(next)
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function useWindowTransparency(): WindowTransparency {
  return useSyncExternalStore(subscribe, getWindowTransparency, getWindowTransparency)
}

if (typeof window !== 'undefined') {
  applyWindowTransparencyToDom(level)
  // Every workspace window has its own webview and store; follow a choice made in another one.
  const onStored = (event: StorageEvent) => {
    if (event.key !== WINDOW_TRANSPARENCY_STORAGE_KEY && event.key !== null) return
    const stored = parseWindowTransparency(loadString(WINDOW_TRANSPARENCY_STORAGE_KEY))
    if (stored !== level) commit(stored)
  }
  window.addEventListener('storage', onStored)
  import.meta.hot?.dispose(() => window.removeEventListener('storage', onStored))
}
