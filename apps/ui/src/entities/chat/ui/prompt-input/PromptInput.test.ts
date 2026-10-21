import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import { nextCaretInText } from './caretInText'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const source = read('./PromptInput.tsx')
// The composer's responsibilities live beside it; each assertion reads the file that owns it.
const textField = read('./ComposerTextField.tsx')
const send = read('./usePromptSend.ts')
const voice = read('./useComposerVoice.ts')
const completion = read('./useChatInlineCompletion.ts')

test('keeps dynamic slash-command identity stable across parent renders', () => {
  expect(source).toContain('useSkillCommands(activeSessionId, isFocused)')
  expect(source).toContain('usePluginCommands(activeSessionId, isFocused)')
  expect(source).toContain('const dynamicCommands = useMemo(')
  expect(source).toContain('isFocused ? loadDynamicOptions : undefined')
  expect(source).not.toContain('useComposerCommands(prompt, setPrompt, [...skillCommands')
})

/**
 * These four stay FOCUS-gated on purpose: a rotating tip strip, a live microphone and an
 * open command menu belong to the composer you are typing in, not to every visible one.
 *
 * The context-ref preflight used to be pinned here too, on the same signal. That was the
 * reported defect — the ambient tab links only appeared once you clicked into the input —
 * and it is now gated on VISIBILITY. The replacement assertion lives in
 * `ambientTabLinks.test.ts`, which pins the argument and forbids `isFocused` there outright;
 * this one was deleted rather than relaxed, because the behaviour it described is gone.
 */
test('keeps warm-hidden composer side effects dormant', () => {
  expect(source).toContain('isGenerating && isFocused')
  expect(source).toContain('isFocused={isFocused}')
  expect(source).toMatch(/useComposerVoice\(\{\s*isFocused,/)
  expect(voice).toContain('useVoiceRecorder(isFocused)')
  expect(source).toContain('const openCommandActive = isFocused &&')
})

test('reuses the Localix border beam as a typed reasoning-level effect', () => {
  expect(source).toContain('const beamIntensity = reasoningBeamIntensity(reasoningEffort)')
  expect(source).toContain('active={focused || isGenerating || beamIntensity > 0}')
  expect(source).toContain('intensity={beamIntensity}')
})

test('distinguishes an available agent-link destination from an active hover target', () => {
  expect(source).toContain('data-agent-link-drop-target')
  expect(source).toContain("data-drop-active={!props.dropzone && dragKind ? 'true' : undefined}")
  expect(source).toContain('composerShellClassName(focused, !props.dropzone && Boolean(dragKind))')
  expect(read('./composerShell.ts')).toContain('const border = dropActive')
  expect(read('./composerShell.ts')).toContain('DROP_TARGET_SURFACE_ACTIVE')
})

test('owns one async send preflight without clearing refs added to the next draft', () => {
  expect(send).toContain('if (preparingSendRef.current) return')
  expect(send).toContain('const submittedPinnedKeys = ctxRefs.pinnedRefs.map((ref) => ref.key)')
  expect(send).toContain('ctxRefs.clearPinnedRefs(submittedPinnedKeys)')
  expect(source).toContain('!preparingSend &&')
})

test('uses native path picks while preserving the browser picker fallback and accept hint', () => {
  expect(source).toContain('filesFromDesktopPick(await desktopPickFiles())')
  expect(source).toContain('if (files === undefined) {')
  expect(source).toContain('fileInputRef.current?.click()')
  expect(source).toContain('handleFiles(files)')
  expect(source).toContain('onAttachClick={() => void handleAttachClick()}')
  expect(source).toContain('accept={attachmentGate ? acceptAttribute(attachmentGate) : undefined}')
})

test('loads attachment previews only after the composer owns an attachment', () => {
  expect(source).not.toMatch(
    /import\s+\{\s*AttachmentTray\s*\}\s+from\s+['"][^'"]*AttachmentTray['"]/,
  )
  expect(source).toContain("import('@/shared/ui/attachments/AttachmentTray')")
  expect(source).toContain('onRemoveAttachment && attachmentItems.length > 0')
  expect(source).toContain('<Suspense fallback={null}>')
})

test('loads uncommon completion menus only when their local surfaces open', () => {
  for (const file of [source, textField]) {
    expect(file).not.toMatch(/import\s+\{\s*AtRefMenu\s*\}\s+from\s+['"]\.\/AtRefMenu['"]/)
    expect(file).not.toMatch(
      /import\s+\{\s*OpenResourceMenu\s*\}\s+from\s+['"]\.\/OpenResourceMenu['"]/,
    )
  }
  expect(textField).toContain("import('./AtRefMenu')")
  expect(textField).toContain("import('./OpenResourceMenu')")
  expect(textField).toContain("menu?.kind === 'at' &&")
  expect(textField).toContain("menu?.kind === 'open' &&")
})

/**
 * Caret reporting fires from five textarea events, several per keystroke. The
 * reducer must keep the PREVIOUS object when nothing moved (so React bails and
 * the composer renders once per keystroke, not twice) while still reporting a
 * genuine move — including a move to the very end, which is what gates the
 * inline-completion ghost.
 */
test('caret state bails on a repeated report and updates on a real move', () => {
  const first = nextCaretInText(null, 5, 'hello')
  expect(first).toEqual({ offset: 5, text: 'hello' })

  // Same caret, same text (change → keyUp for one keystroke): identical object.
  expect(nextCaretInText(first, 5, 'hello')).toBe(first)

  // Caret moved within the same text (ArrowLeft): new object.
  const moved = nextCaretInText(first, 4, 'hello')
  expect(moved).not.toBe(first)
  expect(moved).toEqual({ offset: 4, text: 'hello' })

  // Same offset but a DIFFERENT text (programmatic replace) must not be bailed:
  // the offset is only trusted while its text still matches the live prompt.
  const retyped = nextCaretInText(moved, 4, 'world')
  expect(retyped).not.toBe(moved)
  expect(retyped).toEqual({ offset: 4, text: 'world' })
})

test('the caret reducer is what the composer state uses', () => {
  expect(source).toContain('setCaretInText((prev) => nextCaretInText(prev, offset, text))')
})

/**
 * The inline-completion context key must not serialize the @-ref set inside a
 * store selector: that selector runs on every chat-store emission (once per
 * streamed token), so a JSON.stringify in there is on the token path.
 */
test('keeps JSON serialization out of the chat-store selector', () => {
  const start = completion.indexOf('const sessionContextVersion = useChatStore(')
  const end = completion.indexOf('const chatCompletionContextKey = useMemo(')
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  const selector = completion.slice(start, end)
  expect(selector).not.toContain('JSON.stringify')
  expect(selector).toContain('useShallow(')
  expect(completion).toContain('const completionRefsKey = useMemo(')
})
