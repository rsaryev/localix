import { z } from 'zod'

/**
 * THE MODEL — what Daily Log keeps and the rules it computes, shared by the backend, its tools and
 * the screen. This file is the contract: the backend stores what these schemas allow, the screen
 * reads the same shapes, and every number the person or the agent sees comes from `summarize`.
 *
 * Make your app here first. Rename `Entry` after what your app holds (a meal, a workout, an
 * expense), give it the fields that thing has, and change the rules below. Pure functions only:
 * no storage, no network, no React — so they are tested in milliseconds.
 */

/** The mini app's name: its routes are `/rpc/<APP>/…`. */
export const APP = 'template'
/** The collection of entries: its route is `/rpc/<APP>/<ENTRIES>`. */
export const ENTRIES = 'entries'

/** What a person or the agent sends to log one entry. */
export const entryInputSchema = z.object({
  title: z.string().trim().min(1, 'Name the entry.').max(120),
  amount: z.number().nonnegative().max(1_000_000),
  category: z.string().trim().min(1).max(40).default('General'),
  note: z.string().trim().max(500).default(''),
  /** When it happened, ISO 8601; now when omitted. */
  at: z.iso.datetime({ offset: true }).optional(),
})

/** One stored entry. */
export const entrySchema = entryInputSchema.extend({ id: z.string(), at: z.string() })

export type Entry = z.infer<typeof entrySchema>
export type EntryInput = z.input<typeof entryInputSchema>

/** The app's settings (Settings → Mini apps → Daily Log), as the screen reads them. */
export const settingsSchema = z.object({
  dailyGoal: z.number().positive(),
  unit: z.string().min(1),
})
export type Settings = z.infer<typeof settingsSchema>
export const DEFAULT_SETTINGS: Settings = { dailyGoal: 2000, unit: 'kcal' }

export const WEEK_DAYS = 7

/** The local calendar day of a moment, `YYYY-MM-DD`. */
export function dayKey(at: string | Date): string {
  const date = typeof at === 'string' ? new Date(at) : at
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export interface Summary {
  settings: Settings
  /** Today's total. */
  today: number
  /** Today's total over the goal, 0–1. */
  progress: number
  /** What is left to the goal today, never below 0. */
  left: number
  /** Today's entries, newest first. */
  todayEntries: Entry[]
  /** Today's total per category, largest first. */
  byCategory: { key: string; value: number }[]
  /** The last seven days' totals, oldest first, today last. */
  week: { key: string; value: number }[]
}

export function summarize(entries: readonly Entry[], now: Date, settings: Settings): Summary {
  const todayKey = dayKey(now)
  const todayEntries = entries
    .filter((entry) => dayKey(entry.at) === todayKey)
    // By the moment, not the text: an offset written differently sorts differently as text.
    .toSorted((a, b) => Date.parse(b.at) - Date.parse(a.at))
  const today = sum(todayEntries)
  const categories = new Map<string, number>()
  for (const entry of todayEntries)
    categories.set(entry.category, (categories.get(entry.category) ?? 0) + entry.amount)
  const totals = new Map<string, number>()
  for (const entry of entries)
    totals.set(dayKey(entry.at), (totals.get(dayKey(entry.at)) ?? 0) + entry.amount)
  const week = Array.from({ length: WEEK_DAYS }, (_, index) => {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (WEEK_DAYS - 1 - index))
    const key = dayKey(day)
    return { key, value: totals.get(key) ?? 0 }
  })
  return {
    settings,
    today,
    progress: Math.min(1, today / settings.dailyGoal),
    left: Math.max(0, settings.dailyGoal - today),
    todayEntries,
    byCategory: [...categories]
      .map(([key, value]) => ({ key, value }))
      .toSorted((a, b) => b.value - a.value),
    week,
  }
}

/** The summary as the agent reads it: totals first, then today's entries with their ids. */
export function describeForAgent(summary: Summary): string {
  const { unit, dailyGoal } = summary.settings
  const weekTotal = summary.week.reduce((total, day) => total + day.value, 0)
  return [
    `Today: ${round(summary.today)} of ${dailyGoal} ${unit} (${Math.round(summary.progress * 100)}%), ${round(summary.left)} ${unit} left.`,
    summary.todayEntries.length
      ? [
          'Today’s entries, newest first:',
          ...summary.todayEntries.map(
            (entry) =>
              `- ${entry.title}: ${round(entry.amount)} ${unit}, ${entry.category} (id ${entry.id})`,
          ),
        ].join('\n')
      : 'Nothing logged today.',
    `Last ${WEEK_DAYS} days: ${round(weekTotal)} ${unit} in total.`,
  ].join('\n')
}

const sum = (entries: readonly Entry[]) => entries.reduce((total, entry) => total + entry.amount, 0)
const round = (value: number) => Math.round(value * 10) / 10
