import { confirmAndOpenExternal, confirmExternalHandoff } from './externalLink'
import { tauriInvoke, tauriListen, type InvokeFn, type ListenFn } from './tauri'

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
    open: (url: string, systemBrowser?: boolean) => void
    requestOpen: (url: string, systemBrowser?: boolean) => Promise<boolean>
  }
  desktop: {
    invoke: <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T> | null
    /** The native command bridge, for a caller that issues several commands; none on the web. */
    invoker: () => InvokeFn | undefined
    /** The native event bridge; none on the web. */
    listener: () => ListenFn | undefined
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
    // Every host and mini app surface shares the same routing and OS confirmation policy.
    open: confirmAndOpenExternal,
    requestOpen: confirmExternalHandoff,
  },
  desktop: {
    invoke: <T>(command: string, args?: Record<string, unknown>) => {
      const invoke = tauriInvoke()
      return invoke ? (invoke(command, args) as Promise<T>) : null
    },
    invoker: tauriInvoke,
    listener: tauriListen,
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
  const external = { ...active.external, ...overrides.external }
  const open = overrides.external?.open
  // Existing hosts supply a fire-and-forget opener. Preserve that adapter for workflows too.
  if (open && !overrides.external?.requestOpen) {
    external.requestOpen = async (url, systemBrowser) => {
      await open(url, systemBrowser)
      return true
    }
  }
  active = {
    clipboard: { ...active.clipboard, ...overrides.clipboard },
    navigation: { ...active.navigation, ...overrides.navigation },
    external,
    desktop: { ...active.desktop, ...overrides.desktop },
  }
  return () => {
    active = previous
  }
}

export function resetPlatformCapabilities(): void {
  active = defaults
}
