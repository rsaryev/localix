import { readFileSync } from 'node:fs'

import { parseReleaseTag } from './resolve-release-ref.mjs'

// The installers people download, by the stable name release.yml uploads next to Tauri's versioned
// ones. `tested` is what a person has run by hand; everything else is built by the same pipeline
// and said to be experimental until someone has.
export const INSTALLERS = [
  { name: 'Localix-macos-arm64.dmg', platform: 'macOS, Apple silicon', tested: true },
  { name: 'Localix-macos-x64.dmg', platform: 'macOS, Intel', tested: false },
  { name: 'Localix-linux-x64.AppImage', platform: 'Linux, x86-64', tested: false },
  { name: 'Localix-linux-arm64.AppImage', platform: 'Linux, ARM64', tested: false },
]

/** The body of `## v<version>` in a Keep-a-Changelog file, without its heading or the next one. */
export function changelogSection(changelog, version) {
  const lines = changelog.split(/\r?\n/u)
  const start = lines.findIndex(
    (line) => line.startsWith(`## v${version} `) || line === `## v${version}`,
  )
  if (start === -1) return ''
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '))
  return lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join('\n')
    .trim()
}

function downloadsTable(assets) {
  const published = new Set(assets)
  const rows = INSTALLERS.filter(({ name }) => published.has(name)).map(
    ({ name, platform, tested }) =>
      `| ${platform} | \`${name}\` | ${tested ? 'Tested' : 'Experimental'} |`,
  )
  if (rows.length === 0) return ''
  return ['| Platform | Download | Status |', '| --- | --- | --- |', ...rows].join('\n')
}

export function buildReleaseNotes({
  tag,
  commit,
  repository,
  channel = '',
  changelog = '',
  generated = '',
  assets = [],
}) {
  const { version, isPrerelease } = parseReleaseTag(tag)
  const sections = []

  if (isPrerelease) {
    sections.push(
      '> **Beta.** Localix has been tested only on macOS (Apple silicon). The other installers come ' +
        'from the same pipeline and are experimental: they may not start on your machine. There is ' +
        'no Windows installer yet; build it from source.',
    )
  }

  const table = downloadsTable(assets)
  if (table) {
    sections.push(
      `## Download\n\n${table}\n\nOpen the DMG and drag Localix into Applications, or make the ` +
        'AppImage executable and run it.',
    )
  }

  const highlights = changelogSection(changelog, version)
  if (highlights) sections.push(`## Highlights\n\n${highlights}`)

  const changes = generated.replace(/^#+ What's Changed\s*/u, '').trim()
  if (changes) sections.push(`## What's changed\n\n${changes}`)

  const base = `https://github.com/${repository}`
  sections.push(
    [
      '## Verify',
      '',
      `Checksums are in \`SHA256SUMS.txt\`. Build provenance can be checked with ` +
        `\`gh attestation verify <file> --repo ${repository}\`.`,
      '',
      `Prefer to build it yourself? See [Run Localix from source](${base}/blob/${tag}/docs/getting-started/installation.md).`,
    ].join('\n'),
  )

  const title = `Localix ${tag}${channel ? ` (${channel})` : ''}`
  return `${title}\n\n${sections.join('\n\n')}\n\nSource commit: ${commit}\n`
}

if (import.meta.main) {
  try {
    const read = (path) => (path ? readFileSync(path, 'utf8') : '')
    process.stdout.write(
      buildReleaseNotes({
        tag: process.env.RELEASE_TAG,
        commit: process.env.SOURCE_COMMIT,
        repository: process.env.RELEASE_REPO,
        channel: process.env.RELEASE_CHANNEL,
        changelog: read(process.env.RELEASE_CHANGELOG),
        generated: read(process.env.RELEASE_GENERATED_NOTES),
        assets: read(process.env.RELEASE_ASSET_LIST).split(/\r?\n/u).filter(Boolean),
      }),
    )
  } catch (error) {
    console.error(`[release] ${error instanceof Error ? error.message : 'Unable to build notes'}`)
    process.exit(1)
  }
}
