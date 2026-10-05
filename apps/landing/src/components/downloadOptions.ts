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
 * The names the release workflow uploads next to the installers Tauri names with a version. A link
 * built from these never carries a version, so it cannot go stale: the deploy resolves the newest
 * published release (a beta counts) and links its tag, and `release.yml` uploads exactly these
 * names. A landing test fails if the two sides drift.
 */
export const STABLE_INSTALLER_NAMES = {
  'mac-arm64': 'Localix-macos-arm64.dmg',
  'mac-x64': 'Localix-macos-x64.dmg',
  windows: 'Localix-windows-x64.exe',
  linux: 'Localix-linux-x64.AppImage',
} as const satisfies Record<DownloadId, string>

/** GitHub's `latest` skips drafts and prereleases, so this only resolves once a stable release exists. */
export const stableInstallerUrl = (id: DownloadId) =>
  `${githubUrl}/releases/latest/download/${STABLE_INSTALLER_NAMES[id]}`

/** The installer inside one specific release, whether stable or a prerelease. */
export const releaseInstallerUrl = (id: DownloadId, tag: string) =>
  `${githubUrl}/releases/download/${encodeURIComponent(tag)}/${STABLE_INSTALLER_NAMES[id]}`

export interface ReleaseState {
  /** A release was published before this build was made. */
  live: boolean
  /** Tag of the newest published release, a prerelease included. */
  tag?: string
  /** Names of that release's assets; empty when the deploy could not list them. */
  assets?: readonly string[]
}

/**
 * The link for one installer, or undefined while it is "coming soon". With a tag the link points
 * into that exact release and only exists when the release actually carries the file, so a beta
 * shipped without Linux shows no Linux button instead of a 404. Without a tag it falls back to the
 * stable `latest` link.
 */
export function installerUrl(id: DownloadId, release: ReleaseState): string | undefined {
  if (!release.live) return undefined
  const tag = release.tag?.trim()
  if (!tag) return stableInstallerUrl(id)
  const assets = release.assets ?? []
  if (assets.length > 0 && !assets.includes(STABLE_INSTALLER_NAMES[id])) return undefined
  return releaseInstallerUrl(id, tag)
}

/**
 * Set by the deploy from the release list: true only for a build made after a release was
 * published, with that release's tag and asset names. Before that every link would answer 404, so
 * the installers stay "Coming soon".
 */
const release: ReleaseState = {
  live: import.meta.env.VITE_RELEASE_LIVE === 'true',
  tag: cleanUrl(import.meta.env.VITE_RELEASE_TAG),
  assets: (cleanUrl(import.meta.env.VITE_RELEASE_ASSETS) ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean),
}
const liveUrl = (id: DownloadId) => installerUrl(id, release)

export const DOWNLOADS = resolveDownloads({
  'mac-arm64': cleanUrl(import.meta.env.VITE_DOWNLOAD_MAC_ARM64_URL) ?? liveUrl('mac-arm64'),
  'mac-x64': cleanUrl(import.meta.env.VITE_DOWNLOAD_MAC_X64_URL) ?? liveUrl('mac-x64'),
  windows: cleanUrl(import.meta.env.VITE_DOWNLOAD_WINDOWS_URL) ?? liveUrl('windows'),
  linux: cleanUrl(import.meta.env.VITE_DOWNLOAD_LINUX_URL) ?? liveUrl('linux'),
})
