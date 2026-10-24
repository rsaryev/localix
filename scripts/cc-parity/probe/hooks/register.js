import { describe, mergeShape, REJECTED, sameShape } from './shape.js'

/**
 * The cc-parity probe: a Claude Code mod that records what the host it runs in hands a mod — each
 * event's input `e`, what `next(e)` resolves to, and the answers of cheap `$` calls — as shape
 * descriptors (`shape.js`), never values. Entries are `{ kind, name, shape }`, one per name, shapes
 * merged, written with `$.fs.write` as JSON to the path in the `output` option or the
 * `CC_PARITY_OUT` environment variable; an existing file is merged into, so the file is stable
 * across runs. The same module runs in Claude Code (`claude --plugin-dir`) and in Localix's mod
 * host (`scripts/cc-parity/localix`), so their recordings compare one to one.
 *
 * Model calls (`$.model.*`) spend the person's usage: they run only when `CC_PARITY_ALLOW_MODEL`
 * is `1` or the `allowModel` option is true. Written to Claude Code's static-analysis rules: every
 * `$` call in full, `$` passed only to functions declared at the top of this file.
 */

const PANE = 'cc-parity-probe'
const STORE_KEY = 'cc-parity-probe'
const TINY = 'Reply with the single word: ok'

const entries = new Map()
let config = {}
let output
let writing = Promise.resolve()
let merged = false
let surveyed = false

async function outputPath($) {
  if (output !== undefined) return output
  const option = typeof config.output === 'string' ? config.output : ''
  output = option || (await $.env.get('CC_PARITY_OUT')) || ''
  return output
}

async function modelAllowed($) {
  if (config.allowModel === true) return true
  return (await $.env.get('CC_PARITY_ALLOW_MODEL')) === '1'
}

/** Merge one observation in, and write the file when it changed what is known. */
async function record($, kind, name, value, depth) {
  try {
    const shape = value === REJECTED ? REJECTED : describe(value, depth)
    const key = kind + ':' + name
    const known = entries.get(key)
    const next = known ? mergeShape(known.shape, shape) : shape
    if (known && sameShape(known.shape, next)) return
    entries.set(key, { kind, name, shape: next })
    await save($)
  } catch {
    // Recording never changes what the host does.
  }
}

/** Writes are queued, so concurrent hooks never interleave a file. */
function save($) {
  writing = writing.then(() => write($)).catch(() => {})
  return writing
}

async function write($) {
  const path = await outputPath($)
  if (!path) return
  if (!merged) {
    merged = true
    if (await $.fs.exists(path)) mergeFile(await $.fs.read(path))
  }
  const list = [...entries.values()].sort((a, b) =>
    (a.kind + ':' + a.name).localeCompare(b.kind + ':' + b.name),
  )
  await $.fs.write(path, JSON.stringify({ probe: 'cc-parity', entries: list }, null, 2) + '\n')
}

function mergeFile(text) {
  try {
    for (const entry of JSON.parse(text).entries ?? []) {
      const key = entry.kind + ':' + entry.name
      const known = entries.get(key)
      entries.set(key, known ? { ...known, shape: mergeShape(entry.shape, known.shape) } : entry)
    }
  } catch {
    // A file that is not the probe's is overwritten.
  }
}

/** One `$` call's answer, or that it rejected. */
async function call($, name, run, depth) {
  let value
  try {
    value = await run()
  } catch {
    value = REJECTED
  }
  await record($, 'call', name, value, depth)
}

/** The cheap `$` calls, once a session: after the first turn, or on `/probe`. */
async function survey($) {
  if (surveyed) return
  surveyed = true
  await call($, 'session.cwd', () => $.session.cwd())
  await call($, 'session.id', () => $.session.id())
  await call($, 'session.model', () => $.session.model())
  await call($, 'session.usage', () => $.session.usage())
  await call($, 'session.messages', () => $.session.messages(), 4)
  await call($, 'session.turns', () => $.session.turns())
  await call($, 'session.version', () => $.session.version())
  await call($, 'session.surfaces', () => $.session.surfaces())
  await call($, 'command.list', () => $.command.list(), 3)
  await call($, 'tool.list', () => $.tool.list(), 2)
  await call($, 'prompt.suggest', () => $.prompt.suggest({ text: 'cc-parity probe' }))
  await call($, 'prompt.fill', () => $.prompt.fill({ text: '', mode: 'append' }))
  await call($, 'ui.open', () => $.ui.open({ id: PANE, title: 'cc-parity probe' }))
  // The pane stays open, so the host draws it (`ui.render:Pane`).
  await call($, 'ui.panes', () => $.ui.panes())
  await call($, 'fs.exists', () => $.fs.exists('.'))
  await call($, 'clock.now', () => $.clock.now())
  await call($, 'store.set', () => $.store.set(STORE_KEY, { seen: true }))
  await call($, 'store.get', () => $.store.get(STORE_KEY))
  // The settings' own keys are the person's: only that an object answers is recorded.
  await call($, 'settings.read', () => $.settings.read(), 0)
  await call($, 'env.get', () => $.env.get('HOME'))
  if (await modelAllowed($)) {
    const model = 'haiku'
    await call($, 'model.complete', () => $.model.complete({ model, prompt: TINY, maxTokens: 16 }))
    await call($, 'model.fork', () => $.model.fork({ prompt: TINY }))
    await call($, 'model.classify', () =>
      $.model.classify('The sky is blue.', ['color', 'number'], { model }),
    )
  }
  $.ui.log('cc-parity probe: ' + entries.size + ' shapes recorded')
}

export function register(on, options) {
  config = options ?? {}

  on('session.start', async ($, e, next) => {
    await record($, 'event', 'session.start', e)
    await call($, 'command.register', () =>
      $.command.register({ name: 'probe', description: 'Record the cc-parity probe shapes' }),
    )
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await record($, 'event', 'session.end', e)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await record($, 'event', 'prompt.submit', e)
    const result = await next(e)
    await record($, 'result', 'prompt.submit', result)
    return result
  })

  on('turn.start', async ($, e, next) => {
    await record($, 'event', 'turn.start', e)
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    await record($, 'event', 'turn.step', e)
    const result = yield* next(e)
    await record($, 'result', 'turn.step', result, 3)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    await record($, 'event', 'turn.complete', e)
    await survey($)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    await record($, 'event', 'tool.call:' + e.tool, e)
    const result = await next(e)
    await record($, 'result', 'tool.call:' + e.tool, result, 2)
    return result
  })

  on('tool.check', async ($, e, next) => {
    await record($, 'event', 'tool.check', e, 2)
    const verdict = await next(e)
    await record($, 'result', 'tool.check', verdict)
    return verdict
  })

  on('command.run', { command: 'probe' }, async ($, e) => {
    await record($, 'event', 'command.run', e)
    await survey($)
    return { text: 'cc-parity probe: ' + entries.size + ' shapes recorded' }
  })

  // Every site drawn: its component, surface and the names and kinds of its props.
  on('ui.render', async ($, e, next) => {
    await record($, 'event', 'ui.render:' + e.component, e, 2)
    return next(e)
  })
}
