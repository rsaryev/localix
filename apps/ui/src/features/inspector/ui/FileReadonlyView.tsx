import { useEffect, useMemo, useRef, useState } from 'react'
import { Code, AlignLeft, WrapText } from 'lucide-react'
import { CodeBlock } from '@/shared/ui/code-block/CodeBlock'
import { MarkdownRenderer } from '@/shared/ui/MarkdownRenderer'
import { languageFromPath } from '@/shared/ui/diff'
import { ActionPill } from '@localixai/kit/action-pill'
import { isMarkdown } from './fileTabHelpers'
import { CopyContentButton, SourceToggle } from './FileViewerControls'
import { WorkbenchToolbar, WorkbenchToolbarSection } from '@localixai/kit/workbench-toolbar'

interface FileReadonlyViewProps {
  path: string
  content: string
  truncated: boolean
  /** 1-indexed line to scroll to once laid out (from a `path:line` link). */
  line?: number
}

/**
 * Read-only viewer branch of the inspector file panel: renders markdown (with a
 * raw-source toggle), or code via the read-only CodeBlock. Minified JSON gets an
 * opt-in pretty-print toggle, and long lines can be soft-wrapped. State resets per
 * file because the parent remounts this on path change.
 */
export function FileReadonlyView({ path, content, truncated, line }: FileReadonlyViewProps) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  // Transient highlight band for the jumped-to line (px within the content wrapper).
  const [highlight, setHighlight] = useState<{ top: number; height: number } | null>(null)
  // Markdown files render by default; the toggle shows the raw source.
  const [showSource, setShowSource] = useState(false)
  // Opt-in pretty-printing for minified JSON. Default stays RAW (faithful to disk,
  // keeps line-links valid); the toggle only appears when prettifying actually
  // changes the content (i.e. the file is minified / compact).
  const [formatJson, setFormatJson] = useState(false)
  // Soft-wrap long lines (logs, minified/data files) instead of horizontal scroll.
  const [wrapLines, setWrapLines] = useState(false)

  const jsonPretty = useMemo(() => {
    if (!/\.json$/i.test(path)) return null
    try {
      const pretty = JSON.stringify(JSON.parse(content), null, 2)
      return pretty !== content.trimEnd() ? pretty : null
    } catch {
      return null // not valid JSON (e.g. JSONC/JSON5 with comments) — leave it raw
    }
  }, [content, path])

  // Scroll to a requested line once the content is laid out (and briefly flash it).
  // The code viewer uses `whitespace-pre` (no wrapping) + a fixed line-height, so
  // each source line is exactly one row — the offset is deterministic. Markdown
  // has no line grid, so it is skipped.
  useEffect(() => {
    if (!line || isMarkdown(path)) return
    let timer: ReturnType<typeof setTimeout>
    const id = requestAnimationFrame(() => {
      const c = bodyRef.current,
        wrapper = wrapperRef.current
      const code = c?.querySelector('pre code')
      if (!c || !wrapper || !code) return
      const lh = Number.parseFloat(getComputedStyle(code).lineHeight) || 20
      const codeTop = code.getBoundingClientRect().top - c.getBoundingClientRect().top + c.scrollTop
      c.scrollTop = Math.max(0, codeTop + (line - 1) * lh - c.clientHeight * 0.3)
      // Band offset relative to the (scrolling) content wrapper — scroll-invariant.
      const codeTopInWrapper =
        code.getBoundingClientRect().top - wrapper.getBoundingClientRect().top
      setHighlight({ top: codeTopInWrapper + (line - 1) * lh, height: lh })
      timer = setTimeout(() => setHighlight(null), 4800)
    })
    return () => {
      cancelAnimationFrame(id)
      clearTimeout(timer)
    }
  }, [line, path])

  const markdown = isMarkdown(path)
  const showPretty = Boolean(jsonPretty) && formatJson
  const codeContent = showPretty ? jsonPretty! : content
  const showingCode = !markdown || showSource // a CodeBlock is on screen (vs rendered markdown)
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <WorkbenchToolbar aria-label="File viewer actions" density="slim" wrap>
        <WorkbenchToolbarSection align="end" spacing="compact" wrap>
          {markdown && (
            <SourceToggle showSource={showSource} onToggle={() => setShowSource((v) => !v)} />
          )}
          {jsonPretty && (
            <ActionPill
              title={
                formatJson
                  ? 'Show the file as stored (minified)'
                  : 'Pretty-print this minified JSON'
              }
              onClick={() => setFormatJson((v) => !v)}
            >
              {formatJson ? <Code className="size-3" /> : <AlignLeft className="size-3" />}
              {formatJson ? 'Raw' : 'Format'}
            </ActionPill>
          )}
          {showingCode && (
            <ActionPill
              title={wrapLines ? 'Disable soft wrap' : 'Soft-wrap long lines'}
              onClick={() => setWrapLines((v) => !v)}
              active={wrapLines}
            >
              <WrapText className="size-3" />
              Wrap
            </ActionPill>
          )}
          <CopyContentButton text={codeContent} />
        </WorkbenchToolbarSection>
      </WorkbenchToolbar>
      <div ref={bodyRef} className="min-h-0 flex-1 overflow-auto scrollbar-thin">
        {markdown && !showSource ? (
          <div className="px-4 py-4 text-sm text-foreground">
            <MarkdownRenderer>{content}</MarkdownRenderer>
          </div>
        ) : (
          <div ref={wrapperRef} className="code-line-numbers relative">
            <CodeBlock code={codeContent} language={languageFromPath(path)} bare wrap={wrapLines} />
            {highlight && (
              <div
                className="pointer-events-none absolute inset-x-0 border-l-2 border-foreground/45 bg-foreground/8 transition-opacity duration-(--dur-slow)"
                style={{ top: highlight.top, height: highlight.height }}
              />
            )}
          </div>
        )}
        {truncated && (
          <p className="px-4 py-2 text-xs text-text-faint">File truncated for display.</p>
        )}
      </div>
    </div>
  )
}
