import { useMemo } from 'react'
import { highlightScript } from '@/shared/ui/code-block/highlightCode'
import { FileCode2 } from 'lucide-react'
import { SUGAR_HIGH_THEME } from '@/shared/ui/code-block/sugarHighTheme'

const SNIPPET = `// Live preview — your editor, your font
function greet(name: string) {
  const items = [1, 2, 3].map((n) => n * 2);
  return \`Hello, \${name}! (\${items.length})\`;
}`

/**
 * A flat editor preview that renders a fixed, syntax-highlighted snippet in the
 * CURRENTLY-PICKED code font + size — so the typography choice is shown exactly
 * the way code will look in the real editor (sugar-high tokens + the same
 * `--sh-*` theme the file viewer uses), updating live as the user picks. Pure
 * presentation; `fontCss`/`fontSize` are applied inline so it previews a font
 * before it's committed to `--font-mono`.
 */
export function EditorFontPreview({ fontCss, fontSize }: { fontCss: string; fontSize: string }) {
  const html = useMemo(() => highlightScript(SNIPPET), [])
  const lineCount = SNIPPET.split('\n').length

  return (
    <div className="overflow-hidden border-y border-border-soft">
      <div className="flex items-center gap-1.5 border-b border-border-soft px-3 py-1.5">
        <FileCode2 className="size-3 text-text-faint" aria-hidden="true" />
        <span className="font-mono text-2xs text-text-faint">preview.ts</span>
      </div>
      <div className="flex min-w-0" style={{ fontSize }}>
        {/* Gutter — `lx-keep-mono` not needed: a div doesn't match the global code rule. */}
        <div
          className="select-none border-r border-border-soft px-3 py-3 text-right leading-relaxed text-text-faint"
          style={{ fontFamily: fontCss }}
        >
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        <pre
          className={[
            'min-w-0 flex-1 overflow-x-auto px-3.5 py-3 leading-relaxed',
            SUGAR_HIGH_THEME,
          ].join(' ')}
        >
          {/* Inline font wins over the global --font-mono rule, so the preview shows
              the BEING-PICKED font even before it's committed to --font-mono. */}
          <code style={{ fontFamily: fontCss }} dangerouslySetInnerHTML={{ __html: html }} />
        </pre>
      </div>
    </div>
  )
}
