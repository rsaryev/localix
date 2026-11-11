import type { ModMatcher } from '@rsaryev/llx-plugin/mods'

/**
 * The hooks a VM says its module registered, read on the host as untrusted data: each becomes
 * an entry of the engine every mod's events run through, so a malformed one — an event name that
 * is no string, a matcher that is no plain data (a RegExp the host would run on its own thread) —
 * refuses the load rather than reach the engine. A matcher is the kit's (`ModMatcher`): each field
 * a string, number or boolean, or a list of them. A RegExp matcher is matched in the VM, which
 * names its fields here (`inVm`, `plugins/kit/mods/guest/hooks.ts`): each reaches the kit as a
 * filter of its own that lets every value through, so the chain counts the hook as filtered (two
 * hooks of an event without one refuse the module), and no pattern of the mod's runs on the host.
 */

export interface HookSpec {
  id: number
  event: string
  matcher?: ModMatcher
  generator: boolean
  onError?: { id: number; generator: boolean }
}

/** More hooks than any module registers; a VM claiming more is refused. */
const MAX_HOOKS = 1_000
/** Longer than any event name or pattern. */
const MAX_EVENT_CHARS = 200

const isId = (id: unknown): id is number => Number.isSafeInteger(id) && (id as number) > 0

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value) as unknown
  return prototype === Object.prototype || prototype === null
}

/** More fields than any matcher filters on, and more values than any list of one offers. */
const MAX_MATCHER_FIELDS = 64
const MAX_MATCHER_VALUES = 1_000

/** A field the VM matches: on the host, any value passes; the empty pattern costs nothing to run. */
const MATCHED_IN_VM = { $regexp: '', flags: '' } as const

/** The fields the VM matches itself, checked as names. */
function inVmFields(event: string, value: unknown): ModMatcher {
  if (
    !Array.isArray(value) ||
    value.length > MAX_MATCHER_FIELDS ||
    !value.every((name) => typeof name === 'string' && name.length <= MAX_EVENT_CHARS)
  )
    throw new Error(`on("${event}"): the fields its VM matches are not a list of names`)
  return Object.fromEntries((value as string[]).map((name) => [name, MATCHED_IN_VM]))
}

const isLiteral = (value: unknown): value is string | number | boolean =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'

/** Why `matcher` is not a matcher the host may hold, or `undefined`. */
function matcherProblem(matcher: unknown): string | undefined {
  if (!isPlainObject(matcher)) return 'it is not an object'
  const fields = Object.entries(matcher)
  if (fields.length > MAX_MATCHER_FIELDS) return `it filters on over ${MAX_MATCHER_FIELDS} fields`
  for (const [name, field] of fields) {
    const values = Array.isArray(field) ? field : [field]
    if (values.length > MAX_MATCHER_VALUES) return `${name} lists over ${MAX_MATCHER_VALUES} values`
    if (!values.every(isLiteral))
      return `${name} is not a string, number or boolean, or a list of them`
  }
  return undefined
}

/** The specs in `answer`, copied, or a throw naming what is wrong. */
export function readHookSpecs(answer: unknown): HookSpec[] {
  const hooks = isPlainObject(answer) ? answer.hooks : undefined
  if (!Array.isArray(hooks)) throw new Error('the VM answered no list of hooks')
  if (hooks.length > MAX_HOOKS) throw new Error(`the module registered over ${MAX_HOOKS} hooks`)
  return hooks.map(readSpec)
}

function readSpec(value: unknown): HookSpec {
  if (!isPlainObject(value)) throw new Error('a registered hook is not described as data')
  const { id, event, generator, matcher, inVm, onError } = value
  if (!isId(id) || typeof generator !== 'boolean')
    throw new Error('a registered hook has no id or kind')
  if (typeof event !== 'string' || event.length === 0 || event.length > MAX_EVENT_CHARS)
    throw new Error('on() takes an event name first')
  const spec: HookSpec = { id, event, generator }
  if (matcher !== undefined) {
    const problem = matcherProblem(matcher)
    if (problem) throw new Error(`on("${event}"): the matcher is not plain data: ${problem}`)
    spec.matcher = matcher as ModMatcher
  }
  if (inVm !== undefined) spec.matcher = { ...spec.matcher, ...inVmFields(event, inVm) }
  if (onError !== undefined) {
    if (!isPlainObject(onError) || !isId(onError.id) || typeof onError.generator !== 'boolean')
      throw new Error(`on("${event}"): its .catch handler is not described as data`)
    spec.onError = { id: onError.id, generator: onError.generator }
  }
  return spec
}
