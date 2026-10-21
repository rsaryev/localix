// A commit made as a scratch identity (a leaked test fixture's `stamp@example.invalid`) cannot be
// told apart from a real one once it is pushed. The hook refuses it before the commit exists.
import { spawnSync } from 'node:child_process'

const SCRATCH_DOMAIN = /(?:^|\.)(?:invalid|test|example|localhost)$/iu

/**
 * Why `ident` ("Name <email> 123 +0000", as `git var GIT_AUTHOR_IDENT` prints it) must not author
 * a commit, or null when it may.
 * @param {string} ident
 * @returns {string | null}
 */
export function identityProblem(ident) {
  const match = /^(.*?)\s*<([^>]*)>/u.exec(ident.trim())
  const name = match?.[1] ?? ''
  const email = match?.[2] ?? ''
  const domain = email.split('@')[1] ?? ''
  if (!name || !email || !domain) return `incomplete identity "${ident.trim()}"`
  if (SCRATCH_DOMAIN.test(domain)) return `scratch identity ${name} <${email}>`
  return null
}

/** The author and committer git would record, failing closed when git cannot say. */
export function checkCommitIdentity(env = process.env) {
  const problems = []
  for (const role of ['AUTHOR', 'COMMITTER']) {
    const result = spawnSync('git', ['var', `GIT_${role}_IDENT`], {
      encoding: 'utf8',
      env,
      timeout: 10_000,
      killSignal: 'SIGKILL',
    })
    const problem =
      result.status === 0 ? identityProblem(result.stdout) : `no ${role.toLowerCase()} identity`
    if (problem) problems.push(`${role.toLowerCase()}: ${problem}`)
  }
  return problems
}

if (import.meta.main) {
  const problems = checkCommitIdentity()
  if (problems.length) {
    console.error('[pre-commit] Refusing to commit with a scratch git identity:')
    for (const problem of problems) console.error(`  ${problem}`)
    console.error('  Look for a stray [user] in .git/config:  git config --show-origin user.email')
    console.error('  Fix it:  git config --local --unset-all user.name; same for user.email')
    process.exit(1)
  }
}
