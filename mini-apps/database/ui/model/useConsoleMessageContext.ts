import { useEffect, useMemo } from 'react'
import type { PublishMessageContext } from '@localixai/mini-app-sdk/ui'
import { snippetMessageBindingDraft } from '@localixai/mini-app-sdk/ui'
import type { ResultTab } from './resultTabs'
import { activeResultFacet, draftFacet, outputFacet } from './consoleContext'

/**
 * Publish the console's live facets (draft, active result, Output tail — see `consoleContext.ts`)
 * beside the connection's static `localix://resource/db` resource. The provider resolves the
 * durable schema/recent-query context; these facets are what is on screen right now.
 *
 * The result and Output facets are formatted only when their tabs change — a draft keystroke
 * re-publishes the draft and reuses the other two, instead of re-formatting 200 rows per key.
 */
export function useConsoleMessageContext(input: {
  text: string
  label: string
  language: string
  tabs: readonly ResultTab[]
  activeTabId: string | null
  connectionLabel?: string
  publishMessageContext?: PublishMessageContext
}): void {
  const { text, label, language, tabs, activeTabId, connectionLabel, publishMessageContext } = input
  const result = useMemo(
    () => activeResultFacet(tabs, activeTabId, connectionLabel),
    [tabs, activeTabId, connectionLabel],
  )
  const output = useMemo(() => outputFacet(tabs, connectionLabel), [tabs, connectionLabel])

  useEffect(() => {
    if (!publishMessageContext) return
    const facets = [draftFacet({ label, content: text, language }), result, output].filter(
      (facet) => facet !== null,
    )
    if (facets.length === 0) {
      publishMessageContext(null)
      return
    }
    publishMessageContext({
      strategy: 'append',
      bindings: facets.map((facet) =>
        snippetMessageBindingDraft({
          label: facet.label,
          content: facet.content,
          language: facet.language,
        }),
      ),
    })
  }, [label, language, output, publishMessageContext, result, text])
}
