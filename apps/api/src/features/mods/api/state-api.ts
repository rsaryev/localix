import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * `$.state`: Claude Code's reactive state, values a drawing depends on. A value is named by a
 * reference `{ plugin, key, id? }` (`id` for a family's member, `memberOf`), read by any mod and
 * written only by the plugin it names. Each write gives the value a new version, so `update` can
 * write only over what it read (`ifVersion`). A `ui.render` hook that reads a value subscribes its
 * drawing to it: writing the value redraws it, with no `$.ui.invalidate`; a render hook only reads.
 *
 * Claude Code keeps state for a session. A Localix mod runs once per project (`host.ts`), so the
 * mods running in one working directory share one space; the space is the host's, not an
 * instance's, so a value outlives a reload of the module. `reset` returns a space to its defaults,
 * as Claude Code's `/clear`, `/resume` and `/branch` do, its versions never handed out again.
 */

/** A value's JSON text may be at most this long, as in Claude Code. */
export const STATE_VALUE_MAX_CHARS = 4 * 1024 * 1024

export interface StateRef {
  plugin: string
  key: string
  id?: string
}

interface Held {
  value: unknown
  version: number
}

interface Space {
  values: Map<string, Held>
  /** No version at or below it is handed out again (a reset keeps the highest one). */
  floor: number
  /** The keys each drawing read when it was last drawn, by drawing. */
  readers: Map<string, Set<string>>
}

/** A `ui.render` dispatch in flight: what it reads subscribes it, and it may not write. */
interface Drawing {
  reader: string
  inFlight: boolean
  /** The spaces whose reads of this drawing were replaced by this run's. */
  begun: Set<Space>
}

const drawings = new AsyncLocalStorage<Drawing>()

/**
 * Runs one dispatch of `ui.render` for the drawing `reader` (a pane): the state its hooks read
 * subscribes it. A timer or closure the render leaves behind is not drawing once it returns.
 */
export async function whileDrawing<T>(reader: string, work: () => Promise<T>): Promise<T> {
  const drawing: Drawing = { reader, inFlight: true, begun: new Set() }
  try {
    return await drawings.run(drawing, work)
  } finally {
    drawing.inFlight = false
  }
}

const drawingNow = () => {
  const drawing = drawings.getStore()
  return drawing?.inFlight ? drawing : undefined
}

const keyOf = ({ plugin, key, id }: StateRef) =>
  id === undefined ? `${plugin}\u0000${key}` : `${plugin}\u0000${key}\u0000${id}`

function deepFrozen<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const member of Object.values(value)) deepFrozen(member)
  return Object.freeze(value)
}

/** The process's state spaces, one per working directory; `changed` redraws the mods' sites. */
export function createStateSpaces(options: { changed: () => void }) {
  const spaces = new Map<string, Space>()
  const spaceOf = (name: string) => {
    let space = spaces.get(name)
    if (!space) spaces.set(name, (space = { values: new Map(), floor: 0, readers: new Map() }))
    return space
  }
  return {
    get(name: string, ref: StateRef): { value: unknown; version: number } {
      const space = spaceOf(name)
      const key = keyOf(ref)
      const drawing = drawingNow()
      if (drawing) {
        if (!drawing.begun.has(space)) {
          drawing.begun.add(space)
          space.readers.set(drawing.reader, new Set())
        }
        space.readers.get(drawing.reader)!.add(key)
      }
      const held = space.values.get(key)
      return { value: held?.value, version: held?.version ?? 0 }
    },
    /** Writes `text` (the value's JSON) unless `ifVersion` names a version other than its own. */
    set(name: string, ref: StateRef, text: string, ifVersion?: number) {
      const space = spaceOf(name)
      const key = keyOf(ref)
      const current = space.values.get(key)?.version ?? 0
      if (ifVersion !== undefined && ifVersion !== current)
        return { isSet: false, version: current }
      const version = Math.max(current, space.floor) + 1
      space.values.set(key, { value: deepFrozen(JSON.parse(text)), version })
      if ([...space.readers.values()].some((keys) => keys.has(key))) options.changed()
      return { isSet: true, version }
    },
    /** Every value of the space back to its default, and its drawings drawn again. */
    reset(name: string): void {
      const space = spaces.get(name)
      if (!space) return
      for (const held of space.values.values()) space.floor = Math.max(space.floor, held.version)
      space.values.clear()
      space.readers.clear()
      options.changed()
    },
  }
}

export type StateSpaces = ReturnType<typeof createStateSpaces>

const REF_PROBLEM = 'takes a reference { plugin, key } (id for a family member)'

/** `input` as a reference, or a throw naming the call. */
function refOf(call: string, input: unknown): StateRef {
  const { plugin, key, id } = (input ?? {}) as Record<string, unknown>
  const isRef =
    typeof input === 'object' &&
    input !== null &&
    typeof plugin === 'string' &&
    plugin !== '' &&
    typeof key === 'string' &&
    key !== '' &&
    (id === undefined || typeof id === 'string')
  if (!isRef) throw new Error(`${call}: ${REF_PROBLEM}`)
  if ([plugin, key, id ?? ''].some((part) => part.includes('\u0000')))
    throw new Error(`${call}: a plugin, key or id holding the NUL character`)
  return id === undefined ? { plugin, key } : { plugin, key, id }
}

/** `value` as the JSON text state keeps, or a throw naming why it is not JSON data. */
function textOf(value: unknown): string {
  if (value === undefined) throw new Error('state.set: takes a value (JSON data, never undefined)')
  let text: string | undefined
  try {
    text = JSON.stringify(value, (_key, field: unknown) => {
      if (typeof field === 'function' || typeof field === 'symbol')
        throw new Error(`a ${typeof field}`)
      return field
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`state.set: value is not JSON data: ${reason}`)
  }
  if (text === undefined) throw new Error(`state.set: value is not JSON data: a ${typeof value}`)
  if (text.length > STATE_VALUE_MAX_CHARS)
    throw new Error(
      `state.set: the value is ${text.length} characters, over the ${STATE_VALUE_MAX_CHARS} limit`,
    )
  return text
}

/**
 * One mod's `$.state`. `set` takes Claude Code's call, `(ref, value, { ifVersion })`, or the
 * event that call raises, `{ plugin, key, id?, value, ifVersion? }`, which the claude-code helpers
 * (`update`) pass so that other mods' `state.set` hooks see the value they may rewrite.
 */
export function createStateApi(deps: { plugin: string; space: string; spaces: StateSpaces }) {
  const { plugin, space, spaces } = deps
  return {
    get: async (input: unknown) => spaces.get(space, refOf('state.get', input)),
    set: async (input: unknown, ...rest: unknown[]) => {
      const isEvent = rest.length === 0
      const event = (input ?? {}) as { value?: unknown; ifVersion?: unknown }
      const value = isEvent ? event.value : rest[0]
      const ifVersion = isEvent ? event.ifVersion : (rest[1] as { ifVersion?: unknown })?.ifVersion
      const ref = refOf('state.set', input)
      const text = textOf(value)
      if (ifVersion !== undefined && !(Number.isSafeInteger(ifVersion) && Number(ifVersion) >= 0))
        throw new Error('state.set: ifVersion is a version $.state.get answered (a whole number)')
      if (drawingNow())
        throw new Error(
          'state.set: denied: it was made while ui.render is being dispatched, and drawing is ' +
            'pure (a render hook reads state and returns a tree; write from a handler such as ' +
            'onPress, or from another event)',
        )
      if (ref.plugin !== plugin)
        throw new Error(
          `state.set: denied: ${ref.plugin} owns that value and only its owner writes it`,
        )
      return spaces.set(space, ref, text, ifVersion as number | undefined)
    },
  }
}
