import { createContext, useContext, type ReactNode } from 'react'

const ActionSurface = createContext<string | null>('content')

/** A host-named surface, or null while content is incomplete or actions are inappropriate. */
export function ActionSurfaceProvider({
  surface,
  children,
}: {
  surface: string | null
  children: ReactNode
}) {
  return <ActionSurface.Provider value={surface}>{children}</ActionSurface.Provider>
}

export function useActionSurface(): string | null {
  return useContext(ActionSurface)
}
