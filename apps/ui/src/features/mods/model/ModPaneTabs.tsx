import { useEffect, useRef, useState } from 'react'
import { useGridStore } from '@/entities/workspace-grid/model'
import { inspector } from '@/shared/lib/inspectorBus'
import type { ModPaneRef } from '@/shared/api/modsApi'
import { paneFocus } from './paneFocus'
import { MOD_PANE_KIND, modPaneTabId, modPaneTabPayload, planPaneTabs } from './paneTabs'
import { closeModPane, useModsOverview } from './useMods'

/**
 * Keeps the `mod-pane` tabs in step with the panes the server lists (`paneTabs.ts`), and turns the
 * person closing one into `ui.close`. Mounted with every chat; one instance — the first — does the
 * work, so a pane is opened and closed once however many chats are on screen.
 */

let owner: symbol | null = null

const openTabIds = () =>
  Object.values(useGridStore.getState().items)
    .filter((item) => item.kind === MOD_PANE_KIND)
    .map((item) => item.id)

export function ModPaneTabs() {
  const me = useRef(Symbol('mod-pane-tabs'))
  const overview = useModsOverview()
  const panes = overview.data?.panes
  const latest = useRef<readonly ModPaneRef[] | undefined>(undefined)
  const held = useRef(new Set<string>())
  const closingOurselves = useRef(new Set<string>())
  const { mutate } = overview
  // Plans again when a held tab is released, though the panes read the same.
  const [released, setReleased] = useState(0)

  useEffect(() => {
    if (owner === null) owner = me.current
    return () => {
      if (owner === me.current) owner = null
    }
  }, [])

  useEffect(() => {
    if (owner !== me.current || !panes) return
    latest.current = panes
    const plan = planPaneTabs({
      panes,
      openTabs: openTabIds(),
      asked: paneFocus.take(panes),
      held: held.current,
    })
    for (const id of plan.close) {
      closingOurselves.current.add(id)
      inspector.closeWorkItems(id)
      closingOurselves.current.delete(id)
    }
    for (const { pane, focus } of plan.open)
      inspector.openWorkItem({
        workKind: MOD_PANE_KIND,
        id: modPaneTabId(pane),
        title: pane.title ?? pane.id,
        scope: null,
        payload: { instance: pane.instance, paneId: pane.id, plugin: pane.plugin },
        ...(focus ? {} : { activate: false }),
      })
  }, [panes, released])

  // A pane tab gone from the grid by the person's hand: they closed the pane.
  useEffect(
    () =>
      useGridStore.subscribe((state, before) => {
        if (owner !== me.current) return
        for (const [id, item] of Object.entries(before.items)) {
          if (item.kind !== MOD_PANE_KIND || state.items[id] || closingOurselves.current.has(id))
            continue
          const ref = modPaneTabPayload(item.payload)
          const pane = latest.current?.find(
            (open) => open.instance === ref?.instance && open.id === ref?.paneId,
          )
          if (!pane) continue
          held.current.add(id)
          void closeModPane(pane).then(async () => {
            // The mod's answer is in the next overview: a pane it kept gets its tab back.
            await mutate()
            held.current.delete(id)
            setReleased((count) => count + 1)
          })
        }
      }),
    [mutate],
  )
  return null
}
