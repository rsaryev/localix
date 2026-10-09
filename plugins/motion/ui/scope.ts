import { createContext, useContext } from 'react'

export const MotionSessionContext = createContext<string | undefined>(undefined)
export const useMotionSessionId = () => useContext(MotionSessionContext)
export const motionPath = (sessionId: string, path: string) =>
  `${path}?${new URLSearchParams({ sessionId })}`
