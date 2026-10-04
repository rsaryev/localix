import { confirmAndOpenExternal } from './externalLink'
import { tauriInvoke } from './tauri'

export interface PlatformCapabilities {
  clipboard: {
    writeText: (text: string) => Promise<boolean>
    readText: () => Promise<string | null>
    writeBlob: (blob: Blob, mediaType?: string) => Promise<boolean>
  }
  navigation: {
    reload: () => void
  }
  external: {
    open: (url: string) => void
  }
  desktop: {
    invoke: <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T> | null
  }
}

export interface PlatformCapabilityOverrides {
  clipboard?: Partial<PlatformCapabilities['clipboard']>
  navigation?: Partial<PlatformCapabilities['navigation']>
  external?: Partial<PlatformCapabilities['external']>
  desktop?: Partial<PlatformCapabilities['desktop']>
}

const defaults: PlatformCapabilities = {
  clipboard: {
    // All three clipboard ports answer with `false` rather than throwing. The type
    // says `Promise<boolean>` and callers branch on the boolean, so a rejection —
    // which `navigator.clipboard` really does produce for a denied or unfocused
    // document — reached them as an unhandled rejection instead of the "no" the
    // signature promises. `readText` already guarded; the writers did not.
    async writeText(text) {
      try {
        if (!navigator.clipboard?.writeText) return false
        await navigator.clipboard.writeText(text)
        return true
      } catch {
        return false
      }
    },
    async readText() {
      try {
        if (!navigator.clipboard?.readText) return null
        return await navigator.clipboard.readText()
      } catch {
        return null
      }
    },
    async writeBlob(blob, mediaType = blob.type || 'application/octet-stream') {
      try {
        if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return false
        await navigator.clipboard.write([new ClipboardItem({ [mediaType]: blob })])
        return true
      } catch {
        return false
      }
    },
  },
  navigation: {
    reload: () => window.location.reload(),
  },
  external: {
    // Confirm FIRST, then hand the URL to the OS browser. Every layer reaches
    // this one port — plugins via `pluginExternal`, plus the reader, terminal
    // links, Markdown, `ExternalAnchor`, the preview toolbar and the OAuth flows
    // — so the question is asked once here rather than per surface.
    open: confirmAndOpenExternal,
  },
  desktop: {
    invoke: <T>(command: string, args?: Record<string, unknown>) => {
      const invoke = tauriInvoke()
      return invoke ? (invoke(command, args) as Promise<T>) : null
    },
  },
}

let active: PlatformCapabilities = defaults

/** Imperative read keeps event handlers framework-agnostic and always sees test overrides. */
export function platformCapabilities(): PlatformCapabilities {
  return active
}

/**
 * Install host/test overrides and return a cleanup restoring the previous port.
 * Nested capability groups merge, so a test can replace one operation only.
 */
export function configurePlatformCapabilities(overrides: PlatformCapabilityOverrides): () => void {
  const previous = active
  active = {
    clipboard: { ...active.clipboard, ...overrides.clipboard },
    navigation: { ...active.navigation, ...overrides.navigation },
    external: { ...active.external, ...overrides.external },
    desktop: { ...active.desktop, ...overrides.desktop },
  }
  return () => {
    active = previous
  }
}

export function resetPlatformCapabilities(): void {
  active = defaults
}
