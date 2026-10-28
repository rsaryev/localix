import { Hono } from 'hono'
import type { MiniAppContext, MiniAppRouteContext } from '@localixai/mini-app-sdk/backend'
import { DEFAULT_SETTINGS, settingsSchema, type Settings } from '../shared/model'

/**
 * The app's settings, declared under `config` in `mini-app.json` and changed by the person in
 * Settings → Mini apps. The host hands them over as `ctx.config`; a value that does not parse
 * keeps its default, so a typo in Settings never breaks the app.
 */
export function readSettings(config: MiniAppContext['config']): Settings {
  const parsed = settingsSchema.safeParse({
    dailyGoal: Number(config.DAILY_GOAL ?? DEFAULT_SETTINGS.dailyGoal),
    unit: String(config.UNIT ?? DEFAULT_SETTINGS.unit).trim(),
  })
  return parsed.success ? parsed.data : DEFAULT_SETTINGS
}

/** The app's own routes beside the collection's: here, the settings the screen reads. */
export function settingsRoutes(settings: Settings) {
  return new Hono<MiniAppRouteContext>().get('/settings', (c) => c.json(settings))
}
