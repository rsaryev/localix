import type { ExtractedHeritage, ImportBinding } from '../types'
import { hasToken, lineOf, namedChildren, type SyntaxNode } from '../builder'

/**
 * What individual TypeScript/JavaScript nodes spell, with no knowledge of where the walk is:
 * import and export bindings, inheritance clauses, declared types. The walker decides what a
 * declaration means in context; these only read syntax, so each is testable through the extractor
 * and none can drift from another's reading of the same node.
 */

export function stringValue(node: SyntaxNode | null | undefined): string | null {
  if (node?.type !== 'string') return null
  const fragment = namedChildren(node).find((child) => child.type === 'string_fragment')
  return fragment?.text ?? null
}

/** The literal a `require('x')` or `import('x')` names, or null for any other call. */
export function requireSpecifier(node: SyntaxNode): string | null {
  if (node.type !== 'call_expression') return null
  const fn = node.childForFieldName('function')
  const isRequire = fn?.type === 'identifier' && fn.text === 'require'
  if (!isRequire && fn?.type !== 'import') return null
  const first = node.childForFieldName('arguments')?.namedChild(0)
  return first ? stringValue(first) : null
}

/** What `const x = require(…)` / `const { a, b: c } = require(…)` binds. */
export function requireBindings(name: SyntaxNode): ImportBinding[] {
  if (name.type === 'identifier') return [{ local: name.text, imported: '*' }]
  const bindings: ImportBinding[] = []
  for (const part of name.type === 'object_pattern' ? namedChildren(name) : []) {
    if (part.type === 'shorthand_property_identifier_pattern') {
      bindings.push({ local: part.text, imported: part.text })
    } else if (part.type === 'pair_pattern') {
      const key = part.childForFieldName('key')?.text
      const value = part.childForFieldName('value')
      if (key && value?.type === 'identifier') bindings.push({ local: value.text, imported: key })
    }
  }
  return bindings
}

/** `import D, { a as b } from`, `import * as ns from`. */
export function importBindings(node: SyntaxNode): ImportBinding[] {
  const bindings: ImportBinding[] = []
  const clause = namedChildren(node).find((child) => child.type === 'import_clause')
  for (const part of clause ? namedChildren(clause) : []) {
    if (part.type === 'identifier') bindings.push({ local: part.text, imported: 'default' })
    else if (part.type === 'namespace_import') {
      const local = namedChildren(part).find((child) => child.type === 'identifier')
      if (local) bindings.push({ local: local.text, imported: '*' })
    } else if (part.type === 'named_imports') {
      for (const spec of namedChildren(part)) {
        if (spec.type !== 'import_specifier') continue
        const name = spec.childForFieldName('name')?.text
        const alias = spec.childForFieldName('alias')?.text
        if (name) bindings.push({ local: alias ?? name, imported: name })
      }
    }
  }
  return bindings
}

/** `export { a as b } from`, `export * as ns from`, `export * from` (every name). */
export function reexportBindings(node: SyntaxNode): ImportBinding[] {
  const bindings: ImportBinding[] = []
  for (const part of namedChildren(node)) {
    if (part.type === 'export_clause') {
      for (const spec of namedChildren(part)) {
        const name = spec.childForFieldName('name')?.text
        const alias = spec.childForFieldName('alias')?.text
        if (name) bindings.push({ local: alias ?? name, imported: name })
      }
    } else if (part.type === 'namespace_export') {
      const local = namedChildren(part)[0]?.text
      if (local) bindings.push({ local, imported: '*' })
    }
  }
  return bindings.length > 0 ? bindings : [{ local: '*', imported: '*' }]
}

/** Names listed by a sourceless `export { a, b }`. */
export function exportedNames(node: SyntaxNode): string[] {
  const names: string[] = []
  for (const part of namedChildren(node)) {
    if (part.type !== 'export_clause') continue
    for (const spec of namedChildren(part)) {
      const name = spec.childForFieldName('name')?.text
      if (name) names.push(name)
    }
  }
  return names
}

/** The bases a class or interface declares, from its heritage or `extends` clause nodes. */
export function heritageOf(clauses: SyntaxNode[], symbol: number): ExtractedHeritage[] {
  const out: ExtractedHeritage[] = []
  const base = (node: SyntaxNode, kind: 'extends' | 'implements') => {
    const target = node.type === 'generic_type' ? (node.childForFieldName('name') ?? node) : node
    const line = lineOf(node)
    if (target.type === 'identifier' || target.type === 'type_identifier') {
      out.push({ symbol, kind, name: target.text, line })
    } else if (target.type === 'member_expression' || target.type === 'nested_type_identifier') {
      const parts = target.text.split('.')
      const name = parts.pop()
      if (name) out.push({ symbol, kind, name, receiver: parts.join('.'), line })
    }
  }
  for (const clause of clauses) {
    if (clause.type === 'extends_clause') {
      const value = clause.childForFieldName('value')
      if (value) base(value, 'extends')
    } else if (clause.type === 'implements_clause') {
      for (const type of namedChildren(clause)) base(type, 'implements')
    } else if (clause.type === 'extends_type_clause') {
      for (const type of namedChildren(clause)) base(type, 'extends')
    } else if (clause.type === 'class_heritage') {
      const inner = namedChildren(clause)
      // JavaScript puts the base expression straight into the heritage node.
      if (inner.some((c) => c.type.endsWith('_clause'))) out.push(...heritageOf(inner, symbol))
      else for (const expression of inner) base(expression, 'extends')
    }
  }
  return out
}

/**
 * The named type a declaration states: `Db<X>` → `Db`, `ns.Svc` → `ns.Svc`. Arrays, unions,
 * literals and built-ins answer null — a method called on them is the language's, not the project's.
 */
export function typeName(node: SyntaxNode | null | undefined): string | null {
  if (!node) return null
  const type = node.type === 'type_annotation' ? namedChildren(node)[0] : node
  if (!type) return null
  if (type.type === 'type_identifier' || type.type === 'nested_type_identifier') return type.text
  if (type.type === 'generic_type') return typeName(type.childForFieldName('name'))
  return null
}

/** The class a `new X()` / `new ns.X()` constructs. */
export function constructedType(node: SyntaxNode | null | undefined): string | null {
  if (node?.type !== 'new_expression') return null
  const constructor = node.childForFieldName('constructor')
  return constructor?.type === 'identifier' || constructor?.type === 'member_expression'
    ? constructor.text
    : null
}

export interface TypedParameter {
  name: string
  type: string
  /** A constructor parameter property (`private svc: Service`): also a field of the class. */
  property: boolean
}

export function typedParameters(parameters: SyntaxNode | null): TypedParameter[] {
  const typed: TypedParameter[] = []
  for (const parameter of parameters ? namedChildren(parameters) : []) {
    if (parameter.type !== 'required_parameter' && parameter.type !== 'optional_parameter') continue
    const pattern = parameter.childForFieldName('pattern')
    const type = typeName(parameter.childForFieldName('type'))
    if (pattern?.type !== 'identifier' || !type) continue
    const property =
      namedChildren(parameter).some((child) => child.type === 'accessibility_modifier') ||
      hasToken(parameter, 'readonly')
    typed.push({ name: pattern.text, type, property })
  }
  return typed
}
