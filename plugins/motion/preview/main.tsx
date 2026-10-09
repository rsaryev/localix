import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Workspace } from '../ui/Workspace'
import { bindPluginUiTransport } from '@localixai/plugin-sdk/ui/transport'
// Only the standalone shell initializes the host theme; inside Localix the host owns it.
import { useTheme as usePreviewTheme } from '@localixai/kit/theme'
import './style.css'

bindPluginUiTransport({ request: (path, init) => fetch(path, init), url: (path) => path })

function Preview() {
  usePreviewTheme()
  return (
    <div className="flex h-dvh flex-col text-foreground">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
        <span className="text-xs text-text-soft">Motion Studio · standalone preview</span>
      </header>
      <main className="min-h-0 flex-1">
        <Workspace sessionId="motion-preview" />
      </main>
      <footer className="border-t border-border px-4 py-2 text-xs text-text-faint">
        Local Bun backend · Open in Localix to use agent context
      </footer>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
)
