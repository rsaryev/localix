import { useMemo } from 'react'
import {
  useAgentContext,
  useCollection,
  useScreenProblem,
  type ScreenProps,
} from '@localixai/mini-app-sdk/ui/app'
import { ProblemLine } from '@localixai/mini-app-sdk/ui/components'
import { useNow } from '@localixai/mini-app-sdk/ui/now'
import { usePolledSnapshot } from '@localixai/mini-app-sdk/ui/route-snapshot'
import { LoadingHint } from '@localixai/kit/empty-hint'
import {
  APP,
  DEFAULT_SETTINGS,
  ENTRIES,
  describeForAgent,
  entrySchema,
  settingsSchema,
  summarize,
  type EntryInput,
} from '../shared/model'
import { EntryList } from './parts/EntryList'
import { QuickAdd } from './parts/QuickAdd'
import { Today } from './parts/Today'
import { Week } from './parts/Week'

/**
 * The screen. It reads the collection and the settings, computes the summary with the same
 * `summarize` the agent's tools use, and tells the agent exactly what it shows. Every number on
 * screen comes from that one summary, so the agent and the person always see the same thing.
 */
export function App({ active, publishMessageContext }: ScreenProps) {
  const entries = useCollection<(typeof entrySchema)['_output'], EntryInput>({
    app: APP,
    name: ENTRIES,
    item: entrySchema,
    active,
  })
  const settings = usePolledSnapshot({
    path: `/rpc/${APP}/settings`,
    schema: settingsSchema,
    intervalMs: null,
    active,
    failureMessage: 'Cannot read the settings.',
  })
  // Re-render each minute, so "today" turns over at midnight with the screen open.
  const now = useNow(60_000, active)
  const summary = useMemo(
    () => summarize(entries.items, new Date(now), settings.snapshot ?? DEFAULT_SETTINGS),
    [entries.items, now, settings.snapshot],
  )
  useAgentContext(
    publishMessageContext,
    active && !entries.loading,
    useMemo(() => ({ label: 'Daily Log', content: describeForAgent(summary) }), [summary]),
  )
  const problem = useScreenProblem({
    app: APP,
    subject: 'Daily Log',
    failure: entries.error,
    showingData: entries.items.length > 0,
  })

  return (
    // The screen scrolls on one axis and reflows to its own width (it may sit in a narrow pane).
    <div className="@container h-full min-h-0 overflow-y-auto">
      <div className="flex flex-col gap-6 px-4 py-5 @2xl:px-6">
        <header>
          <h1 className="text-base font-semibold text-foreground">Daily Log</h1>
          <p className="mt-0.5 text-xs text-text-faint">
            Log from the chat — a sentence, a photo, a receipt — or add one below.
          </p>
        </header>
        {problem && <ProblemLine {...problem} />}
        {entries.loading ? (
          <LoadingHint>Opening Daily Log…</LoadingHint>
        ) : (
          <>
            <Today summary={summary} />
            <QuickAdd unit={summary.settings.unit} sending={entries.sending} onAdd={entries.add} />
            <EntryList
              entries={summary.todayEntries}
              unit={summary.settings.unit}
              disabled={entries.sending}
              onRemove={(id) => void entries.remove(id)}
            />
            <Week summary={summary} />
          </>
        )}
      </div>
    </div>
  )
}
