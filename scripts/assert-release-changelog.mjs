import { readFileSync } from 'node:fs'

import { changelogSection } from './build-release-notes.mjs'

// The section must say what changed for a person, not only carry a heading: the same text is the
// GitHub release's Highlights and the "What's new" of the app's update dialog.
const ENTRY = /^\s*[-*] \S/mu

/** The reason `changelog` cannot announce `version`, or null when it can. */
export function releaseChangelogProblem(changelog, version) {
  if (!version) return 'The release version is not set'
  const section = changelogSection(changelog, version)
  if (!section) return `CHANGELOG.md has no "## v${version}" section`
  if (!ENTRY.test(section)) return `The v${version} section of CHANGELOG.md lists no changes`
  return null
}

if (import.meta.main) {
  const changelog = readFileSync(process.env.RELEASE_CHANGELOG ?? 'CHANGELOG.md', 'utf8')
  const problem = releaseChangelogProblem(changelog, process.env.RELEASE_VERSION)
  if (problem) {
    console.error(`[release] ${problem}. Write what is new before releasing (AGENTS.md, Releases).`)
    process.exit(1)
  }
}
