import { ExtractionBuilder, lineOf, MAX_DEPTH, namedChildren, type SyntaxNode } from '../builder'

/**
 * Go. A package is a directory, so this walker only records what the file says; the resolver joins
 * the files of one directory into one namespace.
 *
 * Methods are declared outside their type, often in another file. A method whose receiver type is
 * declared in THIS file becomes that type's member; otherwise it keeps the type's name as its
 * qualifier (`Server.Start`) and hangs off the file — a parent in another file would be a guess
 * made before the other file is known.
 *
 * Struct and interface embedding is recorded as `extends`: it is how Go composes behaviour, and
 * what a person tracing where a method comes from needs to follow.
 */
const exportedName = (name: string) => /^[A-Z]/.test(name)

/** `*DB` → `DB`, `store.S` stays qualified, `List[T]` → `List`; slices, maps, funcs → null. */
function goType(node: SyntaxNode | null | undefined): string | null {
  if (!node) return null
  if (node.type === 'pointer_type') return goType(namedChildren(node)[0])
  if (node.type === 'generic_type') return goType(node.childForFieldName('type'))
  return node.type === 'type_identifier' || node.type === 'qualified_type' ? node.text : null
}

/** What `&Foo{}` / `Foo{}` builds. */
function literalType(node: SyntaxNode | null | undefined): string | null {
  const literal = node?.type === 'unary_expression' ? node.childForFieldName('operand') : node
  return literal?.type === 'composite_literal' ? goType(literal.childForFieldName('type')) : null
}

/** Names bound by a parameter list, with their declared types. */
function typedNames(parameters: SyntaxNode | null, vars: Map<string, string>) {
  for (const parameter of parameters ? namedChildren(parameters) : []) {
    const type = goType(parameter.childForFieldName('type'))
    if (!type) continue
    for (const child of namedChildren(parameter)) {
      if (child.type === 'identifier') vars.set(child.text, type)
    }
  }
}

export function extractGo(root: SyntaxNode, lines: number) {
  const out = new ExtractionBuilder()
  const pendingMethods: Array<{ index: number; receiver: string }> = []
  let vars = new Map<string, string>()
  visit(root, null, 0)
  // Types may be declared after their methods; attach once the whole file is known.
  const types = new Map<string, number>()
  out.symbols.forEach((symbol, index) => {
    if (symbol.parent === null && symbol.kind !== 'function' && symbol.kind !== 'method') {
      types.set(symbol.name, index)
    }
  })
  for (const { index, receiver } of pendingMethods) {
    const owner = types.get(receiver)
    const symbol = out.symbols[index]
    if (!symbol) continue
    if (owner === undefined) symbol.qualifier = receiver
    else symbol.parent = owner
  }
  return out.build('go', lines)

  function visit(node: SyntaxNode, owner: number | null, depth: number): void {
    if (depth > MAX_DEPTH) return
    switch (node.type) {
      case 'package_clause':
        out.packageName = namedChildren(node)[0]?.text
        return
      case 'import_spec':
        return importSpec(node)
      case 'function_declaration': {
        const name = node.childForFieldName('name')?.text
        const index = name ? out.addSymbol(node, name, 'function', null, exportedName(name)) : null
        return body(node, index, depth)
      }
      case 'method_declaration':
        return methodDeclaration(node, depth)
      case 'type_spec':
      case 'type_alias':
        return typeSpec(node)
      case 'call_expression':
        return callExpression(node, owner, depth)
      case 'short_var_declaration': {
        const names = namedChildren(node.childForFieldName('left') ?? node)
        const values = namedChildren(node.childForFieldName('right') ?? node)
        names.forEach((name, index) => {
          const type = literalType(values[index])
          if (name.type === 'identifier' && type) vars.set(name.text, type)
        })
        for (const value of values) visit(value, owner, depth + 1)
        return
      }
      case 'var_spec':
      case 'const_spec': {
        const type = goType(node.childForFieldName('type'))
        // At package level (no enclosing function) each name is a symbol the package offers.
        let declared: number | null = null
        for (const child of namedChildren(node)) {
          if (child.type !== 'identifier') continue
          if (type) vars.set(child.text, type)
          if (owner === null) {
            declared =
              out.addSymbol(child, child.text, 'variable', null, exportedName(child.text)) ??
              declared
          }
        }
        for (const child of namedChildren(node)) {
          if (child.type !== 'identifier') visit(child, owner ?? declared, depth + 1)
        }
        return
      }
      default:
        for (const child of namedChildren(node)) visit(child, owner, depth + 1)
    }
  }

  /** A function or method body: its own variable scope, seeded with the typed parameters. */
  function body(node: SyntaxNode, index: number | null, depth: number, seed?: Map<string, string>) {
    const outer = vars
    vars = new Map(seed ?? outer)
    typedNames(node.childForFieldName('parameters'), vars)
    const block = node.childForFieldName('body')
    if (block) visit(block, index, depth + 1)
    vars = outer
  }

  function importSpec(node: SyntaxNode) {
    const path = node.childForFieldName('path')
    const content = path ? namedChildren(path)[0]?.text : undefined
    if (!content) return
    const alias = node.childForFieldName('name')?.text
    // `_` imports only for side effects and `.` merges the package into this file's scope; neither
    // binds a receiver name, and an empty local tells the resolver to use the package's own name.
    const local = alias && alias !== '_' && alias !== '.' ? alias : ''
    out.addImport({ specifier: content, line: lineOf(node), bindings: [{ local, imported: '*' }] })
  }

  function methodDeclaration(node: SyntaxNode, depth: number) {
    const name = node.childForFieldName('name')?.text
    const receiver = receiverType(node.childForFieldName('receiver'))
    const index = name ? out.addSymbol(node, name, 'method', null, exportedName(name)) : null
    if (index !== null && receiver) pendingMethods.push({ index, receiver })
    // The receiver is a typed parameter like any other: `s.store.Get()` starts from its type.
    const seed = new Map(vars)
    typedNames(node.childForFieldName('receiver'), seed)
    body(node, index, depth, seed)
  }

  function typeSpec(node: SyntaxNode) {
    const name = node.childForFieldName('name')?.text
    const type = node.childForFieldName('type')
    if (!name) return
    const kind =
      type?.type === 'struct_type'
        ? 'class'
        : type?.type === 'interface_type'
          ? 'interface'
          : 'type'
    const index = out.addSymbol(node, name, kind, null, exportedName(name))
    if (index === null || !type) return
    for (const [field, fieldType] of namedFields(type)) out.addField(index, field, fieldType)
    // An interface's methods are members: a call through an interface-typed value links to them.
    if (type.type === 'interface_type') {
      for (const element of namedChildren(type)) {
        const method =
          element.type === 'method_elem' ? element.childForFieldName('name')?.text : null
        if (method) out.addSymbol(element, method, 'method', index, exportedName(method))
      }
    }
    for (const embedded of embeddedTypes(type)) {
      const [receiver, base] = embedded.includes('.')
        ? embedded.split('.', 2)
        : [undefined, embedded]
      if (!base) continue
      out.addHeritage({
        symbol: index,
        kind: 'extends',
        name: base,
        ...(receiver ? { receiver } : {}),
        line: lineOf(type),
      })
    }
  }

  function callExpression(node: SyntaxNode, owner: number | null, depth: number) {
    const fn = node.childForFieldName('function')
    if (fn?.type === 'identifier') out.addCall(owner, fn)
    else if (fn?.type === 'selector_expression') {
      const field = fn.childForFieldName('field')
      const operand = fn.childForFieldName('operand')
      // `s.store.Get()`: a chain of plain selectors is a nameable receiver; anything else is not.
      const receiver =
        operand && /^[A-Za-z_][\w]*(\.[A-Za-z_][\w]*)*$/.test(operand.text) ? operand.text : '?'
      if (field) {
        out.addCall(owner, field, receiver, vars.get(receiver.split('.')[0] ?? ''))
      }
      if (operand && operand.type !== 'identifier' && receiver === '?')
        visit(operand, owner, depth + 1)
    } else if (fn) visit(fn, owner, depth + 1)
    const args = node.childForFieldName('arguments')
    if (args) for (const child of namedChildren(args)) visit(child, owner, depth + 1)
  }
}

function receiverType(receiver: SyntaxNode | null): string | null {
  const parameter = receiver ? namedChildren(receiver)[0] : undefined
  let type = parameter?.childForFieldName('type') ?? null
  if (type?.type === 'pointer_type') type = namedChildren(type)[0] ?? null
  if (type?.type === 'generic_type') type = type.childForFieldName('type')
  return type?.type === 'type_identifier' ? type.text : null
}

/** A struct's named fields with their types: `db *DB` → [db, DB]; `a, b Store` → both. */
function namedFields(type: SyntaxNode): Array<[string, string]> {
  if (type.type !== 'struct_type') return []
  const fields = namedChildren(type).find((child) => child.type === 'field_declaration_list')
  const named: Array<[string, string]> = []
  for (const field of fields ? namedChildren(fields) : []) {
    const fieldType = goType(field.childForFieldName('type'))
    if (!fieldType) continue
    for (const child of namedChildren(field)) {
      if (child.type === 'field_identifier') named.push([child.text, fieldType])
    }
  }
  return named
}

/** The anonymous fields of a struct and the embedded interfaces of an interface. */
function embeddedTypes(type: SyntaxNode): string[] {
  const names: string[] = []
  if (type.type === 'struct_type') {
    const fields = namedChildren(type).find((child) => child.type === 'field_declaration_list')
    for (const field of fields ? namedChildren(fields) : []) {
      if (field.childForFieldName('name')) continue
      let embedded = field.childForFieldName('type')
      if (embedded?.type === 'pointer_type') embedded = namedChildren(embedded)[0] ?? null
      if (embedded?.type === 'type_identifier' || embedded?.type === 'qualified_type') {
        names.push(embedded.text)
      }
    }
  } else if (type.type === 'interface_type') {
    for (const element of namedChildren(type)) {
      if (element.type !== 'type_elem') continue
      const embedded = namedChildren(element)[0]
      if (embedded?.type === 'type_identifier' || embedded?.type === 'qualified_type') {
        names.push(embedded.text)
      }
    }
  }
  return names
}
