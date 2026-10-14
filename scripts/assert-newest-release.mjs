// Refuse to publish a release that is not newer than the current latest.
//
// Every published release becomes `latest` (see release.yml), and the updater reads `latest.json`
// from it. The updater never installs an older version than the one running, so publishing an
// older tag as latest would leave every installed app unable to update, and hand new installs the
// old version. This is checked just before the publish, against the release GitHub calls latest.
//
//   CURRENT_LATEST_TAG=<tag or empty> RELEASE_TAG=<tag> bun scripts/assert-newest-release.mjs
//
// Semantic-version precedence applies: `0.1.0-beta.2` is newer than `0.1.0-beta.1`, and `0.1.0` is
// newer than any `0.1.0-beta.N`. The same tag is accepted, so a re-run of a half-finished release
// does not block itself.
import { pathToFileURL } from 'node:url'

const stripV = (tag) => tag.replace(/^v/u, '').split('+', 1)[0]

/** `1` when `candidate` is newer than `current`, `0` when they are equal, `-1` when older. */
export function compareReleaseTags(candidate, current) {
  return Bun.semver.order(stripV(candidate), stripV(current))
}

/** Throw unless `tag` may become latest while `currentLatestTag` is. An empty current is a first release. */
export function assertNewestRelease({ tag, currentLatestTag }) {
  if (!tag) throw new Error('RELEASE_TAG is empty')
  if (!currentLatestTag?.trim()) return 'first release'
  const current = currentLatestTag.trim()
  const order = compareReleaseTags(tag, current)
  if (order < 0) {
    throw new Error(
      `${tag} is older than the current latest release ${current}. Publishing it as latest would ` +
        'leave installed apps unable to update. Release a newer version instead.',
    )
  }
  return order === 0 ? 'same tag' : 'newer'
}

function main() {
  try {
    const result = assertNewestRelease({
      tag: process.env.RELEASE_TAG ?? '',
      currentLatestTag: process.env.CURRENT_LATEST_TAG ?? '',
    })
    console.log(`[release-order] ${process.env.RELEASE_TAG}: ${result}`)
  } catch (error) {
    console.error(`[release-order] ${error.message}`)
    process.exitCode = 1
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
