import { useEffect } from 'react'
import { Button } from '@localixai/kit/button'
import { useTheme } from '@/shared/theme/useTheme'
import { useFontFamily } from '@/features/settings/model/useFontFamily'
import { startStartupRetry } from '@/shared/lib/startupRetry'
import { useSettingsStore } from '@/shared/lib/user-settings/settingsStore'
import { platformCapabilities } from '@/shared/lib/platformCapabilities'
import { openIslandSession } from '@/shared/lib/islandWindow'
import { islandStyle } from '@/features/agent-island/model/geometry'
import { useIsland } from '@/features/agent-island/model/useIsland'
import { useIslandContentHeight } from '@/features/agent-island/model/useIslandContentHeight'
import { useIslandGeometry } from '@/features/agent-island/model/useIslandGeometry'
import { useIslandOverlays } from '@/features/agent-island/model/useIslandOverlays'
import { useIslandRequests } from '@/features/agent-island/model/useIslandRequests'
import { useWorkspaceFocus } from '@/features/agent-island/model/useWorkspaceFocus'
import { IslandRequest } from '@/features/agent-island/ui/IslandRequest'
import '@/features/agent-island/ui/island.css'

/**
 * The agent island: the requests that block a run, while Localix is in the background, and the
 * light of working agents. No chat, no composer. It draws nothing when idle.
 */
export function AgentIslandPage() {
  useTheme()
  useFontFamily()
  const loadSettings = useSettingsStore((state) => state.loadFromBackend)
  const { requests, briefs, working, settle } = useIslandRequests()
  // A focused workspace already shows its requests; the island leaves them to it.
  const appFocused = useWorkspaceFocus()
  const geometry = useIslandGeometry()
  const { ref: contentRef, height } = useIslandContentHeight(geometry.notchHeight)
  const island = useIsland({
    queue: requests.map((request) => request.key),
    working,
    appFocused,
    height,
    nativePointer: geometry.nativePointer,
  })
  useIslandOverlays(island.open)
  useEffect(() => startStartupRetry(loadSettings), [loadSettings])
  useEffect(() => {
    document.documentElement.dataset.island = 'true'
    void platformCapabilities()
      .desktop.invoker()?.('island_ready')
      .catch((error) => console.warn('[agent-island] could not show', error))
    return () => {
      delete document.documentElement.dataset.island
    }
  }, [])

  // The card stays mounted while folded (inert), so a half-typed answer survives a fold.
  const request = requests.find((candidate) => candidate.key === island.key)
  const status =
    island.mode === 'waiting' ? 'Waiting for you' : island.mode === 'working' ? 'Working' : ''
  return (
    <main
      aria-label="Agent island"
      data-expanded={island.open}
      data-quiet={island.mode === 'hidden' && !island.open}
      data-notch={geometry.hasNotch}
      data-native-material={geometry.nativeMaterial}
      className="lx-agent-island outline-none"
      style={islandStyle(geometry.geometry, height)}
    >
      <div className="lx-island-material lx-floating-surface" aria-hidden />
      <div className="lx-island-outline" aria-hidden>
        <span
          className="lx-island-edge"
          data-active={!island.open && island.mode !== 'hidden'}
          data-mode={island.mode}
        >
          <span className="lx-island-edge-glow" />
          <span className="lx-island-edge-rim" />
        </span>
      </div>
      {island.mode === 'waiting' && !island.open && (
        <Button
          variant="ghost"
          className="lx-island-resting justify-center p-0"
          aria-label="Show the request waiting for you"
          onClick={island.activate}
          onPointerEnter={island.onPointerEnter}
          onPointerLeave={island.onPointerLeave}
        />
      )}
      <span role="status" className="sr-only">
        {status}
      </span>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Observes the person engaging the card (click, key, input) so Enter and Escape may answer it; the controls inside are the interactive elements. */}
      <div
        role="group"
        aria-label="Request waiting for you"
        className="lx-island-open"
        inert={!island.open}
        onPointerDown={island.engage}
        onKeyDown={island.engage}
        onInput={island.engage}
        onPointerEnter={island.onPointerEnter}
        onPointerLeave={island.onPointerLeave}
      >
        <div ref={contentRef} className="lx-island-content flex flex-col gap-2 px-3 pt-2 pb-3">
          {request && (
            <IslandRequest
              key={request.key}
              item={request}
              sessionTitle={briefs.get(request.sessionId)?.title.trim() || 'A background chat'}
              keyboardActive={island.open && island.engaged}
              onOpenChat={() => void openIslandSession(request.sessionId).catch(() => {})}
              onSettled={() => settle(request.key)}
            />
          )}
        </div>
      </div>
    </main>
  )
}
