import { Fragment, h } from '@localixai/claude-plugin/mods'
import { compileHooksBundle } from './isolation/lockdown'

/**
 * A bundled hooks module's exports, run in this process as its worker would run it but without
 * taking anything away from the process. For tests of the bundle itself; not a test itself.
 */
export function runBundle(code: string): Record<string, unknown> {
  const runtime = { [Symbol.for('localix.mods.claude-code')]: { h, Fragment } }
  return compileHooksBundle(code, 'hooks.cjs')({ global: runtime, unbound: { h, Fragment } })
}
