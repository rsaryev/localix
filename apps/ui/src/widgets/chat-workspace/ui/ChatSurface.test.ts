/**
 * ChatSurface / ChatPage — STRUCTURAL guards.
 *
 * These read source text, which is normally a smell (a change-detector: loud on
 * harmless refactors, silent on real breakage). It is justified here and ONLY here
 * because both invariants below are about *where a hook is called*, and neither has
 * a runtime seam we could observe without mounting the entire workspace (store,
 * sockets, editor grid) — the "test convenience forcing a shallow interface" trap.
 *
 * The rules a source-scanning assertion in this file MUST follow, learned the hard
 * way — the previous version of this file passed every mutation listed below:
 *
 *   1. Assert the CALL, never the bare identifier. `toContain('useAutoScroll')`
 *      matches the *import line*, so deleting the actual call left the guard green
 *      while the scroll feature was entirely dead.
 *   2. If the property is an ORDER, assert the order. `toContain(a)` + `toContain(b)`
 *      says nothing about a-before-b, so moving `useWorkspace()` *below* the
 *      hydration gate — precisely the bug this file is named for — kept it green.
 *   3. Never pin styling. Layout literals (`max-w-[58rem]`, `[scrollbar-gutter:stable]`,
 *      `composerHeight + 12`) carry no behavioral contract; asserting them only taxes
 *      the next person who nudges a margin. They were dropped, not ported.
 *
 * Scroll BEHAVIOR itself is not this file's job — `shared/hooks/useAutoScroll.test.ts`
 * exercises it for real.
 */

import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const chatSurface = readFileSync(resolve(import.meta.dir, './ChatSurface.tsx'), 'utf8')
const chatPage = readFileSync(
  resolve(import.meta.dir, '../../../pages/chat/ui/ChatPage.tsx'),
  'utf8',
)
/**
 * ChatPage plus the hooks it composes.
 *
 * Behaviour assertions must scan the COMPOSITION, not one file: extracting an effect into
 * `pages/chat/model/*` moves the text without changing what the page does, and a scan pinned to
 * ChatPage.tsx alone then goes red for a refactor (as it did) — or, worse, silently stops
 * reaching the code it polices. Assertions about ChatPage's own JSX still read `chatPage`.
 */
const chatPageModelDir = resolve(import.meta.dir, '../../../pages/chat/model')
const chatPageComposition = [
  chatPage,
  ...readdirSync(chatPageModelDir)
    .filter((file) => /\.tsx?$/u.test(file) && !file.includes('.test.'))
    .sort()
    .map((file) => readFileSync(resolve(chatPageModelDir, file), 'utf8')),
].join('\n')

describe('ChatSurface', () => {
  it('actually CALLS useAutoScroll (not merely imports it)', () => {
    // Mutation this must catch: replace the `useAutoScroll<…>()` call with anything
    // else, leaving the import in place. The scroll viewport goes dead, and the old
    // `toContain('useAutoScroll')` guard stayed green — it was matching the import.
    expect(chatSurface).toMatch(/=\s*useAutoScroll</)
  })

  it('attaches the ref useAutoScroll returned to the scroll viewport', () => {
    // A called-but-unattached hook scrolls nothing: the ref has to reach an element.
    expect(chatSurface).toMatch(/ref=\{scrollRef\}/)
  })

  it('feeds virtual transcript size changes through the follow-preserving scroll path', () => {
    expect(chatSurface).toContain('onContentSizeChange={scrollToBottom}')
  })

  it('exposes an accessible name on the jump-to-bottom control', () => {
    // The one user-facing string here worth pinning: the control is icon-only, so its
    // accessible name is the ONLY thing a screen reader has to go on.
    expect(chatSurface).toMatch(/aria-label=\{[^}]*'Scroll to bottom'/)
  })

  it('wires the jump-to-bottom control to the FORCING scroll, not the follow-preserving one', () => {
    // `scrollToBottom` is now a no-op while the reader is unpinned (it preserves their position for
    // the HITL-arrival trigger). This button is only ever RENDERED while unpinned, so wiring it to
    // that call makes the one control whose entire job is to go down completely dead. Nothing else
    // observes this: reverting the wiring broke no test until this assertion existed.
    expect(chatSurface).toMatch(/onClick=\{\(\) => forceScrollToBottom\('smooth'\)\}/)
  })

  it('stabilizes tip context by its primitive values', () => {
    expect(chatSurface).toContain(
      'const tipContext = useMemo(() => ({ userText, activeToolName }), [userText, activeToolName])',
    )
  })

  it('keeps the transcript renderer off the empty-chat startup path', () => {
    // MessageList owns the heavy Markdown + tool-result renderer graph. A static
    // import here silently puts that graph back into index.html's modulepreloads,
    // even though a new/empty chat has nothing to render.
    expect(chatSurface).not.toMatch(
      /import\s+\{\s*MessageList\s*\}\s+from\s+['"]@\/features\/chat\/ui\/MessageList['"]/,
    )
    expect(chatSurface).toContain("await import('@/entities/chat/ui/MessageList')")
    expect(chatSurface).toContain('<Suspense')
    expect(chatSurface).toContain('<LazyMessageList')
  })

  it('loads search and HITL renderers only when their interaction is active', () => {
    expect(chatSurface).not.toMatch(
      /import\s+\{\s*MessageSearch\s*\}\s+from\s+['"]@\/features\/chat\/ui\/MessageSearch['"]/,
    )
    expect(chatSurface).not.toMatch(
      /import\s+\{\s*ChatInteractionOverlay\s*\}\s+from\s+['"]@\/features\/chat\/ui\/hitl\/ChatInteractionOverlay['"]/,
    )
    expect(chatSurface).toContain("await import('@/entities/chat/ui/MessageSearch')")
    expect(chatSurface).toContain("await import('@/entities/chat/ui/hitl/ChatInteractionOverlay')")
    expect(chatSurface).toContain('<LazyMessageSearch')
    expect(chatSurface).toContain('<LazyChatInteractionOverlay')
  })

  it('refreshes mutations without subscribing every warm chat to workspace SWR state', () => {
    expect(chatSurface).toContain('const reloadWorkspace = useWorkspaceReloader()')
    expect(chatSurface).not.toContain('useWorkspace()')
  })
})

describe('ChatPage hydration', () => {
  it('renders the workspace shell and grid without a hydration return gate', () => {
    expect(chatPage).not.toMatch(/if \(!hasHydrated\)\s*\{\s*return/)
    expect(chatPage).toMatch(/return \(\s*<WorkspaceShell/)
    expect(chatPage).toMatch(/<GridView resolvedTheme=/)
  })

  it('keeps connection status in window chrome and defers background services', () => {
    expect(chatPage).not.toMatch(/if \(!hasHydrated\) return null;?/)
    expect(chatPage).toMatch(/headerStatus=\{/)
    expect(chatPage).not.toMatch(/contentStatus=\{/)
    expect(chatPage).toMatch(/<WorkspaceConnectionStatus/)
    expect(chatPage).not.toContain('absolute inset-x-0')
    expect(chatPage).not.toContain('z-(--z-popover)')
    expect(chatPageComposition).toContain('useChatEventStream(hasHydrated)')
    expect(chatPage).toContain("useSystemToggle('keep-awake', hasHydrated)")
  })

  it('publishes core UI destinations without waiting for plugin bootstrap', () => {
    expect(chatPageComposition).toContain(
      [
        'useEffect(() => {',
        '    if (routeProjectId === undefined) return',
        '    // Fail closed synchronously at the route boundary. Otherwise the first',
        "    // project-B catalog can capture project-A plugin destinations while B's",
        '    // contribution discovery is still in flight.',
        '    preparePluginContribScope(routeProjectId)',
        '    return startUiLocationCatalogSync(routeProjectId, whenUiSurfacesReady())',
        '  }, [routeProjectId])',
      ].join('\n'),
    )
  })

  it('keeps third-party iframe runtime off the initial workbench path', () => {
    // A plugin view is a TAB, so the editor grid's registry owns its lazy import (pinned
    // by registry.lazy.test). ChatPage must not reach for the iframe runtime at all —
    // rendering one here would put it back on the first-paint path it was moved off.
    expect(chatPage).not.toContain('BridgedPluginView')
  })

  it('loads the Explorer graph only when the Files rail content renders', () => {
    expect(chatPage).not.toMatch(
      /import\s+\{[^}]*FileTreeSidebar[^}]*\}\s+from\s+['"]@\/features\/inspector['"]/,
    )
    expect(chatPage).toContain("import('@/features/inspector/ui/FileTreeSidebar')")
    expect(chatPage).toContain(
      [
        'content: (',
        '                  <Suspense fallback={<LoadingHint className="min-h-0 flex-1 text-xs" />}>',
        '                    <FileTreeSidebar />',
        '                  </Suspense>',
        '                ),',
      ].join('\n'),
    )
  })

  it('carries no theme-picker overlay — appearance is the rail cycle button', () => {
    // The picker (and preset themes with it) was removed outright; a re-import would
    // resurrect a settings surface for something one visible click now answers.
    expect(chatPage).not.toContain('ThemePicker')
    expect(chatPage).not.toContain('THEME_PICKER_OVERLAY_ID')
  })
})
