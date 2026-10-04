import { parseSync } from 'oxc-parser'

/**
 * The AST plumbing every source contract shares, the kit's and the host's.
 *
 * Parsed with `oxc-parser` — the repo's own toolchain parser, already the engine behind `oxlint`
 * and `scripts/check-architecture.mjs`. It replaced the TypeScript compiler API, which TypeScript 7
 * removed from the package's root export: `typescript` resolves to `lib/version.cjs` now, so
 * `ts.createSourceFile` and every `ts.is*` guard became a type error and took `apps/ui`'s `tsc -b`
 * — and with it the whole desktop build — down. TS 7 offers no standalone "parse this string" API
 * to port to; oxc does, and it is the parser the rest of the repo's lint layer already trusts.
 *
 * Structural, not textual, on purpose. These contracts assert nesting, call shapes and attributes,
 * and a regex that approximates those fails OPEN — the failure mode a guard must never have.
 *
 * Lives in the kit's `testing` door, not beside one of its consumers: the JSX contracts and the
 * transport boundary are in different slices, and the second one had already grown its own copy of
 * this walker before it moved here.
 */

/** An oxc AST node, walked structurally rather than through generated per-node types. */
export type AstNode = Record<string, unknown> & { type?: string }

export function isNode(value: unknown): value is AstNode {
  return typeof value === 'object' && value !== null && typeof (value as AstNode).type === 'string'
}

/** Depth-first over every own property, skipping the scalar leaves. */
export function forEachChild(node: AstNode, visit: (child: AstNode) => void): void {
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) visit(item)
    } else if (isNode(value)) visit(value)
  }
}

/** True when the node is an identifier spelled exactly `name`. */
export function isNamed(node: unknown, name: string): boolean {
  return isNode(node) && node.type === 'Identifier' && node.name === name
}

export interface ParsedSource {
  program: AstNode
  /** 1-based line for a byte offset. */
  lineAt: (offset: number) => number
}

/**
 * Parse one module, or throw naming the file that would not parse.
 *
 * Throwing, not returning empty: a guard that silently reads an empty AST reports zero violations
 * and passes everything, which is the one outcome worse than a failing guard.
 */
export function parseSource(sourcePath: string, source: string): ParsedSource {
  const result = parseSync(sourcePath, source, {
    sourceType: 'module',
    lang: sourcePath.endsWith('.tsx') ? 'tsx' : 'ts',
  })
  const fatal = result.errors[0]
  if (fatal) throw new Error(`${sourcePath} did not parse: ${fatal.message}`)
  return { program: result.program as unknown as AstNode, lineAt: lineCounter(source) }
}

/**
 * Index the line starts once and binary-search them.
 *
 * The offsets arrive sorted within one walk but not across the several closures a contract hands
 * out, and `source.slice(0, offset).split('\n').length` turns a 900-line file into a quadratic scan
 * once a suite asks for a few hundred lines.
 */
function lineCounter(source: string): (offset: number) => number {
  const starts = [0]
  for (let i = 0; i < source.length; i += 1) if (source[i] === '\n') starts.push(i + 1)
  return (offset) => {
    let low = 0
    let high = starts.length - 1
    while (low < high) {
      const mid = (low + high + 1) >> 1
      if (starts[mid]! <= offset) low = mid
      else high = mid - 1
    }
    return low + 1
  }
}
