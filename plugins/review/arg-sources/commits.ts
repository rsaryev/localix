/**
 * Dynamic options for the `/review commit <ref>` picker — the 50 most recent
 * commits. Contract + shared helpers: see ./lib.ts.
 *
 * The full sha is the option `value` so the command can `git show <value>` it;
 * the subject is the human-facing label, the short sha the description.
 */
import { emitOptions, matchesQuery, readRequest, runLines, splitTab, type ArgOption } from './lib'

async function main() {
  const { query, cwd } = await readRequest()

  const lines = runLines(['git', 'log', '-n', '50', '--format=%H%x09%s'], cwd)
  if (!lines) {
    emitOptions([])
    return
  }

  const out: ArgOption[] = []
  for (const line of lines) {
    const [sha, subject] = splitTab(line)
    if (!matchesQuery(query, sha, subject)) continue
    out.push({ value: sha, label: subject || sha.slice(0, 12), description: sha.slice(0, 8) })
  }
  emitOptions(out)
}

void main()
