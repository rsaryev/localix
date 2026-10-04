/**
 * Dynamic options for the `/review pr <number>` picker — open GitHub pull requests
 * via the `gh` CLI. Quietly yields `[]` when gh is absent, signed out, or the repo
 * isn't on GitHub. Contract + shared helpers: see ./lib.ts.
 */
import { emitOptions, matchesQuery, readRequest, runLines, type ArgOption } from './lib'

interface PrRow {
  number: number
  title: string
  headRefName?: string
}

async function main() {
  const { query, cwd } = await readRequest()

  const lines = runLines(
    ['gh', 'pr', 'list', '--limit', '50', '--json', 'number,title,headRefName'],
    cwd,
  )
  if (!lines) {
    emitOptions([])
    return
  }

  let rows: PrRow[] = []
  try {
    rows = JSON.parse(lines.join('\n') || '[]') as PrRow[]
  } catch {
    emitOptions([])
    return
  }

  const out: ArgOption[] = []
  for (const pr of rows) {
    const value = String(pr.number)
    const label = `#${pr.number} ${pr.title}`
    if (!matchesQuery(query, value, label)) continue
    out.push({ value, label, ...(pr.headRefName ? { description: pr.headRefName } : {}) })
  }
  emitOptions(out)
}

void main()
