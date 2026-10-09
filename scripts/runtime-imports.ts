import { parseSync, Visitor } from 'oxc-parser'

/**
 * Statically resolved ESM dependencies, excluding declaration-level type imports.
 * Inline type specifiers can retain an empty import under verbatimModuleSyntax,
 * so their module evaluation must still be considered by browser graph guards.
 */
export function runtimeImports(source: string, filename = 'fixture.ts'): string[] {
  const parsed = parseSync(filename, source)
  if (parsed.errors.length > 0) throw new Error(`Cannot inspect imports in ${filename}`)
  const found = new Set<string>()
  new Visitor({
    ImportDeclaration(node) {
      if (node.importKind !== 'type') found.add(node.source.value)
    },
    ExportAllDeclaration(node) {
      if (node.exportKind !== 'type') found.add(node.source.value)
    },
    ExportNamedDeclaration(node) {
      if (node.source && node.exportKind !== 'type') found.add(node.source.value)
    },
    ImportExpression(node) {
      const source = node.source
      if (source.type === 'Literal' && typeof source.value === 'string') {
        found.add(source.value)
      } else if (source.type === 'TemplateLiteral' && source.expressions.length === 0) {
        const value = source.quasis[0]?.value.cooked
        if (value != null) found.add(value)
      }
    },
  }).visit(parsed.program)
  return [...found]
}
