import { memo, useCallback, useDeferredValue, useMemo, type ReactNode } from 'react'
import { Check, Copy, SquareTerminal, FileCode2 } from 'lucide-react'
import { terminal as terminalBus } from '@/shared/lib/terminalBus'
import { codeSnippet, useCodeSnippetAvailable, snippetExtFor } from '@/shared/lib/codeSnippetBus'
import { useCopied } from '@localixai/mini-app-sdk/ui/interactions'
import { useWorkItemSessionId } from '@localixai/mini-app-sdk/ui/work-item-session'
import { ContributedActions } from '../ContributedActions'
import { IconButton } from '@localixai/kit/icon-button'
import { WorkbenchToolbar, WorkbenchToolbarSection } from '@localixai/kit/workbench-toolbar'
import { CODE_VIEWER_HIGHLIGHT } from './sugarHighTheme'
import { highlightCode } from './highlightCode'
import { createBoundedCache } from '@localixai/kit/lib'
import { COPIED_FEEDBACK_LONG_MS } from '@/shared/lib/timings'

interface CodeBlockProps {
  code: string
  language?: string
  className?: string
  /** Disable tokenization while a block is still growing; the settled render highlights once. */
  syntaxHighlight?: boolean
  /** File-viewer mode: blend into the host panel (no own surface, no header). */
  bare?: boolean
  /** Soft-wrap long lines instead of horizontal scrolling (default: no wrap). */
  wrap?: boolean
  /** Read-only editor mode: render a stable one-based gutter beside every source line. */
  lineNumbers?: boolean
  /** Append a blinking typing caret after the code — for live, still-streaming
   *  views (the inspector's live file-change tab) so it reads as the agent typing. */
  caret?: boolean
  /** Extra toolbar actions from the host, placed before Copy — e.g. a diagram's source view
   *  offers "Show diagram" here, so the way back sits where the block's own controls are. */
  actions?: ReactNode
}

function normalizeCode(code: string): string {
  return code.replace(/\r\n/g, '\n').replace(/\n$/, '')
}

/**
 * Sugar High emits `.sh__line` wrappers for its built-in grammars, but escaped formats such as
 * HTML and XML are returned as plain text. Add the same wrappers in that fallback path so
 * the CSS-counter gutter works for every response format, without double-wrapping known grammars.
 */
function ensureLineWrappers(html: string): string {
  if (html.includes('class="sh__line')) return html
  return html
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .map((line) => `<span class="sh__line">${line || '&#8203;'}</span>`)
    .join('\n')
}

// Highlight cache shared across mounts. The virtualized message list unmounts
// and remounts rows on every scroll pass, so without this each code block
// re-tokenizes from scratch every time it re-enters the viewport — the main
// source of scroll jank in long, code-heavy dialogs. Keyed by the exact code
// string; bounded so a marathon session can't hoard hundreds of large blocks. An
// exceptional block is useful on screen but not in the conversational cache: the
// bounded cache refuses it rather than let it flush the useful small entries.
const highlightCache = createBoundedCache<string, string>({
  maxEntries: 200,
  maxWeight: 2_000_000,
  weigh: (html, key) => key.length + html.length,
})

function highlightCached(code: string, language?: string): string {
  // The same source can appear under different fenced languages, so the grammar
  // is part of the cache identity.
  const key = `${language?.toLowerCase() ?? ''}\0${code}`
  const hit = highlightCache.get(key)
  if (hit !== undefined) return hit
  const html = highlightCode(code, language)
  highlightCache.set(key, html)
  return html
}

export const CodeBlock = memo(function CodeBlock({
  code,
  language,
  className,
  syntaxHighlight = true,
  bare,
  wrap,
  lineNumbers,
  caret,
  actions,
}: CodeBlockProps) {
  const { copied: isCopied, copy } = useCopied(COPIED_FEEDBACK_LONG_MS)
  const normalizedCode = useMemo(() => normalizeCode(code), [code])
  // Highlighting a large, still-growing block is O(code) per render. Defer it so
  // the work runs at low priority: while the block streams, React keeps the prior
  // highlight on screen and drops intermediate frames rather than blocking the
  // main thread on every growth step (it catches up once the code settles).
  const deferredCode = useDeferredValue(normalizedCode)
  const highlightedCode = useMemo(
    () => (syntaxHighlight ? highlightCached(deferredCode, language) : ''),
    [deferredCode, language, syntaxHighlight],
  )
  // Live caret: appended to the highlighted markup so it sits at the write head.
  const displayCode = lineNumbers ? ensureLineWrappers(highlightedCode) : highlightedCode
  const inner = caret
    ? `${displayCode}<span class="lx-type-caret" aria-hidden="true"></span>`
    : displayCode
  const codeClassName = `block bg-transparent text-sm leading-[1.7] [font-family:'JetBrains_Mono',ui-monospace,monospace] ${wrap ? 'whitespace-pre-wrap break-words' : 'min-w-max whitespace-pre'}`

  const handleCopy = useCallback(() => {
    void copy(normalizedCode) // useCopied catches clipboard failures (insecure context / denied)
  }, [copy, normalizedCode])

  // Both actions act on the chat this block belongs to (the transcript or tab rendering it): a
  // command pasted into whichever terminal was last active landed in another chat's shell, in
  // another chat's directory. Outside a chat neither action exists, so neither button renders.
  const sessionId = useWorkItemSessionId()

  // Shell snippets get a "Run" action that pastes the command into the inspector
  // terminal (no trailing newline — the user reviews on the prompt and hits Enter).
  const isShell =
    sessionId !== null &&
    Boolean(language) &&
    /^(bash|sh|shell|zsh|console|shellscript)$/i.test(language!)
  const handleRun = useCallback(() => {
    // The bus strips the trailing newline (no auto-execute).
    if (sessionId) terminalBus.run({ sessionId, command: normalizedCode })
  }, [sessionId, normalizedCode])

  // A code block whose language maps to a dedicated editor extension gets an "Open" action
  // that materializes it as a temp scratch file and opens it in the editor (e.g. a SQL block
  // → a `.sql` file with Run + schema autocomplete). Shown only when the chat feature
  // registered a handler (i.e. inside the workspace), so it's never a dead button in docs.
  const snippetExt = snippetExtFor(language)
  const openerReady = useCodeSnippetAvailable()
  const canOpenSnippet = Boolean(snippetExt) && openerReady && sessionId !== null
  const handleOpenSnippet = useCallback(() => {
    if (snippetExt && sessionId)
      codeSnippet.open({ sessionId, ext: snippetExt, code: normalizedCode })
  }, [sessionId, snippetExt, normalizedCode])

  return (
    <figure
      className={[
        // bare = file viewer: it FILLS the panel (no border, no rounding, no header), so it is
        // pane-sized and paints no ground at all — it inherits the pane it fills. A fill there
        // was a second coat over the pane's, which under the macOS glass theme composited into a
        // black slab (`scripts/pane-ground-guard.test.ts` keeps it deleted).
        // The bordered block is ELEMENT-sized and keeps its inset — a black-veil `--surface-sunken`
        // rather than `--surface-raised`, because raised mixes from a ground DARKER than the pane
        // and read as an opaque card dropped into the transcript. Sunken is the same "recessed"
        // step on the opaque themes and stays a veil over glass, deepening the pane it sits on.
        bare
          ? 'my-0 min-h-full overflow-hidden border-0'
          : 'my-3.5 overflow-hidden rounded-xl border border-border bg-surface-sunken',
        // High-contrast syntax scheme. LIGHT values are the base;
        // the project's `dark:` variant (defined in index.css) swaps to dark values —
        // reliable, unlike an arbitrary [data-theme=light] selector. Identifiers &
        // punctuation use var(--foreground)/(--text-soft) so they auto-adapt either way.
        'text-foreground',
        // High-contrast syntax scheme — shared with the editor so
        // reading and editing a file render identically. See sugarHighTheme.ts.
        CODE_VIEWER_HIGHLIGHT,
        lineNumbers && 'code-line-numbers',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {!bare && (
        <WorkbenchToolbar
          as="figcaption"
          density="slim"
          aria-label={`${language ?? 'text'} code block controls`}
          className="border-control-border/68 bg-surface-raised/78"
        >
          <span className="min-w-0 flex-1 truncate text-2xs font-medium text-text-faint">
            {language ?? 'text'}
          </span>
          <WorkbenchToolbarSection align="end" spacing="compact" aria-label="Code block actions">
            {isShell && (
              <IconButton
                size="sm"
                onClick={handleRun}
                aria-label="Send to terminal"
                tooltip="Send to terminal"
              >
                <SquareTerminal className="size-3.5" />
              </IconButton>
            )}
            {canOpenSnippet && (
              <IconButton
                size="sm"
                onClick={handleOpenSnippet}
                aria-label="Open in the editor"
                tooltip="Open in the editor as a scratch file — edit and run"
              >
                <FileCode2 className="size-3.5" />
              </IconButton>
            )}
            {actions}
            <ContributedActions target={{ kind: 'code', text: normalizedCode, language }} />
            <IconButton
              size="sm"
              onClick={handleCopy}
              aria-label={isCopied ? 'Copied' : 'Copy code'}
              tooltip={isCopied ? 'Copied' : 'Copy code'}
            >
              {isCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </IconButton>
          </WorkbenchToolbarSection>
        </WorkbenchToolbar>
      )}
      <div className="overflow-x-auto scrollbar-thin" data-scrollable>
        <pre className="m-0 min-w-full p-4">
          {syntaxHighlight ? (
            <code className={codeClassName} dangerouslySetInnerHTML={{ __html: inner }} />
          ) : (
            <code className={codeClassName}>
              {normalizedCode}
              {caret && <span className="lx-type-caret" aria-hidden="true" />}
            </code>
          )}
        </pre>
      </div>
    </figure>
  )
})
