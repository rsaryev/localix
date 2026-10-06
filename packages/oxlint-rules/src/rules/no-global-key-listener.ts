/**
 * A global key listener must go through the action registry.
 *
 * `ActionRegistryProvider` owns one bubble-phase `keydown` listener, resolves the chord
 * against the shortcut catalog, and evaluates the surface's `when` clause before running anything.
 * A component that installs its OWN `window` listener bypasses all three: its key fires regardless
 * of which surface has focus, it cannot be rebound from settings, it never appears in the shortcut
 * catalog, and two such listeners answering the same chord both run with no defined winner.
 *
 * Element-scoped listeners are untouched. `input.addEventListener('keydown', …)` is bounded by the
 * element that owns it, which is exactly the thing a global listener is not.
 *
 * SCOPE is the workspace UI, because that is where the registry exists. The landing site has no
 * registry, and the visual-feedback probe runs inside the page being previewed rather than inside
 * our app — for those a global listener is the only listener there is. Plugin surfaces are in
 * scope through the SDK focus registry: `useFocusEntry` with a DOM scope offers local commands
 * before workspace bindings, and element listeners remain available for native keyboard models.
 *
 * The kit package is in scope: its primitives render inside the workspace UI, and they were in
 * scope as `apps/ui/src/shared/ui` until they moved — a primitive's global listener fires on every
 * surface that mounts it, which is the widest bypass of the registry there is.
 */
import { type Exemption, exemptionFor, isTestFile, isUnder } from '../path.ts'
import type { Node, Rule, RuleContext } from '../types.ts'

const KEY_EVENTS = new Set(['keydown', 'keyup', 'keypress'])
const GLOBAL_TARGETS = new Set(['window', 'document', 'globalThis'])

/**
 * Deliberate owners of a global key listener. Treat this as a list of things that MUST be global,
 * not as a backlog: adding an entry means arguing that the registry cannot express the behaviour.
 */
const EXEMPTIONS: readonly Exemption[] = [
  {
    suffix: '/shared/lib/actions/ActionRegistryProvider.tsx',
    reason: 'the dispatcher itself — this is the listener every other surface is routed through',
  },
  {
    suffix: '/features/settings/ui/keyboard/ChordRecorder.tsx',
    reason:
      'records a chord for rebinding, so it must observe the raw key the registry would otherwise claim and swallow',
  },
  {
    suffix: '/plugins/project-space/ui/board/useLiveBoard.ts',
    reason:
      'observes modifier state during pointer drags for snapping; it never claims a key or runs a keyboard command',
  },
]

function targetName(callee: Node): string | null {
  if (callee.type !== 'MemberExpression') return null
  const object = callee.object as Node | undefined
  const property = callee.property as Node | undefined
  if (object?.type !== 'Identifier' || property?.type !== 'Identifier') return null
  if ((property.name as string) !== 'addEventListener') return null
  const name = object.name as string
  return GLOBAL_TARGETS.has(name) ? name : null
}

function eventName(node: Node): string | null {
  const args = node.arguments as Node[] | undefined
  const first = args?.[0]
  if (first?.type !== 'Literal') return null
  const value = first.value
  return typeof value === 'string' && KEY_EVENTS.has(value) ? value : null
}

export const noGlobalKeyListener: Rule = {
  create(context: RuleContext) {
    const inScope =
      isUnder(context.filename, '/apps/ui/src/') ||
      isUnder(context.filename, '/packages/kit/src/') ||
      (isUnder(context.filename, '/plugins/') && isUnder(context.filename, '/ui/'))
    if (!inScope) return {}
    if (isTestFile(context.filename)) return {}
    if (exemptionFor(context.filename, EXEMPTIONS) !== null) return {}

    return {
      CallExpression(node: Node) {
        const target = targetName(node.callee as Node)
        if (target === null) return
        const event = eventName(node)
        if (event === null) return

        context.report({
          node,
          message: `Do not install a global '${event}' listener on \`${target}\`. Use \`registerActionHandler\` for workspace commands, or \`useFocusEntry\` with a DOM scope for pane-local commands. A listener bounded to one element is fine — attach it to that element instead.`,
        })
      },
    }
  },
}
