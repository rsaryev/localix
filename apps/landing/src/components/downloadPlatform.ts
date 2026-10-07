/**
 * Which desktop download to offer first.
 *
 * The Mac case is why this module exists. Every Mac browser reports `navigator.platform` as
 * `MacIntel` and Safari freezes its user agent at "Intel Mac OS X", so neither says which chip
 * the machine has. Reading the answer off them put one half of Mac users on the wrong DMG
 * whichever way the default pointed. So the chip comes from the two signals that do carry it,
 * in the order download pages that solved this use them (Joplin, Trilium):
 *
 * 1. UA Client Hints `architecture` (`arm` | `x86`) — authoritative, Chromium only.
 * 2. The WebGL renderer — `Apple M…` is Apple silicon, an Intel/AMD/NVIDIA GPU is an Intel Mac.
 *    Safari masks it to `Apple GPU` on both, so that string decides nothing.
 *
 * When neither answers, the chip remains uncertain and the chooser offers the source build.
 *
 * Only macOS on Apple silicon and Linux have an installer. A Windows or Intel Mac visitor is still
 * recognized, so the page can say so and point at the source build instead of offering a file
 * built for another machine.
 */

/** The platforms an installer is published for. */
export type DownloadId = 'mac-arm64' | 'linux'

/** Every platform the page can recognize; only the ones in `DownloadId` have an installer. */
export type PlatformId = DownloadId | 'mac-x64' | 'windows' | 'unknown'

export interface PlatformSignals {
  platform?: string
  userAgent?: string
  /** UA Client Hints high-entropy `architecture`. */
  architecture?: string
  /** The WebGL renderer string, unmasked where the browser allows it. */
  renderer?: string
}

export interface DownloadGuess {
  id: PlatformId
  /** False when the platform or Mac architecture cannot be established. */
  certain: boolean
}

function macFromSignals({ architecture, renderer }: PlatformSignals): PlatformId | null {
  if (architecture === 'arm') return 'mac-arm64'
  if (architecture === 'x86') return 'mac-x64'
  if (!renderer) return null
  if (/\bapple m\d/iu.test(renderer)) return 'mac-arm64'
  if (/\b(intel|amd|radeon|nvidia|geforce)\b/iu.test(renderer)) return 'mac-x64'
  return null
}

export function detectDownload(signals: PlatformSignals): DownloadGuess {
  const value = `${signals.platform ?? ''} ${signals.userAgent ?? ''}`.toLowerCase()
  if (value.includes('win')) return { id: 'windows', certain: true }
  if (value.includes('linux') && !value.includes('android')) return { id: 'linux', certain: true }
  if (!value.includes('mac') || /iphone|ipad|ipod|android/iu.test(value)) {
    return { id: 'unknown', certain: false }
  }
  const mac = macFromSignals(signals)
  return mac ? { id: mac, certain: true } : { id: 'mac-arm64', certain: false }
}

interface HighEntropyNavigator {
  userAgentData?: {
    platform?: string
    getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }>
  }
}

/** The synchronous signals, available on the first render. */
export function readPlatformSignals(): PlatformSignals {
  if (typeof navigator === 'undefined') return {}
  const userAgentData = (navigator as Navigator & HighEntropyNavigator).userAgentData
  return {
    platform: userAgentData?.platform ?? navigator.platform,
    userAgent: navigator.userAgent,
  }
}

function webglRenderer(): string | undefined {
  try {
    const gl = document.createElement('canvas').getContext('webgl')
    if (!gl) return undefined
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER))
    // A context per page view is a real GPU resource; hand it back rather than waiting for GC.
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return renderer
  } catch {
    // WebGL disabled or blocked against fingerprinting: the chip simply stays unknown.
    return undefined
  }
}

/** The chip signals: asynchronous (Client Hints) and not free (a WebGL context), so read once. */
export async function readMacChipSignals(): Promise<PlatformSignals> {
  const userAgentData = (navigator as Navigator & HighEntropyNavigator).userAgentData
  try {
    const values = await userAgentData?.getHighEntropyValues?.(['architecture'])
    if (values?.architecture) return { architecture: values.architecture }
  } catch {
    // A browser may refuse the hint; the renderer is the fallback signal.
  }
  return { renderer: webglRenderer() }
}
