import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { changelogSection } from './build-release-notes.mjs'
import { parseReleaseTag } from './resolve-release-ref.mjs'

// `linux-x86_64-deb` exists because a .deb install could otherwise never update. The updater
// (tauri-plugin-updater `get_urls`) looks up `{os}-{arch}-{installer}` before `{os}-{arch}`, and
// its deb installer refuses any payload that is not a Debian package. With only `linux-x86_64`
// in the manifest, a .deb install fell back to the AppImage URL, downloaded it, and rejected it
// on every click while "Update available" stayed up. The Tauri CLI signs the .deb bundle itself
// when `createUpdaterArtifacts` is on, so the key points at that package and its `.deb.sig`.
const EXPECTED_PLATFORMS = [
  'darwin-aarch64',
  'darwin-x86_64',
  'windows-x86_64',
  'linux-x86_64',
  'linux-x86_64-deb',
]
const KNOWN_PLATFORMS = [...EXPECTED_PLATFORMS, 'linux-aarch64', 'linux-aarch64-deb']

// Platforms whose build is still experimental: they join the manifest only when their signed
// artifact reached the release, and a leg that failed never blocks the release or its updater.
export const EXPERIMENTAL_PLATFORMS = ['darwin-x86_64', 'linux-aarch64', 'linux-aarch64-deb']

// A release may ship fewer platforms than the full set (the first beta is macOS only). The list the
// workflow passes is validated against KNOWN_PLATFORMS so a typo cannot silently shrink the
// manifest, and a platform on the list that has no signed artifact still fails the release.
export function parsePlatformList(value) {
  if (!value) return EXPECTED_PLATFORMS
  const requested = value.split(',').map((item) => item.trim())
  const unknown = requested.filter((item) => !KNOWN_PLATFORMS.includes(item))
  if (unknown.length > 0 || requested.length === 0) {
    throw new Error(`Unknown updater platform: ${unknown.join(', ') || '(empty)'}`)
  }
  return requested
}

function updaterTarget(signatureName) {
  if (signatureName.endsWith('.app.tar.gz.sig')) {
    if (signatureName.includes('aarch64')) return { platform: 'darwin-aarch64', priority: 1 }
    if (signatureName.includes('x86_64')) return { platform: 'darwin-x86_64', priority: 1 }
    return null
  }
  if (signatureName.endsWith('.exe.sig')) {
    return { platform: 'windows-x86_64', priority: 2 }
  }
  // Tauri names the Linux bundles by Debian/AppImage architecture: `amd64` or `aarch64`/`arm64`.
  const linuxArm = /(?:aarch64|arm64)/u.test(signatureName)
  if (signatureName.endsWith('.AppImage.sig')) {
    return { platform: linuxArm ? 'linux-aarch64' : 'linux-x86_64', priority: 1 }
  }
  if (signatureName.endsWith('.deb.sig')) {
    return { platform: linuxArm ? 'linux-aarch64-deb' : 'linux-x86_64-deb', priority: 1 }
  }
  return null
}

export function createUpdaterManifest({
  repository,
  tag,
  version,
  publishedAt,
  assets,
  signatures,
  platforms: requiredPlatforms = EXPECTED_PLATFORMS,
  experimental = [],
  notes = '',
}) {
  const parsedTag = parseReleaseTag(tag)
  if (version !== parsedTag.version) {
    throw new Error('Updater version does not match the release tag')
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error('Updater repository must be an owner/name pair')
  }
  if (Number.isNaN(Date.parse(publishedAt))) {
    throw new Error('Updater publication date must be an ISO timestamp')
  }

  const availableAssets = new Set(assets)
  const selected = new Map()
  for (const entry of [...signatures].sort((left, right) => left.name.localeCompare(right.name))) {
    const target = updaterTarget(entry.name)
    if (!target) continue
    const artifact = entry.name.slice(0, -'.sig'.length)
    if (!availableAssets.has(artifact)) {
      throw new Error(`Signed updater artifact is missing from the release: ${artifact}`)
    }
    const signature = entry.signature.trim()
    if (!signature) throw new Error(`Updater signature is empty: ${entry.name}`)

    const previous = selected.get(target.platform)
    if (previous && previous.priority >= target.priority) continue
    selected.set(target.platform, { artifact, signature, priority: target.priority })
  }

  // An experimental platform ships when its artifact is there and is left out when it is not.
  const shippedPlatforms = [
    ...requiredPlatforms,
    ...experimental.filter(
      (platform) => selected.has(platform) && !requiredPlatforms.includes(platform),
    ),
  ]
  for (const platform of requiredPlatforms) {
    if (!selected.has(platform)) {
      throw new Error(`Missing signed updater artifact for ${platform}`)
    }
  }

  const baseUrl = `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}`
  const platforms = Object.fromEntries(
    shippedPlatforms.map((platform) => {
      const entry = selected.get(platform)
      return [
        platform,
        {
          signature: entry.signature,
          url: `${baseUrl}/${encodeURIComponent(entry.artifact)}`,
        },
      ]
    }),
  )

  return {
    version,
    // What the app's update dialog shows under "What's new": the version's CHANGELOG section.
    notes: notes.trim() || `Localix ${version}`,
    pub_date: new Date(publishedAt).toISOString(),
    platforms,
  }
}

if (import.meta.main) {
  try {
    const signatureDirectory = process.env.RELEASE_SIGNATURE_DIR
    const assetListPath = process.env.RELEASE_ASSET_LIST
    const outputPath = process.env.RELEASE_OUTPUT
    if (!signatureDirectory || !assetListPath || !outputPath) {
      throw new Error('Updater manifest paths are not configured')
    }

    const signatures = readdirSync(signatureDirectory)
      .filter((name) => name.endsWith('.sig'))
      .map((name) => ({
        name,
        signature: readFileSync(join(signatureDirectory, name), 'utf8'),
      }))
    const assets = readFileSync(assetListPath, 'utf8').split(/\r?\n/).filter(Boolean)
    const changelogPath = process.env.RELEASE_CHANGELOG
    const changelog = changelogPath ? readFileSync(changelogPath, 'utf8') : ''
    const manifest = createUpdaterManifest({
      repository: process.env.RELEASE_REPO,
      tag: process.env.RELEASE_TAG,
      version: process.env.RELEASE_VERSION,
      publishedAt: process.env.RELEASE_PUBLISHED_AT,
      assets,
      signatures,
      platforms: parsePlatformList(process.env.RELEASE_PLATFORMS),
      experimental: process.env.RELEASE_EXPERIMENTAL_PLATFORMS
        ? parsePlatformList(process.env.RELEASE_EXPERIMENTAL_PLATFORMS)
        : [],
      notes: changelogSection(changelog, process.env.RELEASE_VERSION ?? ''),
    })
    writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to build updater manifest'
    console.error(`[release] ${message}`)
    process.exit(1)
  }
}
