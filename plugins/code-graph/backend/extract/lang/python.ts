import type { ImportBinding } from '../types'
import { ExtractionBuilder, lineOf, MAX_DEPTH, namedChildren, type SyntaxNode } from '../builder'

/**
 * Python. Module-level functions and classes are symbols, and so are the functions directly in a
 * class body (methods); a function nested in a function is its enclosing symbol's detail, as in
 * the TypeScript walker. A name without a leading underscore counts as exported — Python's own
 * convention for what a module offers.
 *
 * Imports keep the dotted module as written, relative dots included (`..pkg.mod`); the resolver
 * turns that into a file, because only it knows the project's package roots.
 */
interface Scope {
  owner: number | null
  cls: number | null
  local: boolean
  /** The class a method belongs to, so `self.x = Repo()` in its body types the field. */
  selfClass: number | null
  /** Names with a stated type in this function (and the module): a typed parameter, `x = Foo()`. */
  vars: Map<string, string>
  depth: number
}

/** `Svc`, `mod.Svc`; a subscripted or built-in annotation is not a project class. */
function annotated(node: SyntaxNode | null | undefined): string | null {
  const inner = node?.type === 'type' ? namedChildren(node)[0] : node
  return inner && (inner.type === 'identifier' || inner.type === 'attribute') ? inner.text : null
}

/** What `x = Foo()` / `x = mod.Foo()` constructs — if `Foo` turns out to be a class. */
function calledName(node: SyntaxNode | null | undefined): string | null {
  const fn = node?.type === 'call' ? node.childForFieldName('function') : null
  return fn && (fn.type === 'identifier' || fn.type === 'attribute') ? fn.text : null
}

export function extractPython(root: SyntaxNode, lines: number) {
  const out = new ExtractionBuilder()
  const globals = new Set<string>()
  visit(root, { owner: null, cls: null, local: false, selfClass: null, vars: new Map(), depth: 0 })
  return out.build('python', lines)

  function visitChildren(node: SyntaxNode, scope: Scope) {
    for (const child of namedChildren(node)) visit(child, { ...scope, depth: scope.depth + 1 })
  }

  function visit(node: SyntaxNode, scope: Scope): void {
    if (scope.depth > MAX_DEPTH) return
    switch (node.type) {
      case 'import_statement':
        return importStatement(node)
      case 'import_from_statement':
        return importFrom(node)
      case 'class_definition':
        return classDefinition(node, scope)
      case 'function_definition':
        return functionDefinition(node, scope)
      case 'call':
        return call(node, scope)
      case 'assignment':
        return assignment(node, scope)
      default:
        return visitChildren(node, scope)
    }
  }

  function assignment(node: SyntaxNode, scope: Scope) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    const type = annotated(node.childForFieldName('type')) ?? calledName(right)
    if (left?.type === 'identifier' && type) scope.vars.set(left.text, type)
    else if (left?.type === 'attribute' && left.childForFieldName('object')?.text === 'self') {
      out.addField(scope.selfClass, left.childForFieldName('attribute')?.text ?? '', type)
    }
    // A module global (`LIMIT = 5`, `client = Client()`) is a symbol other modules import; the
    // first assignment declares it, and its right side's calls are its own.
    // Only the FIRST: a reassignment is the same global, and a second symbol would make the name
    // ambiguous — which the resolver answers with no link at all.
    const declared =
      !scope.local && scope.cls === null && left?.type === 'identifier' && !globals.has(left.text)
        ? out.addSymbol(node, left.text, 'variable', null, !left.text.startsWith('_'))
        : null
    if (declared !== null && left) globals.add(left.text)
    if (right) visit(right, { ...scope, owner: declared ?? scope.owner, depth: scope.depth + 1 })
  }

  /** `import a.b` binds `a.b` as a module; `import a.b as c` binds `c`. */
  function importStatement(node: SyntaxNode) {
    for (const part of namedChildren(node)) {
      const dotted = part.type === 'aliased_import' ? part.childForFieldName('name') : part
      if (dotted?.type !== 'dotted_name') continue
      const local = part.type === 'aliased_import' ? part.childForFieldName('alias')?.text : null
      out.addImport({
        specifier: dotted.text,
        line: lineOf(node),
        bindings: [{ local: local ?? dotted.text, imported: '*' }],
      })
    }
  }

  function importFrom(node: SyntaxNode) {
    const module = node.childForFieldName('module_name')
    if (!module) return
    const bindings: ImportBinding[] = []
    for (const part of namedChildren(node)) {
      if (part.equals(module)) continue
      if (part.type === 'wildcard_import') bindings.push({ local: '*', imported: '*' })
      else if (part.type === 'dotted_name') bindings.push({ local: part.text, imported: part.text })
      else if (part.type === 'aliased_import') {
        const name = part.childForFieldName('name')?.text
        const alias = part.childForFieldName('alias')?.text
        if (name) bindings.push({ local: alias ?? name, imported: name })
      }
    }
    out.addImport({ specifier: module.text, line: lineOf(node), bindings })
  }

  function classDefinition(node: SyntaxNode, scope: Scope) {
    const name = node.childForFieldName('name')?.text
    const body = node.childForFieldName('body')
    if (!name || scope.local) {
      if (body) visitChildren(body, scope)
      return
    }
    const index = out.addSymbol(node, name, 'class', scope.cls, !name.startsWith('_'))
    if (index === null) return
    const bases = node.childForFieldName('superclasses')
    for (const base of bases ? namedChildren(bases) : []) {
      if (base.type === 'identifier') {
        out.addHeritage({ symbol: index, kind: 'extends', name: base.text, line: lineOf(base) })
      } else if (base.type === 'attribute') {
        const attribute = base.childForFieldName('attribute')?.text
        const object = base.childForFieldName('object')?.text
        if (attribute) {
          out.addHeritage({
            symbol: index,
            kind: 'extends',
            name: attribute,
            ...(object ? { receiver: object } : {}),
            line: lineOf(base),
          })
        }
      }
    }
    if (body) visitChildren(body, { ...scope, owner: index, cls: index })
  }

  function functionDefinition(node: SyntaxNode, scope: Scope) {
    const name = node.childForFieldName('name')?.text
    const body = node.childForFieldName('body')
    const index =
      name && !scope.local
        ? out.addSymbol(
            node,
            name,
            scope.cls !== null ? 'method' : 'function',
            scope.cls,
            !name.startsWith('_') || (name.startsWith('__') && name.endsWith('__')),
          )
        : null
    const vars = new Map(scope.vars)
    for (const parameter of namedChildren(node.childForFieldName('parameters') ?? node)) {
      if (parameter.type !== 'typed_parameter' && parameter.type !== 'typed_default_parameter')
        continue
      const name =
        parameter.childForFieldName('name')?.text ??
        namedChildren(parameter).find((child) => child.type === 'identifier')?.text
      const type = annotated(parameter.childForFieldName('type'))
      if (name && type) vars.set(name, type)
    }
    if (body) {
      visit(body, {
        owner: index ?? scope.owner,
        cls: null,
        local: true,
        selfClass: scope.cls ?? scope.selfClass,
        vars,
        depth: scope.depth + 1,
      })
    }
  }

  function call(node: SyntaxNode, scope: Scope) {
    const fn = node.childForFieldName('function')
    if (fn?.type === 'identifier') out.addCall(scope.owner, fn)
    else if (fn?.type === 'attribute') {
      const attribute = fn.childForFieldName('attribute')
      const object = fn.childForFieldName('object')
      const receiver =
        object && (object.type === 'identifier' || object.type === 'attribute') ? object.text : '?'
      if (attribute) {
        const head = receiver.split('.')[0] ?? ''
        out.addCall(scope.owner, attribute, receiver, scope.vars.get(head))
      }
      if (object && object.type !== 'identifier' && object.type !== 'attribute') {
        visit(object, scope)
      }
    } else if (fn) visit(fn, scope)
    const args = node.childForFieldName('arguments')
    if (args) visitChildren(args, scope)
  }
}
