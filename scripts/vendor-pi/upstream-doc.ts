/**
 * The two facts `vendor/pi/UPSTREAM.md` records about the snapshot in force: which upstream commit
 * it is, and pi's version there. The merge base itself comes from history (`snapshot.ts`); these
 * lines are what a reader sees, and what the pre-commit detector compares upstream against without
 * walking history on every commit.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { UPSTREAM_DOC } from './config'
import { SyncFailure } from './run'

const BASE_LINE = /- Base commit: `([0-9a-f]{7,40})`/
const VERSION_LINE = /- Upstream version: `[^`]+`/

export async function recordedUpstream(root: string): Promise<string> {
  const doc = await readFile(join(root, UPSTREAM_DOC), 'utf8')
  const sha = BASE_LINE.exec(doc)?.[1]
  if (!sha) {
    throw new SyncFailure(
      `${UPSTREAM_DOC} does not record a base commit`,
      'Restore the "- Base commit: `<sha>`" line: it is the upstream commit vendor/pi is merged up to.',
    )
  }
  return sha
}

export async function recordUpstream(root: string, sha: string, version: string): Promise<void> {
  const path = join(root, UPSTREAM_DOC)
  const doc = await readFile(path, 'utf8')
  await writeFile(
    path,
    doc
      .replace(BASE_LINE, `- Base commit: \`${sha}\``)
      .replace(VERSION_LINE, `- Upstream version: \`${version}\``),
  )
}

/**
 * The paragraphs of `UPSTREAM.md` that name a path — what a person resolving a conflict in that
 * file needs to read first: which Localix delta lives there and which guard proves it.
 */
export async function deltaNotesFor(root: string, path: string): Promise<string[]> {
  const doc = await readFile(join(root, UPSTREAM_DOC), 'utf8')
  const inPackage = path.replace(/^vendor\/pi\//, '')
  const name = inPackage.split('/').pop() ?? inPackage
  return doc
    .split(/\n\s*\n/)
    .filter(
      (paragraph) =>
        paragraph.includes(inPackage) ||
        paragraph.includes(`/${name}`) ||
        paragraph.includes(`\`${name}\``),
    )
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
}
