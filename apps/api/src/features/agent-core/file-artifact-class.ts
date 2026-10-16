import { relative } from 'node:path'
import { canonicalCandidate } from '../../lib/host-roots'
import { isPathBelow } from '../../lib/path-containment'

/** Artifact grants require every mutation target to stay inside the workspace. */
export function fileArtifactClasses(paths: readonly string[], root?: string): string[] {
  if (!root || paths.length === 0) return []
  const canonicalRoot = canonicalCandidate(root)
  const canonicalTargets = paths.map(canonicalCandidate)
  if (!canonicalTargets.every((path) => isPathBelow(canonicalRoot, path))) return []
  const targets = canonicalTargets.map((path) =>
    relative(canonicalRoot, path).replaceAll('\\', '/'),
  )
  const matches: Record<string, (path: string) => boolean> = {
    'documentation-files': (path) => /\.(?:md|mdx|rst|txt)$/i.test(path),
    'test-files': (path) =>
      /(?:^|\/)(?:__tests__|tests?|fixtures)\//.test(path) || /\.(?:test|spec)\.[^/]+$/.test(path),
    'prototype-files': (path) =>
      /^(?:mockups|prototypes|design)\//.test(path) ||
      /(?:^|\/)mockup(?:\.[^/]+)?\.html$/.test(path),
  }
  return Object.entries(matches)
    .filter(([, test]) => targets.every(test))
    .map(([name]) => name)
}
