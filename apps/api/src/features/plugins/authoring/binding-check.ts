import { scanSources } from '../../../lib/source-lint'

/**
 * A view that attaches a RESOURCE to the person's message has a backend that can read it.
 *
 * The defect: a copy kept the template's `toMessageBinding: () => resourceMessageBindingDraft(…)`
 * in `ui/register.tsx` but deleted `backend/context.ts` with the rest of the domain, and with it
 * the `resourceProvider` that answers the URI. Every check passed; then each message sent with the
 * tab open carried "could not be read (no resource provider …)" instead of the timer's state.
 * The two halves live in different files and different builds, so nothing else connects them.
 */

const UI_SOURCES = ['ui/**/*.ts', 'ui/**/*.tsx']
const BACKEND_SOURCES = ['backend/**/*.ts']
const isTest = (file: string) => /\.(?:dom\.)?test\.tsx?$/u.test(file)
const RESOURCE_BINDING = /\bresourceMessageBindingDraft\s*\(/gu
const RESOURCE_PROVIDER = /\bresourceProvider\b/u

export const RESOURCE_BINDING_FIX =
  'register a resourceProvider (with contextProviders) in backend/index.ts that expands this URI, or drop toMessageBinding and publish the visible state with publishMessageContext'

/** One `file:line` problem per resource binding when the backend registers no provider. */
export async function checkPluginBindings(pluginDir: string): Promise<string[]> {
  const scan = (include: string[]) =>
    scanSources({ root: pluginDir, include, skip: isTest, minFiles: 0 })
  const [ui, backend] = await Promise.all([scan(UI_SOURCES), scan(BACKEND_SOURCES)])
  if (backend.some(({ code }) => RESOURCE_PROVIDER.test(code))) return []
  const problems: string[] = []
  for (const { file, code } of ui) {
    for (const match of code.matchAll(RESOURCE_BINDING)) {
      const line = code.slice(0, match.index).split('\n').length
      problems.push(
        `${file}:${line} attaches a resource to messages, but the backend registers no resourceProvider — the agent gets "no resource provider" instead of its state: ${RESOURCE_BINDING_FIX}`,
      )
    }
  }
  return problems
}
