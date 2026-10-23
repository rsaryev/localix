/**
 * The JavaScript TypeScript compiler the plugin kit needs, and ONLY the plugin kit.
 *
 * The workspace type-checks with TypeScript 7, whose compiler is native and ships no JavaScript
 * API. The kit needs one: it reads the host kit's real types to write its declarations, and it
 * ships a compiler an installed app can run on every platform. That compiler used to be a root
 * alias (`plugin-kit-typescript` → `typescript@5.9.3`), and both it and TypeScript 7 publish a
 * `tsc` binary — so which one `node_modules/.bin/tsc` became was the package manager's pick. When
 * the alias won, every workspace's `bun run type-check` ran TypeScript 5.9 against code written for
 * 7, and the UI failed with hundreds of narrowing errors that no source change had caused.
 *
 * As this package's own dependency the JavaScript compiler (6.x, the last line with that API), and
 * its binary, stay inside this package.
 */
import { dirname } from 'node:path'
import { createRequire } from 'node:module'
import ts from 'typescript'

export default ts

/** The compiler package's directory: what the kit copies `lib/` and `package.json` from. */
export const compilerDir = dirname(
  createRequire(import.meta.url).resolve('typescript/package.json'),
)
