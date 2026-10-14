import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { transitionRailMenu, type RailMenuAction, type RailMenuState } from '../model/railMenuState'

interface RailToolMenuController {
  state: RailMenuState
  current: () => RailMenuState
  send: (action: RailMenuAction) => void
}

const RailToolMenuContext = createContext<RailToolMenuController | null>(null)

function useMenuController(): RailToolMenuController {
  const [state, setState] = useState<RailMenuState>(null)
  const stateRef = useRef<RailMenuState>(null)
  const current = useCallback(() => stateRef.current, [])
  const send = useCallback((action: RailMenuAction) => {
    const next = transitionRailMenu(stateRef.current, action)
    if (next === stateRef.current) return
    // Outside dismissal can arrive before React commits a switch to another trigger.
    stateRef.current = next
    setState(next)
  }, [])
  return useMemo(() => ({ state, current, send }), [state, current, send])
}

export function RailToolMenuGroup({ children }: { children: ReactNode }) {
  const controller = useMenuController()
  return <RailToolMenuContext.Provider value={controller}>{children}</RailToolMenuContext.Provider>
}

export function useRailToolMenuGroup(): RailToolMenuController {
  const group = useContext(RailToolMenuContext)
  const standalone = useMenuController()
  return group ?? standalone
}
