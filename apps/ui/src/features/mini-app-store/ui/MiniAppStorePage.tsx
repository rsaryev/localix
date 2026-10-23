import { MiniAppStore } from '@/entities/mini-app-store/ui/MiniAppStore'

/** The store's tab: a short heading, then the store filling the pane. */
export function MiniAppStorePage() {
  return (
    <div className="@container h-full min-h-0 overflow-y-auto px-4 py-5 @2xl:px-6">
      <header className="mb-3 px-2">
        <h1 className="text-base font-semibold text-foreground">Mini apps</h1>
        <p className="text-xs text-text-soft">
          Screens and tools that work beside your chats. One you install appears in the rail.
        </p>
      </header>
      <MiniAppStore />
    </div>
  )
}
