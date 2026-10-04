import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  forEachChild,
  isNamed,
  isNode,
  parseSource,
  type AstNode,
} from '@localixai/kit/testing/oxc-ast'

const SRC_ROOT = resolve(import.meta.dir, '../..')

/**
 * Every `fetch(...)` in one module, by how it was reached.
 *
 * Parsed with `oxc-parser`: the repo's own toolchain parser, and the only one left that can parse
 * a string standalone — TypeScript 7 dropped the compiler API from the `typescript` root export,
 * which is what had this suite (and `apps/ui`'s whole `tsc -b`) failing.
 */
function platformFetchCalls(path: string): Array<'direct' | 'global'> {
  const source = readFileSync(resolve(SRC_ROOT, path), 'utf8')
  const { program } = parseSource(path, source)
  const calls: Array<'direct' | 'global'> = []
  const visit = (node: AstNode) => {
    if (node.type === 'CallExpression') {
      const callee = node.callee
      if (isNamed(callee, 'fetch')) calls.push('direct')
      else if (
        isNode(callee) &&
        callee.type === 'MemberExpression' &&
        callee.computed === false &&
        isNamed(callee.property, 'fetch') &&
        (isNamed(callee.object, 'globalThis') || isNamed(callee.object, 'window'))
      ) {
        calls.push('global')
      }
    }
    forEachChild(node, visit)
  }
  visit(program)
  return calls
}

describe('application API transport boundary', () => {
  it('routes application requests through apiFetch instead of unobserved fetch calls', () => {
    const rawFetchCalls = [...new Bun.Glob('**/*.{ts,tsx}').scanSync({ cwd: SRC_ROOT })]
      .filter((path) => !path.includes('.test.'))
      .flatMap((path) => platformFetchCalls(path).map((kind) => `${path}:${kind}`))
      .sort()

    expect(rawFetchCalls).toEqual([
      // The preview liveness ping: a `no-cors` request at the user's OWN dev server, not an
      // application API call, so it deliberately bypasses `apiFetch` (which would add headers
      // a foreign origin must never see, and observe a request that is not ours).
      'features/inspector/model/previewPing.ts:direct',
      'shared/api/internal.ts:global',
      // The development readiness probe of `/health`. It IS the barrier `apiFetch` waits on, so
      // routing it through `apiFetch` would make the probe wait for itself.
      'shared/lib/runtimeReady.ts:global',
    ])
  })
})
