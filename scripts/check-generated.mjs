#!/usr/bin/env bun
/**
 * A generated file that is COMMITTED must match what its generator produces right now.
 *
 * There are two in this repository. The Rust half of the shell <-> runtime contract is the second
 * (`scripts/runtime-contract.mjs`). The first is `apps/landing/public/sitemap.xml`, written by
 * `apps/landing/scripts/build-docs.mjs` from `docs/public-nav.json`. The rest of that generator's
 * output lives under `apps/landing/src/generated/`, which is gitignored — a build artifact, rebuilt
 * by the `predev` / `prebuild` / `pretype-check` hooks, and correctly not our problem.
 *
 * The sitemap is a different thing, and the difference is what this gate exists for: it is served
 * as-committed, but it is also rewritten by every local build. Publish a page, forget to commit the
 * regenerated sitemap, and nothing fails — your own build quietly fixed the file for you, so the
 * site you see is right and the one that ships is missing a URL. The failure is invisible from
 * inside the repository and visible only to a crawler.
 *
 * So the check is not "did you run the generator" but "does the generator still produce what is
 * committed": run it, then look for a dirty tree.
 */
import { checkRuntimeContract } from './runtime-contract.mjs'
import { run } from './lib/run.mjs'

/** Committed files a generator owns. Anything dirty here after a run is drift. */
const GENERATED_PATHS = ['apps/landing/public/sitemap.xml']

const generated = run('bun', ['run', '--cwd', 'apps/landing', 'docs:gen'], { stdio: 'inherit' })
if (generated.status !== 0) {
  console.error('[generated] the landing generator failed; fix that before checking for drift.')
  process.exit(generated.status ?? 1)
}

// The Rust half of the shell <-> runtime contract is generated from TypeScript and committed. It is
// compared with a fresh render rather than through git, so an uncommitted edit on either side shows.
const contractProblem = checkRuntimeContract()
if (contractProblem) {
  console.error(`[generated] ${contractProblem}`)
  process.exit(1)
}

const status = run('git', ['status', '--porcelain', '--', ...GENERATED_PATHS])
const dirty = status.stdout.trim()

if (dirty === '') {
  console.log(
    `[generated] ${GENERATED_PATHS.length + 1} committed generated file(s) match their generators.`,
  )
  process.exit(0)
}

console.error('[generated] committed output does not match what the generator produces:\n')
console.error(dirty)
console.error(run('git', ['diff', '--', ...GENERATED_PATHS]).stdout)
console.error('Rerun the generator that owns the file above and commit the result:')
console.error('  sitemap.xml → bun run --cwd apps/landing docs:gen')
process.exit(1)
