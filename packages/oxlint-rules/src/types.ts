/**
 * The slice of the ESLint-compatible plugin API that oxlint actually hands a rule.
 *
 * Declared here rather than imported: oxlint's JS-plugin layer is alpha and ships no types, and
 * depending on `@types/eslint` would tie our rules to a linter we do not run. Every field below was
 * confirmed against `oxlint@1.77` by executing a probe rule, not read from documentation.
 */

/** An ESTree-shaped node. Rules narrow this themselves; the visitor keys are not typed. */
export interface Node {
  type: string
  [key: string]: unknown
}

export interface Fixer {
  replaceText(node: Node, text: string): unknown
}

export interface ReportDescriptor {
  node: Node
  message: string
  fix?: (fixer: Fixer) => unknown
}

export interface RuleContext {
  /** Absolute path of the file being linted. */
  filename: string
  report(descriptor: ReportDescriptor): void
}

/**
 * Visitor map: an ESTree node type (or `*`) to its handler.
 *
 * Values are optional so a rule can return `{}` to opt out of a file entirely — the scope check
 * every rule here runs first — without that empty object widening to a mismatched type.
 */
export type Visitor = Record<string, ((node: Node) => void) | undefined>

export interface Rule {
  meta?: { fixable?: 'code' | 'whitespace' }
  create(context: RuleContext): Visitor
}

export interface Plugin {
  meta: { name: string }
  rules: Record<string, Rule>
}
