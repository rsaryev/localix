import { spawnSync } from 'node:child_process'

const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const COMMIT_PATTERN = /^[0-9a-f]{40,64}$/i

function releaseMarker(commit) {
  return `Source commit: ${commit}`
}

/**
 * Verify that the release repository already contains the exact reviewed tag.
 * A separate release repository is safe only when it mirrors the source commit;
 * otherwise GitHub's source archive and the uploaded binaries have different provenance.
 */
export function inspectReleaseTarget({ repository, tag, sourceCommit, request }) {
  if (!REPOSITORY_PATTERN.test(repository)) {
    throw new Error('Release repository must be an owner/name pair')
  }
  if (!COMMIT_PATTERN.test(sourceCommit)) {
    throw new Error('Source commit must be a full commit SHA')
  }

  const encodedTag = encodeURIComponent(tag)
  const ref = request(`/repos/${repository}/git/ref/tags/${encodedTag}`)
  if (!ref?.object) throw new Error(`Release repository is missing tag ${tag}`)

  let object = ref.object
  const visited = new Set()
  for (let depth = 0; object.type === 'tag' && depth < 8; depth += 1) {
    if (!COMMIT_PATTERN.test(object.sha) || visited.has(object.sha)) {
      throw new Error(`Release tag ${tag} has an invalid annotated-tag chain`)
    }
    visited.add(object.sha)
    const annotated = request(`/repos/${repository}/git/tags/${object.sha}`)
    if (!annotated?.object) {
      throw new Error(`Release tag ${tag} cannot be resolved to a commit`)
    }
    object = annotated.object
  }

  if (object.type !== 'commit' || object.sha.toLowerCase() !== sourceCommit.toLowerCase()) {
    throw new Error(`Release tag ${tag} does not point to reviewed commit ${sourceCommit}`)
  }

  // `releases/tags/{tag}` never returns a DRAFT, so a re-run looked like a first run: it created a
  // second draft for the same tag and skipped the provenance check below. The list includes drafts
  // for a token that can write releases; the newest 100 cover every release a run can resume.
  const releases = request(`/repos/${repository}/releases?per_page=100`) ?? []
  const release = Array.isArray(releases)
    ? releases.find((entry) => entry?.tag_name === tag)
    : undefined
  if (!release) return { releaseExists: false }
  if (!release.draft) {
    throw new Error(`Release ${tag} is already published and will not be modified`)
  }
  if (typeof release.body !== 'string' || !release.body.includes(releaseMarker(sourceCommit))) {
    throw new Error(`Draft release ${tag} belongs to a different source commit`)
  }
  return { releaseExists: true }
}

function githubRequest(path, { allowMissing = false } = {}) {
  const result = spawnSync('gh', ['api', path], { encoding: 'utf8' })
  if (allowMissing && result.status === 1 && /HTTP 404|Not Found/i.test(result.stderr)) return null
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `GitHub API request failed: ${path}`)
  }
  return JSON.parse(result.stdout)
}

if (import.meta.main) {
  try {
    const result = inspectReleaseTarget({
      repository: process.env.RELEASE_REPO ?? '',
      tag: process.env.RELEASE_TAG ?? '',
      sourceCommit: process.env.SOURCE_COMMIT ?? '',
      request: githubRequest,
    })
    process.stdout.write(`release_exists=${result.releaseExists}\n`)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to verify release target'
    console.error(`[release] ${message}`)
    process.exit(1)
  }
}
