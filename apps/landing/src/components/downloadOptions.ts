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

export const DOWNLOADS = resolveDownloads({
  'mac-arm64': import.meta.env.VITE_DOWNLOAD_MAC_ARM64_URL,
  'mac-x64': import.meta.env.VITE_DOWNLOAD_MAC_X64_URL,
  windows: import.meta.env.VITE_DOWNLOAD_WINDOWS_URL,
  linux: import.meta.env.VITE_DOWNLOAD_LINUX_URL,
})
