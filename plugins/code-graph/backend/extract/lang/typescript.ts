import type { LanguageId } from '../../../shared/model'
import {
  ExtractionBuilder,
  hasToken,
  lineOf,
  MAX_DEPTH,
  namedChildren,
  type SyntaxNode,
} from '../builder'
import {
  constructedType,
  exportedNames,
  heritageOf,
  importBindings,
  reexportBindings,
  requireBindings,
  requireSpecifier,
  stringValue,
  typedParameters,
  typeName,
} from './typescript-syntax'

/**
 * TypeScript, TSX and JavaScript: the three grammars share these node types, and JavaScript simply
 * never produces the TypeScript-only ones.
 *
 * Symbols are the module-level declarations and class/interface members — the things another file
 * can name. A function nested inside a function is not one: it is its enclosing symbol's detail,
 * whose calls it contributes to. Recording it made every callback a node and buried the structure
 * a person opened the map to see.
 *
 * Types are tracked only where the source STATES them — a typed parameter, `new X()`, a typed or
 * constructed field — so `svc.run()` and `this.db.query()` can be linked without a type checker,
 * and nothing is inferred that the code does not say.
 */
interface Scope {
  /** The symbol calls in this subtree are attributed to. */
  owner: number | null
  /** The class or interface whose body this is, for members. */
  cls: number | null
  /** Inside a function body: declarations here are local, not symbols. */
  local: boolean
  exported: boolean
  isDefault: boolean
  /** Names with a stated type in this function (and the module): name → type as written. */
  vars: Map<string, string>
  depth: number
}

const FUNCTION_VALUES = new Set(['arrow_function', 'function_expression', 'function'])

const deeper = (scope: Scope, patch: Partial<Scope> = {}): Scope => ({
  ...scope,
  ...patch,
  depth: scope.depth + 1,
})

export function extractTypeScript(root: SyntaxNode, language: LanguageId, lines: number) {
  const out = new ExtractionBuilder()
  /** `export { a, b }` without a source marks declarations that appear anywhere in the file. */
  const exportedLater = new Set<string>()
  visit(root, {
    owner: null,
    cls: null,
    local: false,
    exported: false,
    isDefault: false,
    vars: new Map(),
    depth: 0,
  })
  for (const symbol of out.symbols) {
    if (symbol.parent === null && exportedLater.has(symbol.name)) symbol.exported = true
  }
  return out.build(language, lines)

  function visitChildren(node: SyntaxNode, scope: Scope) {
    for (const child of namedChildren(node)) visit(child, deeper(scope))
  }

  function visit(node: SyntaxNode, scope: Scope): void {
    if (scope.depth > MAX_DEPTH) return
    switch (node.type) {
      case 'import_statement': {
        const specifier = stringValue(node.childForFieldName('source'))
        if (specifier)
          out.addImport({ specifier, line: lineOf(node), bindings: importBindings(node) })
        return
      }
      case 'export_statement':
        return exportStatement(node, scope)
      case 'class_declaration':
      case 'abstract_class_declaration':
        return classDeclaration(node, scope)
      case 'interface_declaration':
        return interfaceDeclaration(node, scope)
      case 'type_alias_declaration':
      case 'enum_declaration': {
        const name = node.childForFieldName('name')?.text
        const kind = node.type === 'enum_declaration' ? 'enum' : 'type'
        if (name && !scope.local) out.addSymbol(node, name, kind, null, scope.exported)
        return
      }
      case 'function_declaration':
      case 'generator_function_declaration':
        return functionDeclaration(node, scope)
      case 'method_definition':
        return member(node, scope, node)
      case 'public_field_definition':
        return fieldDefinition(node, scope)
      case 'variable_declarator':
        return variableDeclarator(node, scope)
      case 'call_expression':
        return callExpression(node, scope)
      case 'new_expression': {
        const constructor = node.childForFieldName('constructor')
        if (constructor) callee(constructor, scope)
        const args = node.childForFieldName('arguments')
        if (args) visitChildren(args, scope)
        return
      }
      default:
        return visitChildren(node, scope)
    }
  }

  function exportStatement(node: SyntaxNode, scope: Scope) {
    const specifier = stringValue(node.childForFieldName('source'))
    if (specifier) {
      out.addImport({
        specifier,
        line: lineOf(node),
        bindings: reexportBindings(node),
        reexport: true,
      })
      return
    }
    const isDefault = hasToken(node, 'default')
    const declaration = node.childForFieldName('declaration') ?? node.childForFieldName('value')
    if (!declaration) {
      for (const name of exportedNames(node)) exportedLater.add(name)
      return
    }
    // `export default function () {}` has no name of its own; `default` is what importers bind.
    if (isDefault && FUNCTION_VALUES.has(declaration.type)) {
      const index = out.addSymbol(declaration, 'default', 'function', null, true, {
        isDefault: true,
      })
      return fn(declaration, scope, index)
    }
    visit(declaration, deeper(scope, { exported: true, isDefault }))
  }

  function classDeclaration(node: SyntaxNode, scope: Scope) {
    const name = node.childForFieldName('name')?.text
    const body = node.childForFieldName('body')
    if (!name || scope.local) {
      if (body) visitChildren(body, scope)
      return
    }
    const index = out.addSymbol(node, name, 'class', null, scope.exported, {
      isDefault: scope.isDefault,
    })
    if (index === null) return
    for (const entry of heritageOf(namedChildren(node), index)) out.addHeritage(entry)
    if (body)
      visitChildren(body, { ...scope, owner: index, cls: index, exported: false, isDefault: false })
  }

  function interfaceDeclaration(node: SyntaxNode, scope: Scope) {
    const name = node.childForFieldName('name')?.text
    if (!name || scope.local) return
    const index = out.addSymbol(node, name, 'interface', null, scope.exported)
    if (index === null) return
    for (const entry of heritageOf(namedChildren(node), index)) out.addHeritage(entry)
    const body = node.childForFieldName('body')
    // Method signatures are members: `svc.run()` on an interface-typed value links to them.
    for (const signature of body ? namedChildren(body) : []) {
      const member = signature.childForFieldName('name')
      const isMethod =
        signature.type === 'method_signature' ||
        (signature.type === 'property_signature' &&
          namedChildren(signature.childForFieldName('type') ?? signature)[0]?.type ===
            'function_type')
      if (member && isMethod) out.addSymbol(signature, member.text, 'method', index, false)
    }
  }

  function functionDeclaration(node: SyntaxNode, scope: Scope) {
    const name = node.childForFieldName('name')?.text
    const index =
      name && !scope.local
        ? out.addSymbol(node, name, 'function', null, scope.exported, {
            isDefault: scope.isDefault,
          })
        : null
    fn(node, scope, index)
  }

  /** A function body: its own variable scope, seeded with its typed parameters. */
  function fn(node: SyntaxNode, scope: Scope, index: number | null) {
    const vars = new Map(scope.vars)
    for (const parameter of typedParameters(node.childForFieldName('parameters'))) {
      vars.set(parameter.name, parameter.type)
    }
    const body = node.childForFieldName('body')
    if (body) visit(body, deeper(scope, { owner: index ?? scope.owner, local: true, vars }))
  }

  /** A class member function; `declaration` carries its parameters and body (the arrow of a field). */
  function member(node: SyntaxNode, scope: Scope, declaration: SyntaxNode) {
    const name = node.childForFieldName('name')
    const index =
      scope.cls !== null && name && name.type !== 'computed_property_name'
        ? out.addSymbol(node, name.text, 'method', scope.cls, false)
        : null
    if (name?.text === 'constructor') {
      for (const parameter of typedParameters(declaration.childForFieldName('parameters'))) {
        if (parameter.property) out.addField(scope.cls, parameter.name, parameter.type)
      }
    }
    fn(declaration, scope, index)
  }

  function fieldDefinition(node: SyntaxNode, scope: Scope) {
    const value = node.childForFieldName('value')
    if (value && FUNCTION_VALUES.has(value.type)) return member(node, scope, value)
    const name = node.childForFieldName('name')?.text
    if (name)
      out.addField(
        scope.cls,
        name,
        typeName(node.childForFieldName('type')) ?? constructedType(value),
      )
    if (value) visit(value, deeper(scope))
  }

  function variableDeclarator(node: SyntaxNode, scope: Scope) {
    const name = node.childForFieldName('name')
    const value = node.childForFieldName('value')
    if (name?.type === 'identifier') {
      const type = typeName(node.childForFieldName('type')) ?? constructedType(value)
      if (type) scope.vars.set(name.text, type)
    }
    if (!value) return
    const required = requireSpecifier(value)
    if (required && name) {
      return out.addImport({
        specifier: required,
        line: lineOf(value),
        bindings: requireBindings(name),
      })
    }
    if (!scope.local && name?.type === 'identifier' && FUNCTION_VALUES.has(value.type)) {
      return fn(value, scope, out.addSymbol(node, name.text, 'function', null, scope.exported))
    }
    // A module-level constant is a symbol other code names; its initialiser's calls are its own,
    // and anything declared inside that initialiser (a callback's locals) is local, not module.
    if (!scope.local && scope.cls === null && name?.type === 'identifier') {
      const index = out.addSymbol(node, name.text, 'variable', null, scope.exported)
      return visit(value, deeper(scope, { owner: index ?? scope.owner, local: true }))
    }
    visit(value, deeper(scope))
  }

  function callExpression(node: SyntaxNode, scope: Scope) {
    const fnNode = node.childForFieldName('function')
    const required = requireSpecifier(node)
    if (required) out.addImport({ specifier: required, line: lineOf(node), bindings: [] })
    else if (fnNode) callee(fnNode, scope)
    if (fnNode && fnNode.type !== 'identifier' && fnNode.type !== 'member_expression')
      visit(fnNode, scope)
    if (fnNode?.type === 'member_expression') {
      const object = fnNode.childForFieldName('object')
      if (object && object.type !== 'identifier' && object.type !== 'this') visit(object, scope)
    }
    const args = node.childForFieldName('arguments')
    if (args) visitChildren(args, scope)
  }

  function callee(target: SyntaxNode, scope: Scope) {
    if (target.type === 'identifier') return out.addCall(scope.owner, target)
    if (target.type !== 'member_expression') return
    const property = target.childForFieldName('property')
    const object = target.childForFieldName('object')
    if (!property || !object) return
    const nameable =
      object.type === 'identifier' ||
      object.type === 'this' ||
      object.type === 'super' ||
      object.type === 'member_expression'
    // A receiver the resolver cannot name (`get().x()`) still records the call's name: it is what
    // the unresolved count reports, and the resolver never guesses its target.
    const receiver = nameable ? object.text : '?'
    const head = receiver.split('.')[0] ?? ''
    out.addCall(scope.owner, property, receiver, scope.vars.get(head))
  }
}
