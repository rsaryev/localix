import { spawnSync } from 'node:child_process'

const RELEASE_TAG_PATTERN =
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

export function selectReleaseTag(inputTag, refName) {
  return inputTag === undefined || inputTag === '' ? refName : inputTag
}

export function parseReleaseTag(tag) {
  if (typeof tag !== 'string' || !RELEASE_TAG_PATTERN.test(tag)) {
    throw new Error('Release tag must be an exact semantic version such as v1.2.3')
  }

  return {
    tag,
    version: tag.slice(1),
    // A hyphen inside build metadata (`+build-7`) does not make a SemVer
    // prerelease. Only inspect the core version before the optional `+`.
    isPrerelease: tag.slice(1).split('+', 1)[0].includes('-'),
  }
}

export function resolveReleaseCommit(tag, cwd = process.cwd()) {
  const result = spawnSync(
    'git',
    ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`],
    {
      cwd,
      encoding: 'utf8',
    },
  )
  const commit = result.stdout.trim()

  if (result.status !== 0 || !/^[0-9a-f]{40,64}$/i.test(commit)) {
    throw new Error('Release tag does not exist in this repository')
  }

  return commit
}

export function assertReleaseCommitOnMain(
  commit,
  cwd = process.cwd(),
  mainRef = 'refs/remotes/origin/main',
) {
  const result = spawnSync('git', ['merge-base', '--is-ancestor', commit, mainRef], {
    cwd,
    encoding: 'utf8',
  })

  if (result.status !== 0) {
    throw new Error(`Release tag commit must be reachable from ${mainRef}`)
  }
}

if (import.meta.main) {
  try {
    const { tag, version, isPrerelease } = parseReleaseTag(
      selectReleaseTag(process.env.RELEASE_TAG_INPUT, process.env.RELEASE_TAG_REF),
    )
    const commit = resolveReleaseCommit(tag)
    assertReleaseCommitOnMain(commit)
    process.stdout.write(
      `tag=${tag}\nversion=${version}\nis_prerelease=${isPrerelease}\ncommit=${commit}\n`,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to resolve release tag'
    console.error(`[release] ${message}`)
    process.exit(1)
  }
}
