import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import useSWR from 'swr'
import { collectHostThemeCss } from '@/shared/lib/hostThemeVars'
import type { ModClientFault, ModClientModule, ModElement } from '@/shared/api/modsApi'
import { buildClientFrameDoc } from './clientFrameDoc'
import { currentTheme, useClientBridge } from './useClientBridge'

/**
 * A `Client`: a region one of the mod's surface modules draws. Its code runs in an isolated frame
 * (`clientFrameDoc.ts`), never in the app; the instance lives while a `Client` under its key stays
 * in the pane, keeping its state across the mod's redraws, and is new when its module's code is.
 * A module that fails to load, draw or run leaves a dim line in its place and tells the mod
 * (`ui.fault`); it stays failed until its code changes or it leaves the drawing.
 */

export interface ModClientScopeValue {
  instance: string
  pane: string
  plugin: string
  /** Counts the pane's drawings: each hands its Clients their props again. */
  generation: number
  transport: {
    clientModule: (instance: string, module: string) => Promise<ModClientModule>
    message: (
      instance: string,
      pane: string,
      key: string,
      data: unknown,
    ) => Promise<{ props?: unknown }>
    fault: (instance: string, pane: string, key: string, fault: ModClientFault) => Promise<void>
  }
}

/** The pane a drawing sits in, for the Clients in it. */
export const ModClientScope = createContext<ModClientScopeValue | null>(null)

const asText = (value: unknown) => (typeof value === 'string' ? value : '')

/** Cells as the frame counts them: a monospace column, a 1.25rem row. */
function regionStyle(
  props: Record<string, unknown>,
  drawn: { width: number; height: number } | null,
): CSSProperties {
  const along = (value: unknown, cell: (n: number) => string, fitted?: number) =>
    typeof value === 'number' ? cell(value) : typeof value === 'string' ? value : fitted
  return {
    width: along(props.width, (n) => `${n}ch`, drawn ? drawn.width : undefined),
    height: along(props.height, (n) => `calc(${n} * 1.25rem)`, drawn?.height ?? 20),
    flexGrow: typeof props.flexGrow === 'number' ? props.flexGrow : undefined,
  }
}

export function ModClient({ element }: { element: ModElement }) {
  const scope = useContext(ModClientScope)
  if (!scope)
    return <span className="text-xs text-text-faint">A Client draws only in a mod’s pane.</span>
  return <ClientRegion scope={scope} element={element} />
}

function ClientRegion({ scope, element }: { scope: ModClientScopeValue; element: ModElement }) {
  const { props } = element
  const key = asText(props.key)
  const module = asText(props.module)
  const revision = element.client?.revision ?? ''
  const bundle = useSWR(
    `mod-client:${scope.instance}:${module}:${revision}`,
    () => scope.transport.clientModule(scope.instance, module),
    { revalidateOnFocus: false, revalidateIfStale: false, revalidateOnReconnect: false },
  )
  const [failure, setFailure] = useState<{ revision: string; reason: string } | null>(null)
  const [drawn, setDrawn] = useState<{ width: number; height: number } | null>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const reported = useRef<string | null>(null)

  const fail = (fault: ModClientFault) => {
    setFailure({ revision, reason: fault.reason })
    if (reported.current === revision) return
    reported.current = revision
    scope.transport.fault(scope.instance, scope.pane, key, fault).catch(() => {})
  }
  const problem = bundle.data && 'problem' in bundle.data ? bundle.data.problem : null
  useEffect(() => {
    if (problem !== null) fail({ phase: 'load', reason: problem })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reported once per revision inside `fail`.
  }, [problem])

  useClientBridge({
    frame,
    generation: scope.generation,
    props: props.props,
    post: (data) => scope.transport.message(scope.instance, scope.pane, key, data),
    onFault: fail,
    onSize: setDrawn,
  })

  // The document is built once per code: props and theme reach a running frame by message.
  const startProps = useRef(props.props)
  const code = bundle.data && 'code' in bundle.data ? bundle.data.code : null
  const fit = { width: props.width === undefined, height: props.height === undefined }
  const srcDoc = useMemo(
    () =>
      code === null
        ? null
        : buildClientFrameDoc({
            code,
            props: startProps.current,
            fit,
            theme: currentTheme(),
            themeCss: collectHostThemeCss(),
          }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new document only for new code.
    [code],
  )

  const failed = failure?.revision === revision ? failure.reason : null
  if (failed !== null || bundle.error)
    return (
      <p className="text-xs text-text-faint">
        {scope.plugin}: Client {module}: {failed ?? 'the surface module did not arrive'}
      </p>
    )
  return (
    <div className="max-w-full min-w-0 font-mono text-sm" style={regionStyle(props, drawn)}>
      {srcDoc !== null && (
        <iframe
          key={revision}
          ref={frame}
          title={`${scope.plugin}: ${key}`}
          sandbox="allow-scripts"
          srcDoc={srcDoc}
          className="block size-full border-0 bg-transparent"
        />
      )}
    </div>
  )
}
