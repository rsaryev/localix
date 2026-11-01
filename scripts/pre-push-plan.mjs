// What a push checks before it leaves the machine.
//
// Types of the packages the pushed commits change and their dependents, and the repository guards
// (`check:guards`: architecture rules, file size, test determinism, UI tokens), which read the
// whole tree in a few seconds and never flake: when only CI ran them, dev reached main 341 commits
// later with six of them red. The unit and
// integration suites ran here once, and on a laptop busy with the app, its dev servers and a
// browser they failed at random and blocked pushes of code they never touched. They run in CI on
// our own runner instead (`.github/workflows/ci.yml`), on a machine that does nothing else.

const ZERO = /^0+$/

/** Scripts a push runs; the Turbo ones `--affected` against `base`. */
const GATES = ['type-check', 'check:tests', 'check:guards']

/**
 * The checks for a push, from the lines git writes to a pre-push hook
 * (`<local ref> <local sha> <remote ref> <remote sha>`), or null when it only deletes. One branch
 * that the remote already has is checked against the remote's copy: exactly what the push adds.
 * A new branch, or several at once, against main.
 */
export function pushChecks(stdin) {
  const updates = stdin
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((fields) => fields.length === 4 && !ZERO.test(fields[1]))
  if (updates.length === 0) return null
  const remote = updates.length === 1 ? updates[0][3] : null
  return { base: remote && !ZERO.test(remote) ? remote : 'origin/main', gates: GATES }
}
