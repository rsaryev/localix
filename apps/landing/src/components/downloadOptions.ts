import { Apple, Monitor, SquareTerminal, type LucideIcon } from 'lucide-react'
import type { DownloadId } from './downloadPlatform'

export interface DownloadOption {
  id: DownloadId
  title: string
  shortTitle: string
  artifact: string
  action: string
  icon: LucideIcon
  url?: string
}

const cleanUrl = (value: string | undefined) => value?.trim() || undefined
export const githubUrl =
  cleanUrl(import.meta.env.VITE_GITHUB_URL) ?? 'https://github.com/rsaryev/localix'

/** Every platform's installer, each with the URL a release provides (none before the first). */
export function resolveDownloads(
  urls: Partial<Record<DownloadId, string | undefined>>,
): DownloadOption[] {
  return [
    {
      id: 'mac-arm64',
      title: 'macOS',
      shortTitle: 'macOS',
      artifact: 'Apple silicon (.dmg)',
      action: 'Download for Mac',
      icon: Apple,
      url: cleanUrl(urls['mac-arm64']),
    },
    {
      id: 'mac-x64',
      title: 'macOS Intel',
      shortTitle: 'Intel',
      artifact: 'Intel Macs (.dmg)',
      action: 'Download for Intel Mac',
      icon: Apple,
      url: cleanUrl(urls['mac-x64']),
    },
    {
      id: 'windows',
      title: 'Windows',
      shortTitle: 'Windows',
      artifact: '64-bit installer (.exe)',
      action: 'Download for Windows',
      icon: Monitor,
      url: cleanUrl(urls.windows),
    },
    {
      id: 'linux',
      title: 'Linux',
      shortTitle: 'Linux',
      artifact: 'AppImage (.AppImage)',
      action: 'Download for Linux',
      icon: SquareTerminal,
      url: cleanUrl(urls.linux),
    },
  ]
}

/**
 * The names the release workflow uploads next to the installers Tauri names with a version.
 * GitHub resolves `releases/latest/download/<name>` to the newest published release, so a link
 * built from these never changes and never goes stale. `release.yml` uploads exactly these names,
 * and a landing test fails if the two sides drift.
 */
export const STABLE_INSTALLER_NAMES = {
  'mac-arm64': 'Localix-macos-arm64.dmg',
  'mac-x64': 'Localix-macos-x64.dmg',
  windows: 'Localix-windows-x64.exe',
  linux: 'Localix-linux-x64.AppImage',
} as const satisfies Record<DownloadId, string>

export const stableInstallerUrl = (id: DownloadId) =>
  `${githubUrl}/releases/latest/download/${STABLE_INSTALLER_NAMES[id]}`

/**
 * True only for a build made after a release was published (the deploy sets it from the release
 * list). Before that the stable links would answer 404, so the installers stay "Coming soon".
 */
const releaseLive = import.meta.env.VITE_RELEASE_LIVE === 'true'
const liveUrl = (id: DownloadId) => (releaseLive ? stableInstallerUrl(id) : undefined)

export const DOWNLOADS = resolveDownloads({
  'mac-arm64': cleanUrl(import.meta.env.VITE_DOWNLOAD_MAC_ARM64_URL) ?? liveUrl('mac-arm64'),
  'mac-x64': cleanUrl(import.meta.env.VITE_DOWNLOAD_MAC_X64_URL) ?? liveUrl('mac-x64'),
  windows: cleanUrl(import.meta.env.VITE_DOWNLOAD_WINDOWS_URL) ?? liveUrl('windows'),
  linux: cleanUrl(import.meta.env.VITE_DOWNLOAD_LINUX_URL) ?? liveUrl('linux'),
})
