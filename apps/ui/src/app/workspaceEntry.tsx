import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { router } from './routing/router'
import { RootErrorBoundary } from './RootErrorBoundary'
import { applyPlatformDataset } from '@localixai/kit/environment'
import { installNativeContextMenu } from '@/shared/lib/nativeContextMenu'
import { installLocationLedger } from '@/features/chat/model/locationLedger'
import { installWindowChromeState } from '@/shared/lib/windowChrome'
import { installFileDropGuard } from '@/shared/lib/fileDropGuard'
import { installQuitFlush } from '@/shared/lib/quitFlush'
import { isDesktop } from '@localixai/kit/environment'
import { registerAgentRunPreflight } from '@/shared/api/agentRunPreflight'
import { registerSessionPreviews } from '@/shared/lib/sessionPreviews'
import { inspectorSessionPreviews } from '@/features/inspector/model/sessionPreviewRouters'
import { registerCompletionWorkingSet } from '@/shared/api/completionWorkingSet'
import { workspaceCompletionWorkingSet } from '@/features/workspace-grid/model/completionWorkingSet'
import { restoreShellFrame } from '@/features/chat/model/restoreShellFrame'
import { waitForRuntimeCapabilities } from '@/shared/contrib/runtimeCapabilityReadiness'
import { tauriFrontendLog } from '@/shared/lib/tauri'
import './pluginRuntime'
import { installPluginSharedModules } from './pluginSharedModules'

// Before any plugin UI artifact is imported: they take React, the SDK and the kit from here.
installPluginSharedModules()

// First line of our own code to run. The shell stamps `setup entered` and
// `webview created`; this closes the gap between them and `shell.paint` by
// splitting it into "document + entry chunk arrived" and "React mounted".
// Measured on the packaged build, webview→paint is ~1.5s — by far the largest
// remaining span in a launch, and it was previously one opaque block.
tauriFrontendLog(
  'startup',
  `entry.script epochMs=${Date.now()} docStart=${window.__LOCALIX_DOC_START ?? 0}`,
)
// Re-apply the persisted theme preset (plugin palette overlay) before first paint.
// Stamp data-os / data-desktop on <html> so CSS can key native-feel styling off
// the platform (native scrollbars, font stacks, chrome) before first paint.
applyPlatformDataset()
// Native-app chrome: suppress the browser's right-click menu in the desktop shell
// (kept over editable fields + selections). No-op in a plain browser.
installNativeContextMenu(isDesktop)
// Desktop window-chrome state: stamp data-window-inactive / data-fullscreen on
// <html> so the custom titlebar dims when unfocused and drops the traffic-light
// padding in native fullscreen. No-op in a plain browser.
installWindowChromeState()
// The one writer of where the person is: launch restore, per-project memory, desktop route.
installLocationLedger(router)
// OS-file drop handling (web + desktop, HTML5-based): the window guard stops a
// stray drop from navigating to a bare file:// view and routes it via
// fileDropRouter — on DESKTOP the real path is recovered from the drag
// pasteboard (`dragged_paths`) so files open EDITABLE in place and folders open
// as a project; on the WEB it opens a read-only media viewer. A drop on the
// composer is attached by useComposerDropzone either way. The desktop shell
// keeps Tauri's native drag-drop DISABLED (lib.rs) so these DOM events fire.
installFileDropGuard()
// Before anything registers a pending write: quit (the shell's before-quit handshake) and
// pagehide run every registered flush, so a debounced write is never lost with the page.
installQuitFlush()
// Register before the first paint: child effects, deep links, retries, and the
// composer all cross the same persisted runtime-capability barrier from their
// first run.
registerAgentRunPreflight(waitForRuntimeCapabilities)
registerSessionPreviews(inspectorSessionPreviews)
// Every completion surface (composer, commit subject, plugin fields, the code editor) carries
// what is open on screen; the grid is the one thing that knows it.
registerCompletionWorkingSet(workspaceCompletionWorkingSet)
// Before the first render, not after the first response: the workbench shell is restored
// from the previous launch so React's first commit already has the session roster and the
// capability set. Without this the sidebar and the activity rail render EMPTY and fill in
// over the following ~1.5s, which is a structural pop-in rather than a flicker.
restoreShellFrame()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </StrictMode>,
)
