import {
  createMiniApp,
  type MiniAppContext,
  type MiniAppRegistration,
} from '@localixai/mini-app-sdk/backend'
import { entriesSpec } from './entries'
import { readSettings, settingsRoutes } from './settings'
import { createTools } from './tools'

/**
 * The backend: the app's collections, its own routes and the agent's tools. `createMiniApp` does
 * the wiring — the routes under `/rpc/<app>`, the store feed that updates an open screen when the
 * agent writes, the semantic index — so this file only says WHAT the app has.
 *
 * `register(ctx)` runs more than once (for the backend, and again for each run's tools): keep
 * state in collections, never in a module variable.
 */
export function register(ctx: MiniAppContext): MiniAppRegistration {
  const app = createMiniApp(ctx)
  const entries = app.collection(entriesSpec)
  const settings = readSettings(ctx.config)
  return app.registration({
    tools: createTools(ctx, entries, settings),
    routes: settingsRoutes(settings),
  })
}
