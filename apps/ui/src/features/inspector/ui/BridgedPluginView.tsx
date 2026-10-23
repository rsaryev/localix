import { useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import { collectHostThemeCss } from '@/shared/lib/hostThemeVars'
import { StateNotice } from '@localixai/kit/state-notice'
import { ProblemLine, useProblemReport } from '@/shared/ui/problem-report'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { buildPanelSrcDoc, mintPanelNonce } from './pluginPanelSrcDoc'
import { usePluginPanelBridge } from './usePluginPanelBridge'
import { useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'
import type { PublishMessageContext } from '@localixai/mini-app-sdk/ui'
import { WorkbenchToolbar, WorkbenchToolbarSection } from '@localixai/kit/workbench-toolbar'
import { IconButton } from '@localixai/kit/icon-button'
import { Button } from '@localixai/kit/button'

/**
 * The shared body of every third-party plugin UI surface: a sandboxed,
 * bridged iframe. Factored out of PluginPanelTab so the SAME containment +
 * live-bridge machinery serves an inspector panel, a rail-section view, and a
 * work-item view. The ONLY thing a surface varies is where its HTML comes from
 * (`fetchHtml`) and its identity (`pluginName`/`viewName`) — everything else
 * (opaque-origin `sandbox="allow-scripts"` + CSP, host-theme snapshot, static
 * remount vs. bridged theme streaming, capability-limited `invoke`) is identical.
 *
 * STATIC surface (default): a host appearance flip remounts the iframe
 * with a fresh snapshot. BRIDGED surface (opts in by posting the mini-app-sdk `ready`
 * message): theme updates stream over postMessage (no remount, state kept) and
 * the view may `invoke` the per-plugin action table (see pluginPanelActions).
 */

interface HostThemeKey {
  appearance: string
}

function readHostThemeKey(): HostThemeKey {
  return { appearance: document.documentElement.dataset.theme ?? 'dark' }
}

/**
 * Observe the appearance so every palette flip rebuilds a static surface.
 *
 * This used to also watch `data-theme-preset`, because a dark → dark preset swap changed the palette
 * without changing the appearance and left these frames on stale colours. With third-party themes
 * gone the appearance IS the palette, so there is nothing else to invalidate on.
 */
function useHostTheme(): HostThemeKey {
  const [theme, setTheme] = useState(readHostThemeKey)
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setTheme(readHostThemeKey())
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
    return () => observer.disconnect()
  }, [])
  return theme
}

export function BridgedPluginView({
  pluginName,
  projectId = '',
  viewName,
  title,
  fetchHtml,
  publishMessageContext,
}: {
  pluginName: string
  /** Exact plugin discovery scope. Empty means global. */
  projectId?: string
  /** The panel/view sub-identity (`panelName` for panels, view `id` for views). */
  viewName: string
  /** Iframe title / a11y label. */
  title?: string
  /** Loads the surface HTML (e.g. `getPluginPanelHtml` / `getPluginViewHtml`). */
  fetchHtml: () => Promise<string>
  publishMessageContext?: PublishMessageContext
}) {
  const workItemVisible = useWorkItemVisible()
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const theme = useHostTheme()

  // Clear any prior error immediately when target / reload changes, without a
  // synchronous setState in the effect: adjust state during render.
  const fetchKey = `${pluginName}\x00${projectId}\x00${viewName}\x00${reloadKey}`
  const loadedFetchKeyRef = useRef<string | null>(null)
  const [prevFetchKey, setPrevFetchKey] = useState(fetchKey)
  if (prevFetchKey !== fetchKey) {
    setPrevFetchKey(fetchKey)
    setError(null)
  }

  useEffect(() => {
    if (!workItemVisible || loadedFetchKeyRef.current === fetchKey) return
    let cancelled = false
    fetchHtml()
      .then((content) => {
        if (!cancelled) {
          loadedFetchKeyRef.current = fetchKey
          setHtml(content)
        }
      })
      .catch((err: unknown) => {
        // The fallback used to be `String(err)` — the raw value standing in for its own
        // classification, which is no fallback at all.
        if (!cancelled) setError(errorMessage(err, ''))
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchKey encodes plugin/view/reload identity; fetchHtml is a fresh closure each render.
  }, [workItemVisible, fetchKey])

  const iframeRef = useRef<HTMLIFrameElement>(null)
  // One bridge nonce per loaded view: only documents the host builds from this HTML carry it.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- a reload (fetchKey) mints a fresh one.
  const nonce = useMemo(() => (html === null ? null : mintPanelNonce()), [html, fetchKey])
  const { bridged } = usePluginPanelBridge({
    pluginName,
    projectId,
    panelName: viewName,
    iframeRef,
    resetKey: fetchKey,
    nonce,
    publishMessageContext,
  })

  // The theme baked into the CURRENT document. While bridged it stays frozen —
  // theme flips stream over the bridge, so rebuilding the srcDoc (which reloads
  // the iframe and wipes state) must not happen. A static surface tracks the live
  // theme exactly as before: new snapshot + remount via the key below.
  const docThemeRef = useRef(theme)
  if (!bridged) docThemeRef.current = theme
  const docTheme = docThemeRef.current

  const srcDoc = useMemo(
    () =>
      html !== null && nonce !== null
        ? buildPanelSrcDoc(
            html,
            docTheme.appearance === 'light' ? 'light' : 'dark',
            collectHostThemeCss(),
            nonce,
          )
        : null,
    [html, docTheme, nonce],
  )

  // Called above the early returns and given `null` when healthy — the surface that owns the
  // condition is the only thing that can settle it, and it unmounts exactly when it clears.
  const problem = useProblemReport(
    error !== null
      ? {
          subject: { label: title ?? `${pluginName} · ${viewName}` },
          problems: [
            {
              message: `The ${pluginName} plugin could not load this view.`,
              detail: error || undefined,
            },
          ],
          consequence: 'blocked',
        }
      : null,
    {
      scope: 'plugin-view',
      sourceVisible: workItemVisible,
      actions: [{ id: 'retry', label: 'Retry', run: () => setReloadKey((k) => k + 1) }],
    },
  )

  if (error !== null) {
    return (
      <StateNotice
        title={title ?? viewName}
        body={problem && <ProblemLine {...problem} className="items-center" />}
        actionsLabel="Plugin view recovery actions"
        actions={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setReloadKey((k) => k + 1)}
          >
            <RefreshCw data-icon="inline-start" aria-hidden /> Retry
          </Button>
        }
      />
    )
  }

  if (srcDoc === null) {
    return <LoadingHint className="min-h-0 flex-1 text-xs">Loading…</LoadingHint>
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <WorkbenchToolbar aria-label="Plugin view actions" density="slim">
        <WorkbenchToolbarSection align="end" spacing="compact">
          <IconButton
            size="xs"
            aria-label="Reload plugin view"
            tooltip="Reload plugin view"
            onClick={() => setReloadKey((k) => k + 1)}
          >
            <RefreshCw />
          </IconButton>
        </WorkbenchToolbarSection>
      </WorkbenchToolbar>
      <iframe
        ref={iframeRef}
        key={`${reloadKey}:${docTheme.appearance}`}
        title={title ?? `${pluginName}:${viewName}`}
        sandbox="allow-scripts"
        srcDoc={srcDoc}
        className="min-h-0 w-full flex-1 border-0 bg-transparent"
      />
    </div>
  )
}
