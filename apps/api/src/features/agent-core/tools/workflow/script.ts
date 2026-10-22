/**
 * The JavaScript a workflow runs as in the script sandbox (`@localixai/engine-scripts`): the
 * Claude Code workflow globals, then the script's body.
 *
 * The sandbox runs code as the body of an async function whose only capability is the tools it is
 * handed. A workflow gets one: the host (`WORKFLOW_HOST_TOOL`), which starts an agent or a nested
 * workflow and answers with its result. `agent()`, `pipeline()`, `parallel()`, `phase()`, `log()`,
 * `args`, `budget` and `workflow()` are built here on top of it, as Claude Code documents them.
 * The body runs in a function of its own, so it may declare names these globals use.
 *
 * `phase()` and `log()` lines ride on the next host call, and the rest on the return value: a
 * line is progress, and a call of its own for each would count against the sandbox's call limit.
 *
 * `budget` is Claude Code's: `total` the token target the run was given (null without one),
 * `spent()` the output tokens its agents have used so far, as the host reports them with each
 * answer, and `remaining()` what is left of the target (`Infinity` without one). The host refuses
 * an agent once the target is spent, as Claude Code's hard ceiling does.
 */

/** The one tool a workflow script holds. */
export const WORKFLOW_HOST_TOOL = 'workflow_host'

/** Items one `parallel()` or `pipeline()` call takes, as in Claude Code. */
export const MAX_ITEMS_PER_CALL = 4096

/** A `phase()` or `log()` line, in the order the script wrote them. */
export type WorkflowEvent = { type: 'phase'; title: string } | { type: 'log'; message: string }

const PRELUDE = `
const __host = tools[${JSON.stringify(WORKFLOW_HOST_TOOL)}];
const __events = [];
let __phase;
let __spent = 0;
// The host answers every call with the run's output tokens so far (its agents' usage).
const __track = (reply) => {
  if (reply && typeof reply.spent === "number") __spent = reply.spent;
};
const __drain = () => __events.splice(0, __events.length);
const __nondeterministic = (what) => () => {
  throw new Error(what + " is not available in a workflow: pass a timestamp or a seed in through args");
};
const Math = Object.create(globalThis.Math, { random: { value: __nondeterministic("Math.random()") } });
const Date = (() => {
  const Real = globalThis.Date;
  function Date(...values) {
    if (!new.target || values.length === 0) __nondeterministic("new Date() without arguments")();
    return new Real(...values);
  }
  Date.prototype = Real.prototype;
  Date.now = __nondeterministic("Date.now()");
  Date.parse = Real.parse;
  Date.UTC = Real.UTC;
  return Date;
})();
const __items = (name, list) => {
  if (!Array.isArray(list)) throw new TypeError(name + "() takes an array");
  if (list.length > ${MAX_ITEMS_PER_CALL}) {
    throw new RangeError(name + "() takes at most ${MAX_ITEMS_PER_CALL} items; got " + list.length);
  }
  return list;
};
async function agent(prompt, options) {
  if (typeof prompt !== "string" || !prompt.trim()) throw new TypeError("agent() takes a prompt");
  const opts = options && typeof options === "object" ? options : {};
  const reply = await __host({
    op: "agent",
    prompt,
    options: { ...opts, phase: opts.phase ?? __phase },
    events: __drain(),
  });
  __track(reply);
  return reply.value ?? null;
}
async function parallel(thunks) {
  return Promise.all(
    __items("parallel", thunks).map(async (thunk) => {
      try {
        return await thunk();
      } catch {
        return null;
      }
    }),
  );
}
async function pipeline(items, ...stages) {
  return Promise.all(
    __items("pipeline", items).map(async (item, index) => {
      let value = item;
      for (const stage of stages) {
        try {
          value = await stage(value, item, index);
        } catch {
          return null;
        }
      }
      return value;
    }),
  );
}
function phase(title) {
  __phase = String(title);
  __events.push({ type: "phase", title: __phase });
}
function log(message) {
  __events.push({ type: "log", message: String(message) });
}
async function workflow(ref, input) {
  const reply = await __host({ op: "workflow", ref, args: input, events: __drain() });
  __track(reply);
  return reply.value ?? null;
}
const budget = Object.freeze({
  total: __budgetTotal,
  spent: () => __spent,
  remaining: () => (__budgetTotal === null ? Infinity : Math.max(0, __budgetTotal - __spent)),
});
`

/**
 * The sandbox source for one workflow body. `args` is the workflow's input, `undefined` when it has
 * none; it crosses as JSON, as every value between the host and the sandbox does. `budgetTotal` is
 * the run's token target (`budget.total`), null when none was set.
 */
export function workflowSource(
  body: string,
  args: unknown,
  budgetTotal: number | null = null,
): string {
  const input = args === undefined ? 'undefined' : JSON.stringify(args)
  return [
    `const __budgetTotal = ${budgetTotal === null ? 'null' : String(Math.max(0, Math.floor(budgetTotal)))};`,
    PRELUDE,
    `const args = ${input};`,
    // The body's own function: its `return` is the workflow's result, and a name it declares
    // shadows a global here instead of colliding with it.
    'const __value = await (async () => {',
    body,
    '})();',
    'return { value: __value, events: __drain() };',
  ].join('\n')
}

/** Claude Code refuses a script that loads modules before it runs; so does this host. */
export function loadsModules(body: string): boolean {
  return /(^|[^\w$.])import\s*\(/.test(body)
}
