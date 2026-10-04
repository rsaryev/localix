import { useEffect, useRef, useState } from 'react'
import { backendClient } from '@/shared/api/client'
import { previewControlBus, type PreviewCommandEvent } from '@/shared/lib/previewControlBus'
import type { VisualFeedbackBridge } from './useVisualFeedback'

interface PreviewCommandRelayOptions {
  enabled?: boolean
  sessionId: string | null
  previewId?: string
  frameBlocked?: boolean
  setViewport: (size: { width: number; height: number } | null) => void
  vf: Pick<VisualFeedbackBridge, 'connected' | 'whenConnected' | 'runCommand'>
  hasInjectUrl: boolean
  engaged: boolean
  engage: () => void
}

/** Claim before execution so another window or remounted tab cannot duplicate a click. */
export function usePreviewCommandRelay(options: PreviewCommandRelayOptions): void {
  const [hostId] = useState(() => crypto.randomUUID())
  const inFlight = useRef(new Map<string, () => void>())
  const handlerRef = useRef<(event: PreviewCommandEvent) => void>(() => {})
  useEffect(() => {
    handlerRef.current = (event) => {
      const { sessionId, previewId, vf, hasInjectUrl, engaged, engage, setViewport, frameBlocked } =
        options
      if (
        options.enabled === false ||
        event.command.action === 'history' ||
        inFlight.current.has(event.commandId)
      )
        return
      if (
        event.command.previewId
          ? event.command.previewId !== previewId
          : event.sessionId !== sessionId
      )
        return
      let cancelled = false
      let claimed = false
      let executing = false
      const respond = (payload: Record<string, unknown>) =>
        backendClient.previewResult(event.commandId, { ...payload, hostId })
      inFlight.current.set(event.commandId, () => {
        cancelled = true
        if (claimed && !executing)
          void respond({
            ok: false,
            release: true,
          }).catch(() => {})
        else if (claimed)
          void respond({
            ok: false,
            errorCode: 'host_unavailable',
            error: 'The Preview host changed while executing the command; its outcome is unknown.',
          }).catch(() => {})
      })
      void (async () => {
        if (
          !(await backendClient.previewResult(event.commandId, { ok: false, claim: true, hostId }))
        )
          return
        previewControlBus.acknowledge(event.commandId)
        claimed = true
        if (cancelled) {
          await respond({
            ok: false,
            release: true,
          })
          return
        }
        if (frameBlocked) {
          await respond({
            ok: false,
            errorCode: 'frame_blocked',
            error: 'This page blocks embedding. Open an allowed local preview.',
          })
          return
        }
        if (!vf.connected && hasInjectUrl && !engaged) engage()
        const ready = await vf.whenConnected(8_000)
        if (cancelled) return
        if (!ready) {
          await respond({
            ok: false,
            notEngaged: true,
            errorCode: 'probe_not_ready',
            error:
              'Preview host is mounted but the page probe is not ready. Check the page URL and server before retrying.',
          })
          return
        }
        const { command } = event
        if (command.action === 'history') return
        if (command.action === 'viewport') {
          if (command.viewport === undefined) {
            await respond({
              ok: false,
              errorCode: 'bad_request',
              error: 'viewport requires dimensions or null.',
            })
            return
          }
          setViewport(command.viewport)
          // A background WebView may throttle animation frames. The timer still lets
          // React commit; measurement below forces layout and verifies the actual result.
          await new Promise<void>((resolve) => {
            const fallback = setTimeout(resolve, 250)
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                clearTimeout(fallback)
                resolve()
              }),
            )
          })
        }
        if (cancelled) return
        const measure = () =>
          vf.runCommand(`${event.commandId}:viewport`, {
            action: 'evaluate',
            expression: '({width:window.innerWidth,height:window.innerHeight})',
          })
        if (command.action === 'viewport') {
          const reply = await measure()
          if (cancelled) return
          const viewport = reply.ok ? readViewport(reply.result?.value) : undefined
          const result = viewport ? { action: 'viewport', previewId, viewport } : undefined
          const matches =
            viewport &&
            (!command.viewport ||
              (viewport.width === command.viewport.width &&
                viewport.height === command.viewport.height))
          await respond(
            matches
              ? { ok: true, result }
              : {
                  ok: false,
                  result,
                  errorCode: 'failed',
                  error: viewport
                    ? `Requested viewport was not applied. Actual CSS viewport: ${viewport.width} × ${viewport.height}.`
                    : 'The page did not confirm its actual viewport.',
                },
          )
          return
        }
        executing = true
        const reply = await vf.runCommand(event.commandId, { ...command, action: command.action })
        if (cancelled) return
        const measured = command.action === 'snapshot' && reply.ok ? await measure() : undefined
        await respond({
          ...reply,
          ...(reply.result
            ? {
                result: {
                  ...reply.result,
                  previewId,
                  viewport: readViewport(measured?.result?.value),
                },
              }
            : {}),
        })
      })()
        .catch((error: unknown) => {
          if (cancelled) return
          void backendClient
            .previewResult(event.commandId, {
              ok: false,
              hostId,
              errorCode: 'failed',
              error: error instanceof Error ? error.message : 'Preview relay failed',
            })
            .catch(() => {})
        })
        .finally(() => {
          inFlight.current.delete(event.commandId)
        })
    }
  })
  useEffect(() => {
    if (options.enabled === false) return
    const pending = inFlight.current
    const unsubscribe = previewControlBus.subscribe((event) => handlerRef.current(event))
    return () => {
      unsubscribe()
      for (const cancel of pending.values()) cancel()
      pending.clear()
    }
  }, [options.enabled])
}

function readViewport(value: string | undefined): { width: number; height: number } | undefined {
  try {
    const size: unknown = JSON.parse(value ?? '')
    if (!size || typeof size !== 'object' || !('width' in size) || !('height' in size)) return
    if (
      typeof size.width === 'number' &&
      typeof size.height === 'number' &&
      Number.isFinite(size.width) &&
      Number.isFinite(size.height) &&
      size.width > 0 &&
      size.height > 0
    )
      return { width: size.width, height: size.height }
  } catch {
    /* A missing measurement is not successful verification. */
  }
}
