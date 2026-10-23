import type { LanguageId } from '../../shared/model'
import type { ExtractedRef } from './types'
import type { SyntaxNode } from './builder'

/**
 * Every place a file NAMES something — a type in an annotation, an imported constant, `ns.helper`,
 * `pkg.Type` — so a code card can make it a link, the way an editor's go-to-definition does.
 *
 * One walk, the same for every language, driven by a small table of what each grammar calls things;
 * the resolver later keeps only the names that reach a project declaration. What is left out on
 * purpose: a name being DECLARED (a function's own name, a parameter, the left side of an
 * assignment) is not a use of anything, and a name declared locally in a function shadows any
 * import of the same name there — linking it would send the reader to the wrong definition.
 */
interface RefSyntax {
  /** Leaf node types that may name a declaration. */
  names: ReadonlySet<string>
  /** Qualified names: node type → [object field, property field]; `ns.helper` is one reference. */
  qualified: Readonly<Record<string, readonly [string, string]>>
  /** Field names under which an identifier is being declared, not used. */
  declaringFields: ReadonlySet<string>
  /** Parent types whose identifier children are declarations (patterns, parameter lists). */
  declaringParents: ReadonlySet<string>
  /**
   * Lists and patterns that pass "being declared" on to their children: `x, y := …` puts both names
   * in an `expression_list` under the `left` field, and neither is a use.
   */
  declaringContainers: ReadonlySet<string>
  /** `parent/field` pairs whose identifier is neither a use nor a declaration (`f(a=1)`'s `a`). */
  ignored: ReadonlySet<string>
  /** Node types that open a function scope, for locals. */
  functions: ReadonlySet<string>
}

const TYPESCRIPT: RefSyntax = {
  names: new Set([
    'identifier',
    'type_identifier',
    'shorthand_property_identifier',
    'shorthand_property_identifier_pattern',
  ]),
  qualified: {
    member_expression: ['object', 'property'],
    nested_type_identifier: ['module', 'name'],
  },
  declaringFields: new Set(['name', 'alias', 'pattern', 'parameter', 'label', 'key']),
  declaringParents: new Set(['import_clause', 'namespace_import']),
  declaringContainers: new Set([
    'object_pattern',
    'array_pattern',
    'rest_pattern',
    'pair_pattern',
    'assignment_pattern',
  ]),
  ignored: new Set(),
  functions: new Set([
    'function_declaration',
    'generator_function_declaration',
    'function_expression',
    'arrow_function',
    'method_definition',
  ]),
}

const PYTHON: RefSyntax = {
  names: new Set(['identifier']),
  qualified: { attribute: ['object', 'attribute'] },
  declaringFields: new Set(['name', 'alias', 'left']),
  declaringParents: new Set([
    'parameters',
    'typed_parameter',
    'lambda_parameters',
    'dotted_name',
    'aliased_import',
    'global_statement',
    'nonlocal_statement',
  ]),
  declaringContainers: new Set([
    'pattern_list',
    'tuple_pattern',
    'list_pattern',
    'list_splat_pattern',
  ]),
  // `foo().bar`: the attribute of an unnamed object names a member, never a module-level `bar`.
  ignored: new Set(['keyword_argument/name', 'attribute/attribute']),
  functions: new Set(['function_definition', 'lambda']),
}

const GO: RefSyntax = {
  names: new Set(['identifier', 'type_identifier']),
  qualified: {
    selector_expression: ['operand', 'field'],
    qualified_type: ['package', 'name'],
  },
  declaringFields: new Set(['name', 'left', 'label']),
  declaringParents: new Set([
    'parameter_declaration',
    'variadic_parameter_declaration',
    'import_spec',
  ]),
  declaringContainers: new Set(['expression_list']),
  ignored: new Set(['keyed_element/key']),
  functions: new Set(['function_declaration', 'method_declaration', 'func_literal']),
}

const SYNTAX: Record<LanguageId, RefSyntax> = {
  typescript: TYPESCRIPT,
  tsx: TYPESCRIPT,
  javascript: TYPESCRIPT,
  python: PYTHON,
  go: GO,
}

export const MAX_REFS_PER_FILE = 40_000

interface Scope {
  declared: Set<string>
  parent: Scope | null
}

export function collectRefs(root: SyntaxNode, language: LanguageId): ExtractedRef[] {
  const syntax = SYNTAX[language]
  const found: Array<{ ref: ExtractedRef; scope: Scope }> = []
  const top: Scope = { declared: new Set(), parent: null }

  const ref = (node: SyntaxNode, scope: Scope, receiver?: string) => {
    if (found.length >= MAX_REFS_PER_FILE || node.startPosition.row !== node.endPosition.row) return
    found.push({
      scope,
      ref: {
        name: node.text,
        line: node.startPosition.row + 1,
        column: node.startPosition.column,
        endColumn: node.endPosition.column,
        ...(receiver ? { receiver } : {}),
      },
    })
  }

  // Explicit stack: a deep tree must not exhaust the call stack.
  interface Item {
    node: SyntaxNode
    field: string | null
    parent: string | null
    scope: Scope
    /** Inherited from a declaring list or pattern above. */
    inDeclaration: boolean
  }
  const stack: Item[] = [
    { node: root, field: null, parent: null, scope: top, inDeclaration: false },
  ]
  while (stack.length > 0) {
    const { node, field, parent, scope: outer, inDeclaration } = stack.pop() as Item
    const scope = syntax.functions.has(node.type)
      ? { declared: new Set<string>(), parent: outer }
      : outer
    if (syntax.ignored.has(`${parent}/${field}`)) continue
    const declaring =
      inDeclaration ||
      (field !== null && syntax.declaringFields.has(field)) ||
      (parent !== null && syntax.declaringParents.has(parent))

    if (syntax.names.has(node.type)) {
      // Declared inside a function: shadows module names there. At top level a declaration is the
      // symbol itself, never a reference.
      if (declaring) {
        if (scope !== top) scope.declared.add(node.text)
      } else ref(node, scope)
      continue
    }

    const qualified = syntax.qualified[node.type]
    let skip: SyntaxNode | null = null
    if (qualified) {
      const object = node.childForFieldName(qualified[0])
      const property = node.childForFieldName(qualified[1])
      if (
        object &&
        property &&
        (object.type === 'identifier' || object.type === 'package_identifier')
      ) {
        ref(property, scope, object.text)
        skip = property
      }
    }

    const cursor = node.walk()
    const children: Array<{ node: SyntaxNode; field: string | null }> = []
    if (cursor.gotoFirstChild()) {
      do {
        if (cursor.currentNode.isNamed)
          children.push({ node: cursor.currentNode, field: cursor.currentFieldName })
      } while (cursor.gotoNextSibling())
    }
    cursor.delete()
    // A declaring list or pattern hands "being declared" to everything in it.
    const passDown = declaring && syntax.declaringContainers.has(node.type)
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index] as { node: SyntaxNode; field: string | null }
      if (skip && child.node.equals(skip)) continue
      stack.push({
        node: child.node,
        field: child.field,
        parent: node.type,
        scope,
        inDeclaration: passDown,
      })
    }
  }

  return found
    .filter(({ ref: entry, scope }) => !shadowed(scope, entry.receiver ?? entry.name))
    .map(({ ref: entry }) => entry)
}

function shadowed(scope: Scope, name: string): boolean {
  for (let at: Scope | null = scope; at; at = at.parent) if (at.declared.has(name)) return true
  return false
}
