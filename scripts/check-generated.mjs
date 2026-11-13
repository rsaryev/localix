#!/usr/bin/env bun
/**
 * A generated file that is COMMITTED must match what its generator produces right now.
 *
 * There are two in this repository: the desktop icon set (`scripts/app-icons.mjs`) and the Rust
 * half of the shell <-> runtime contract (`scripts/runtime-contract.mjs`). The website's sitemap
 * is not one: `site/` writes it into `dist/` on every build, so nothing committed can drift.
 */
import { checkAppIcons } from './app-icons.mjs'
import { checkRuntimeContract } from './runtime-contract.mjs'

// The Rust half of the shell <-> runtime contract is generated from TypeScript and committed. It is
// compared with a fresh render rather than through git, so an uncommitted edit on either side shows.
const contractProblem = checkRuntimeContract()
if (contractProblem) {
  console.error(`[generated] ${contractProblem}`)
  process.exit(1)
}

// The desktop icon set is drawn from assets/logo.svg; its manifest's digests say whether the
// committed rasters are still what that vector draws, without redrawing them (no renderer needed).
const iconProblem = checkAppIcons()
if (iconProblem) {
  console.error(`[generated] ${iconProblem}`)
  process.exit(1)
}

console.log('[generated] 2 committed generated sets match their generators.')
