/**
 * Shared theme-variable bridge for sandboxed iframes (plugin panels, the
 * visual-feedback preview probe).
 *
 * Each live frame needs the host's CSS custom properties forwarded into its
 * sandboxed iframe, and re-forwarded whenever the theme changes. Doing this
 * per-frame meant N MutationObservers each running an expensive 29×
 * getComputedStyle read on every theme toggle. This module installs a SINGLE
 * observer on the effective appearance and preset identity, reads the vars once
 * per change, caches them, and fans the cached object out to every subscriber.
 * Both attributes matter: switching between two dark presets leaves
 * `data-theme="dark"` unchanged.
 */

import { HOST_THEME_VARIABLES } from '@localixai/plugin-sdk/ui'

/** Host CSS vars forwarded into sandboxed iframes. */
const HOST_VARS = HOST_THEME_VARIABLES

export type ThemeVars = Record<string, string>

function readHostVarsObject(): ThemeVars {
  const style = getComputedStyle(document.documentElement)
  const result: ThemeVars = {}
  for (const v of HOST_VARS) {
    const val = style.getPropertyValue(v).trim()
    if (val) result[v] = val
  }
  return result
}

type Listener = (vars: ThemeVars) => void

const listeners = new Set<Listener>()
let cached: ThemeVars | null = null
let observer: MutationObserver | null = null

/** Current host vars, read (and cached) on first access. */
export function getThemeVars(): ThemeVars {
  if (!cached) cached = readHostVarsObject()
  return cached
}

function refreshAndBroadcast(): void {
  cached = readHostVarsObject()
  for (const listener of listeners) {
    try {
      listener(cached)
    } catch {
      /* ignore listener errors */
    }
  }
}

export const themeVarsBus = {
  /** Subscribe to theme-var changes. Returns an unsubscribe function. */
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    if (!observer) {
      observer = new MutationObserver(refreshAndBroadcast)
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme', 'data-theme-preset'],
      })
    }
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0 && observer) {
        observer.disconnect()
        observer = null
      }
    }
  },
}
