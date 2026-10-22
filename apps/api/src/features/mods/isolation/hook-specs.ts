import { plainDataProblem, type Matcher } from '@localixai/claude-plugin/mods'

/**
 * The hooks a worker says its module registered, read on the host as untrusted data: each becomes
 * an entry of the engine every mod's events run through, so a malformed one — an event name that
 * is no string, a matcher that is no plain data (a RegExp the host would run on its own thread) —
 * refuses the load rather than reach the engine. A RegExp matcher is matched in the worker, which
 * sends `{}` here (`worker-main.ts`).
 */

export interface HookSpec {
  id: number
  event: string
  matcher?: Matcher
  generator: boolean
  onError?: { id: number; generator: boolean }
}

/** More hooks than any module registers; a worker claiming more is refused. */
const MAX_HOOKS = 1_000
/** Longer than any event name or pattern. */
const MAX_EVENT_CHARS = 200

const isId = (id: unknown): id is number => Number.isSafeInteger(id) && (id as number) > 0

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value) as unknown
  return prototype === Object.prototype || prototype === null
}

/** The specs in `answer`, copied, or a throw naming what is wrong. */
export function readHookSpecs(answer: unknown): HookSpec[] {
  const hooks = isPlainObject(answer) ? answer.hooks : undefined
  if (!Array.isArray(hooks)) throw new Error('the worker answered no list of hooks')
  if (hooks.length > MAX_HOOKS) throw new Error(`the module registered over ${MAX_HOOKS} hooks`)
  return hooks.map(readSpec)
}

function readSpec(value: unknown): HookSpec {
  if (!isPlainObject(value)) throw new Error('a registered hook is not described as data')
  const { id, event, generator, matcher, onError } = value
  if (!isId(id) || typeof generator !== 'boolean')
    throw new Error('a registered hook has no id or kind')
  if (typeof event !== 'string' || event.length === 0 || event.length > MAX_EVENT_CHARS)
    throw new Error('on() takes an event name first')
  const spec: HookSpec = { id, event, generator }
  if (matcher !== undefined) {
    const problem = isPlainObject(matcher) ? plainDataProblem(matcher) : 'it is not an object'
    if (problem) throw new Error(`on("${event}"): the matcher is not plain data: ${problem}`)
    spec.matcher = matcher as Matcher
  }
  if (onError !== undefined) {
    if (!isPlainObject(onError) || !isId(onError.id) || typeof onError.generator !== 'boolean')
      throw new Error(`on("${event}"): its .catch handler is not described as data`)
    spec.onError = { id: onError.id, generator: onError.generator }
  }
  return spec
}
