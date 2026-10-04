/**
 * A component's props type is named after the component.
 *
 * With one naming rule, `WidgetProps` is findable from `Widget` without opening the file, and a
 * grep for a component's name reaches its prop contract too. Without it the same contract is called
 * `Options`, `WidgetConfig` or `IWidget` depending on who typed it, and none of those are reachable
 * from the component's name.
 *
 * Two limits keep the rule pointed at what it can actually be right about, and both were found by
 * running it over this repository rather than reasoned about in advance:
 *
 * - Only a type DECLARED IN THE SAME FILE is checked. `KubernetesDeploymentsList` takes a
 *   `KubernetesResourceListProps` shared by a dozen list components, and `DialogHeader` takes the
 *   region contract it forwards to. Renaming a shared contract after one of its consumers would be
 *   a defect, not a fix, and this file cannot see the other consumers.
 * - A type used by MORE THAN ONE component in the file is left alone too, for the same reason at a
 *   smaller scale: `ModelPicker` declares one `LayoutProps` and renders `Wide`, `Narrow` and
 *   `Compact` from it. There is no single component to name that contract after.
 * - An `Impl` or `Component` suffix on the FUNCTION is stripped before comparing. A memoized
 *   component is written as `function MessageCardImpl(props: MessageCardProps)` plus
 *   `export const MessageCard = memo(MessageCardImpl)`; the props belong to the exported name, and
 *   `MessageCardImplProps` would name the wrapper rather than the component.
 * - The name must END with `<Component>Props`, not equal it. The SDK deliberately prefixes its
 *   public contracts — `FileTab` takes `PluginFileTabProps` — so that a plugin importing them gets
 *   a name that says where it came from. That prefix is the convention working, not breaking.
 *
 * No autofix. Renaming the REFERENCE alone produces a file that no longer compiles, and renaming
 * the declaration is only safe when nothing else imports it — which the rule cannot see. The
 * message names the expected shape and the rename stays a human edit.
 */
import { normalizePath } from '../path.ts'
import type { Node, Rule, RuleContext } from '../types.ts'

const PASCAL_CASE = /^[A-Z][A-Za-z0-9]*$/u
/** Suffixes that mark an inner function whose props belong to the exported component. */
const INNER_SUFFIX = /(?:Impl|Component)$/u
const TYPE_DECLARATIONS = new Set(['TSInterfaceDeclaration', 'TSTypeAliasDeclaration'])

/** The referenced type name, or `null` when the parameter is not a plain named type. */
function annotatedTypeName(parameter: Node | undefined): string | null {
  const annotation = parameter?.typeAnnotation as Node | undefined
  const type = annotation?.typeAnnotation as Node | undefined
  if (type?.type !== 'TSTypeReference') return null
  // A generic instantiation composes a type this file does not own; leave it alone. The field is
  // `null` rather than absent when there are no arguments, so an `!== undefined` test never fires.
  if (type.typeArguments != null) return null
  const typeName = type.typeName as Node | undefined
  return typeName?.type === 'Identifier' ? (typeName.name as string) : null
}

function declaredName(node: Node): string | null {
  const id = node.id as Node | undefined
  return id?.type === 'Identifier' ? (id.name as string) : null
}

/**
 * Every node in the tree, once.
 *
 * A visitor pair would need the type declaration to be visited before the component that uses it,
 * and a type declared at the bottom of the file is not. One walk removes the ordering question.
 */
function walk(node: unknown, visit: (node: Node) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit)
    return
  }
  if (node === null || typeof node !== 'object') return
  const candidate = node as Node
  if (typeof candidate.type === 'string') visit(candidate)
  for (const [key, value] of Object.entries(candidate)) {
    if (key === 'parent') continue
    walk(value, visit)
  }
}

export const propsTypeNaming: Rule = {
  create(context: RuleContext) {
    if (!normalizePath(context.filename).endsWith('.tsx')) return {}

    return {
      Program(program: Node) {
        const localTypes = new Set<string>()
        const components: { name: string; parameter: Node; typeName: string }[] = []

        walk(program, (node) => {
          if (TYPE_DECLARATIONS.has(node.type)) {
            const name = declaredName(node)
            if (name !== null) localTypes.add(name)
            return
          }
          if (node.type !== 'FunctionDeclaration') return

          const name = declaredName(node)
          if (name === null || !PASCAL_CASE.test(name)) return
          const params = (node.params as Node[] | undefined) ?? []
          if (params.length !== 1) return
          const parameter = params[0]
          if (parameter === undefined) return
          const typeName = annotatedTypeName(parameter)
          if (typeName === null) return
          components.push({ name, parameter, typeName })
        })

        const consumers = new Map<string, number>()
        for (const { typeName } of components) {
          consumers.set(typeName, (consumers.get(typeName) ?? 0) + 1)
        }

        for (const { name, parameter, typeName } of components) {
          if (!localTypes.has(typeName)) continue
          if ((consumers.get(typeName) ?? 0) > 1) continue
          const component = name.replace(INNER_SUFFIX, '')
          if (typeName.endsWith(`${component}Props`)) continue

          context.report({
            node: parameter,
            message: `Props type for \`${name}\` should be named \`${component}Props\` (a prefix is fine, e.g. \`Plugin${component}Props\`), not \`${typeName}\`, so the contract is reachable from the component name.`,
          })
        }
      },
    }
  },
}
