import { Fragment, h } from '@localixai/claude-plugin/mods'

/**
 * A bundled hooks module's exports, run in this process as its VM would run it — a function body
 * with the CommonJS wrapper's names, `h` and `Fragment` — but with nothing taken away. For tests
 * of the bundle itself; not a test itself.
 */
export function runBundle(code: string): Record<string, unknown> {
  const runtime = { [Symbol.for('localix.mods.claude-code')]: { h, Fragment } }
  const module = { exports: {} as Record<string, unknown> }
  // oxlint-disable-next-line typescript/no-implied-eval -- running the bundle's code is this helper's purpose
  const compiled = new Function(
    'globalThis',
    'exports',
    'require',
    'module',
    'h',
    'Fragment',
    `"use strict";\n{\n${code}\n}`,
  ) as (...args: unknown[]) => void
  compiled(runtime, module.exports, undefined, module, h, Fragment)
  return module.exports
}
