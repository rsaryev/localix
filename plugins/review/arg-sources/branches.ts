/**
 * Dynamic options for the `/review branch <branch>` picker — local branches, most
 * recently committed first. Contract + shared helpers: see ./lib.ts.
 */
import { emitOptions, matchesQuery, readRequest, runLines, splitTab, type ArgOption } from './lib'

async function main() {
  const { query, cwd } = await readRequest()

  const lines = runLines(
    [
      'git',
      'for-each-ref',
      '--sort=-committerdate',
      '--format=%(refname:short)%09%(subject)',
      'refs/heads',
    ],
    cwd,
  )
  if (!lines) {
    emitOptions([])
    return
  }

  const out: ArgOption[] = []
  for (const line of lines) {
    const [name, subject] = splitTab(line)
    if (!matchesQuery(query, name, subject)) continue
    out.push({ value: name, label: name, ...(subject ? { description: subject } : {}) })
  }
  emitOptions(out)
}

void main()
