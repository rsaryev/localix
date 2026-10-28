#!/usr/bin/env bun
// The workspace's type-check entry: runs the repository's `tsc` with a bounded number of checker
// threads. TypeScript 7 checks with 4 threads per process by default, and Turbo runs several
// processes at once, so an unbounded run asks for several times the machine's cores. The default
// here is 2; `LOCALIX_TSC_CHECKERS` (CI or a big machine) overrides it, and a `--checkers` or
// `--singleThreaded` flag on the command line wins over both.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const bounded = args.some((a) => a === '--singleThreaded' || a.startsWith('--checkers'))
const checkers = process.env.LOCALIX_TSC_CHECKERS || '2'
// TypeScript's launcher is a `#!/usr/bin/env node` script that execs the native compiler; it runs
// on this script's own runtime (Bun), so a type-check never needs Node installed.
const tsc = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url))

// Build mode (`-b`) must stay the first argument.
const build = args[0] === '-b' || args[0] === '--build'
const flags = bounded ? [] : ['--checkers', checkers]
const argv = build ? [args[0], ...flags, ...args.slice(1)] : [...flags, ...args]
const result = spawnSync(process.execPath, [tsc, ...argv], { stdio: 'inherit' })
process.exit(result.status ?? 1)
