/**
 * `export` — write saved requests into the working tree so a team shares them through the repo.
 *
 * This is the "Git storage" answer, and it is deliberately not a sync ENGINE. The requests live in
 * a repo the user already has, with a git client they already use and an agent that already
 * commits. So export writes files; `git` does git. Rebuilding a VCS inside a request client would
 * be the largest wheel in this whole exercise.
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveWithin } from '@localixai/path-containment'
import type { CollectionStore } from '../collection/store'
import { buildRequestFile, gitSafetyProblem, parseRequestFile, requestFileName } from './format'

/** Where exported requests live, relative to the working tree. */
export const EXPORT_DIR = path.join('.localix', 'rest')

export interface ExportResult {
  written: string[]
  /** Requests refused because they carry a literal credential — see gitSafetyProblem. */
  refused: string[]
  problems: string[]
  dir: string
}

/**
 * Resolve the export directory inside `cwd`, or null when `subdir` escapes it.
 *
 * The containment check is not ceremony: `subdir` reaches this from a tool argument, and a plugin
 * that writes wherever a model asks is a plugin that writes to `~/.ssh`. `resolveWithin` is the
 * repo's one owner of that rule.
 */
export function exportDirFor(cwd: string, subdir?: string): string | null {
  const target = path.resolve(cwd, subdir?.trim() || EXPORT_DIR)
  return resolveWithin(cwd, target)
}

export async function exportRequests(opts: {
  store: CollectionStore
  userId: string
  cwd: string
  subdir?: string
  /** Export only these names; every saved request when absent. */
  names?: string[]
}): Promise<ExportResult | { problem: string }> {
  const dir = exportDirFor(opts.cwd, opts.subdir)
  if (!dir) {
    return {
      problem: `"${opts.subdir}" resolves outside the working directory. Export writes into the repo, so the path must stay inside it — e.g. "${EXPORT_DIR}".`,
    }
  }

  const all = await opts.store.list()
  const wanted = opts.names?.length ? all.filter((r) => opts.names!.includes(r.name)) : all
  if (wanted.length === 0) {
    return {
      problem: opts.names?.length
        ? `No saved request named ${opts.names.map((n) => `"${n}"`).join(', ')}.`
        : 'No saved requests to export.',
    }
  }

  const written: string[] = []
  const refused: string[] = []
  const problems: string[] = []
  // Two requests whose names slug to one filename would silently overwrite each other, and the
  // loser would vanish from the repo with no sign it was ever there.
  const usedFiles = new Map<string, string>()

  await mkdir(dir, { recursive: true })
  for (const record of wanted) {
    const problem = gitSafetyProblem(record.name, record.spec)
    if (problem) {
      refused.push(record.name)
      problems.push(problem)
      continue
    }
    const file = requestFileName(record.name)
    const claimant = usedFiles.get(file)
    if (claimant) {
      problems.push(
        `"${record.name}" and "${claimant}" both map to the file ${file}, so "${record.name}" was not exported. Rename one of them.`,
      )
      continue
    }
    usedFiles.set(file, record.name)
    await writeFile(
      path.join(dir, file),
      `${JSON.stringify(buildRequestFile(record.name, record.spec), null, 2)}\n`,
      'utf8',
    )
    written.push(file)
  }

  return { written, refused, problems, dir }
}

/**
 * Read exported request files back out of the working tree.
 *
 * Returns the file TEXTS, not requests: parsing is the importer chain's job, and routing this
 * through the same chain as a pasted file means an exported request and a hand-committed one are
 * read by exactly one code path.
 */
export async function readExportedFiles(
  cwd: string,
  subdir?: string,
): Promise<string[] | { problem: string }> {
  const dir = exportDirFor(cwd, subdir)
  if (!dir) return { problem: `"${subdir}" resolves outside the working directory.` }

  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return { problem: `Nothing to import: ${path.relative(cwd, dir) || '.'} does not exist.` }
  }

  const texts = await Promise.all(
    entries
      .filter((entry) => entry.endsWith('.json'))
      .sort()
      .map(async (entry) => {
        const text = await readFile(path.join(dir, entry), 'utf8').catch(() => null)
        // A file that is not one of ours is skipped rather than failing the batch: the directory
        // is in a repo, and a repo accumulates files nobody told us about.
        return text !== null && parseRequestFile(text) ? text : null
      }),
  )
  return texts.filter((text): text is string => text !== null)
}
