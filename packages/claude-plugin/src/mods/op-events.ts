/**
 * The calls on `$` a host serves as events (Claude Code's "op events"): for each, the event input
 * its hooks receive, built from the call's arguments (`$.fs.read('a.md')` is `{ path, as }`), and
 * the arguments the host's method takes again from what the chain passed down. A hook passes the
 * input on, rewrites it, answers `{ value }` or refuses with `{ deny }`; `next(e)` resolves to
 * `{ value }`. What does not cross a host boundary as data (a signal, a timer's function) stays
 * among the call's own arguments.
 */

type Args = readonly unknown[]
type Input = Record<string, unknown>

export interface OpShape {
  /** The event input of a call made with `args`. */
  input: (args: Args) => Input
  /** The host method's arguments for the input the chain passed down. */
  args: (e: Input, args: Args) => unknown[]
}

const record = (value: unknown): Input =>
  value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Input) } : {}
/** A call whose first argument is a field or an object holding it (`'a.md'` or `{ path }`). */
const fieldOr = (name: string, value: unknown): Input =>
  typeof value === 'string' ? { [name]: value } : record(value)
const defined = (input: Input): Input =>
  Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))

const none: OpShape = { input: () => ({}), args: () => [] }
/** The call's one argument is the input itself. */
const whole: OpShape = {
  input: (args) => record(args[0]),
  args: (e, args) => [e, ...args.slice(1)],
}
const byField = (name: string): OpShape => ({
  input: (args) => fieldOr(name, args[0]),
  args: (e, args) => [e[name], ...args.slice(1)],
})

/** The joined text of a `string | ModelTextBlock[]`, and the blocks when it was a list. */
function textOf(value: unknown): { text?: string; blocks?: Input[] } {
  if (typeof value === 'string') return { text: value }
  if (!Array.isArray(value)) return {}
  const blocks = value.map(record)
  return {
    text: blocks.map((block) => (typeof block.text === 'string' ? block.text : '')).join(''),
    blocks,
  }
}

const NO_ARGS = [
  'session.cwd',
  'session.root',
  'session.model',
  'session.turns',
  'session.id',
  'session.repo',
  'session.surface',
  'session.surfaces',
  'session.authorize',
  'session.identity',
  'session.version',
  'prompt.read',
  'tool.list',
  'command.list',
  'config.list',
  'agent.list',
  'ui.panes',
  'ui.selection',
  'store.keys',
  'clock.now',
]
const WHOLE = [
  'model.fork',
  'audio.speak',
  'session.messages',
  'session.usage',
  'tool.register',
  'command.register',
  'agent.register',
  'ui.open',
  'ui.copy',
  'ui.view',
  'ui.blit',
  'fs.ancestors',
  'process.spawn',
  'settings.read',
  'turn.abort',
]

/**
 * The input of an event a `$` call raises that is no op event (`$.prompt.submit` raises
 * `prompt.submit`): what the engine stamps on it beside the call's argument — its origin, the
 * calling plugin.
 */
export function namedEventInput(event: string, args: Args, plugin: string): unknown {
  const first = args[0] ?? {}
  if (!['prompt.submit', 'prompt.fill', 'prompt.suggest', 'command.run'].includes(event))
    return first
  // The host runs a mod per project as `<plugin>~<hash>`; the model reads the plugin's name.
  const origin = { kind: 'plugin', name: plugin.split('~')[0] }
  const input = typeof first === 'string' ? { text: first } : record(first)
  return event === 'prompt.submit' ? { ...input, wait: false, origin } : { ...input, origin }
}

export const OP_SHAPES: ReadonlyMap<string, OpShape> = new Map<string, OpShape>([
  ...NO_ARGS.map((name): [string, OpShape] => [name, none]),
  ...WHOLE.map((name): [string, OpShape] => [name, whole]),
  [
    'model.complete',
    {
      input(args) {
        const ask = record(args[0])
        const prompt = textOf(ask.prompt)
        const system = textOf(ask.system)
        return defined({
          ...ask,
          prompt: prompt.text ?? ask.prompt,
          promptBlocks: prompt.blocks,
          system: system.text,
          systemBlocks: system.blocks,
        })
      },
      args: (e, args) => [e, ...args.slice(1)],
    },
  ],
  [
    'model.classify',
    {
      input: (args) => defined({ text: args[0], labels: args[1], options: args[2] }),
      args: (e) => [e.text, e.labels, e.options],
    },
  ],
  [
    'audio.play',
    {
      input: (args) => {
        const options = record(args[1])
        return defined({ clip: args[0], shouldLoop: options.loop === true, gain: options.gain })
      },
      args: (e, args) => [e.clip, { ...record(args[1]), loop: e.shouldLoop, gain: e.gain }],
    },
  ],
  [
    'mcp.call',
    {
      input: (args) => ({ server: args[0], tool: args[1], args: record(args[2]) }),
      args: (e) => [e.server, e.tool, e.args],
    },
  ],
  ['mcp.connect', byField('server')],
  [
    'ui.toast',
    {
      input: (args) =>
        defined({ ...fieldOr('text', args[0]), timeoutMs: record(args[1]).timeoutMs }),
      args: (e) => [e.text, defined({ timeoutMs: e.timeoutMs })],
    },
  ],
  ['ui.status', { input: (args) => ({ text: args[0] ?? undefined }), args: (e) => [e.text] }],
  [
    'ui.log',
    {
      input: (args) => ({
        ...fieldOr('text', args[0]),
        to: record(args[1]).to === 'debug' ? 'debug' : 'transcript',
      }),
      args: (e) => [e.text, { to: e.to }],
    },
  ],
  [
    'ui.notice',
    {
      input: (args) => ({ tool_use_id: args[0], text: args[1] }),
      args: (e) => [e.tool_use_id, e.text],
    },
  ],
  ['ui.invalidate', byField('event')],
  [
    'ui.close',
    {
      input: (args) => ({ ...fieldOr('id', args[0]), origin: { kind: 'plugin' } }),
      args: (e) => [{ id: e.id }],
    },
  ],
  [
    'ui.notify',
    {
      input: (args) => defined({ ...fieldOr('text', args[0]), title: record(args[1]).title }),
      args: (e) => [e.text, defined({ title: e.title })],
    },
  ],
  [
    'fs.read',
    {
      input: (args) => ({
        ...fieldOr('path', args[0]),
        as: record(args[1]).as === 'bytes' ? 'bytes' : 'text',
      }),
      args: (e) => [e.path, { as: e.as }],
    },
  ],
  [
    'fs.write',
    {
      input: (args) =>
        typeof args[0] === 'string' ? { path: args[0], text: args[1] } : record(args[0]),
      args: (e) => [e.path, e.text],
    },
  ],
  ['fs.list', byField('path')],
  ['fs.exists', byField('path')],
  [
    'fs.stat',
    {
      input: (args) => ({ ...fieldOr('path', args[0]), resolve: record(args[1]).resolve === true }),
      args: (e) => [e.path, { resolve: e.resolve }],
    },
  ],
  ['store.get', byField('key')],
  ['store.delete', byField('key')],
  [
    'store.set',
    { input: (args) => ({ key: args[0], value: args[1] }), args: (e) => [e.key, e.value] },
  ],
  ...['clock.sleep', 'clock.after', 'clock.every'].map((name): [string, OpShape] => [
    name,
    {
      input: (args) => (typeof args[0] === 'number' ? { ms: args[0] } : record(args[0])),
      args: (e, args) => [e.ms, ...args.slice(1)],
    },
  ]),
  [
    'http.fetch',
    {
      input: (args) => defined({ ...fieldOr('url', args[0]), init: args[1] }),
      args: (e) => [e.url, e.init],
    },
  ],
  [
    'process.run',
    {
      input: (args) => defined({ argv: args[0], init: args[1] }),
      args: (e) => [e.argv, e.init],
    },
  ],
  ['env.get', byField('name')],
  [
    'env.set',
    {
      input: (args) => defined({ name: args[0], value: args[1] }),
      args: (e) => [e.name, e.value],
    },
  ],
])
