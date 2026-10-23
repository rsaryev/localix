import type { MiniAppContext, MiniAppRegistration } from '@localixai/mini-app-sdk/backend'
import { formatSystemSnapshot } from '../shared/system'
import { formatProcessSnapshot } from '../shared/processes'
import { formatSystemMarks, SYSTEM_MARK_NOTE_MAX } from '../shared/system-marks'
import { createSystemContextProvider, createSystemResourceProvider } from './context'
import { createTemplateRoutes } from './routes'
import { createStoreFeed } from './store-feed'
import { createSystemReader } from './system'
import { createProcessService } from './processes'
import { createSystemMarks } from './system-marks'

/** The router's mount path: `/rpc/<mini app name>`, so it is this mini app's own. */
export const ROUTE_PATH = '/rpc/template'

// Module-level: the host calls `register(ctx)` more than once (the backend, and each run's
// tools), and a reader made per call would start without a previous CPU sample every time.
const readSystem = createSystemReader()
const processService = createProcessService()

/**
 * The router for one data folder. `register` mounts it on `ctx.dataDir`; exported so a harness
 * can serve the same app on a folder of its own without naming a single domain module.
 */
export function createRoutes(dataDir: string) {
  return createTemplateRoutes({
    read: readSystem,
    processes: processService,
    marks: createSystemMarks(dataDir, readSystem),
  })
}

export function register(ctx: MiniAppContext): MiniAppRegistration {
  // What the person creates lives under `ctx.dataDir`: the routes and the tools reach the same
  // store, so a mark the agent makes is in the view and one the view makes is in the tool.
  const marks = createSystemMarks(ctx.dataDir, readSystem)
  const resourceProvider = createSystemResourceProvider(readSystem, processService, marks)
  // An open view hears every write to a store under `ctx.dataDir` — the agent's mark included —
  // instead of polling for it. A per-chat store would resolve `ctx.sessionStorage` here instead.
  const feed = createStoreFeed({
    watchPath: ctx.watchPath ?? ctx.host?.watchPath,
    miniApp: 'template',
    resolveDir: async (_userId, sessionId) => (sessionId === null ? ctx.dataDir : null),
  })
  return {
    backend: [
      {
        id: 'template:backend',
        routeMount: { path: ROUTE_PATH, app: createRoutes(ctx.dataDir) },
        resourceProvider,
        contextProviders: [createSystemContextProvider(resourceProvider)],
        wsFrames: feed.wsFrames,
        onShutdown: feed.onShutdown,
      },
    ],
    tools: [
      ctx.defineTool({
        name: 'system_overview',
        label: 'System overview',
        activeVerb: 'Reading system information',
        description:
          'Read the Localix backend machine OS, CPU utilization, memory, uptime and Bun version. Read-only; never executes shell commands. Values describe the server, not the browser.',
        inputSchema: ctx.z.object({}),
        executionMode: 'parallel',
        mutates: false,
        permissionPaths: () => [],
        async execute() {
          return { content: formatSystemSnapshot(readSystem()) }
        },
      }),
      ctx.defineTool({
        name: 'system_processes',
        label: 'System processes',
        activeVerb: 'Reading system processes',
        description:
          'List backend-machine processes with PID, parent PID, name, CPU and memory, sorted by CPU. Use these identifiers when the user asks you to inspect or manage a process with native system tools.',
        inputSchema: ctx.z.object({}),
        executionMode: 'parallel',
        mutates: false,
        permissionPaths: () => [],
        async execute() {
          return { content: formatProcessSnapshot(await processService.read()) }
        },
      }),
      // A tool that ACTS: it takes input, changes stored state and says so (`mutates`), and runs
      // one at a time (`sequential`). `execute` receives the call id first, then the input.
      ctx.defineTool({
        name: 'system_mark',
        label: 'Mark the system state',
        activeVerb: 'Marking the system state',
        description:
          "Save a mark: a short note stored with the backend machine's CPU and memory at this moment, listed in System Overview. Use it before and after something the user wants to compare.",
        inputSchema: ctx.z.object({
          note: ctx.z
            .string()
            .trim()
            .min(1)
            .max(SYSTEM_MARK_NOTE_MAX)
            .describe('What is happening now, e.g. "before the build".'),
        }),
        executionMode: 'sequential',
        mutates: true,
        // WHERE the change lands, for the permission gate and session modes. `mutates: true`
        // alone reads as `external` (the widest class), so a session that refuses network side
        // effects would refuse a local note too. Marks live in the mini app's data directory and
        // outlive the chat: the agent's own durable state, `host`.
        classify: () => ({ effect: 'host' }),
        permissionPaths: () => [],
        async execute(_toolCallId, input) {
          return { content: formatSystemMarks(await marks.add(input.note)) }
        },
      }),
    ],
  }
}
