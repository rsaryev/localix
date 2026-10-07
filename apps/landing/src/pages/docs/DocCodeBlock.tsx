import { isValidElement, useRef, useState } from 'react'
import { Button } from '@localixai/kit/button'
import { childrenToText } from '@localixai/markdown/react'

const CODE_LANGUAGE_LABELS: Record<string, string> = {
  bash: 'Shell',
  sh: 'Shell',
  shell: 'Shell',
  zsh: 'Shell',
  css: 'CSS',
  html: 'HTML',
  js: 'JavaScript',
  json: 'JSON',
  jsonc: 'JSON with comments',
  markdown: 'Markdown',
  md: 'Markdown',
  sql: 'SQL',
  text: 'Plain text',
  ts: 'TypeScript',
  tsx: 'TSX',
}

export function DocCodeBlock({ children }: { children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const [copyAttempt, setCopyAttempt] = useState(0)
  const copyRequest = useRef(0)
  const text = childrenToText(children).replace(/\n$/, '')
  const childClassName = isValidElement(children)
    ? ((children.props as { className?: string }).className ?? '')
    : ''
  const language = childClassName.match(/language-([A-Za-z0-9_-]+)/)?.[1] ?? 'text'
  const languageLabel = CODE_LANGUAGE_LABELS[language] ?? language.toUpperCase()

  const copy = async () => {
    const request = ++copyRequest.current
    setCopied(false)
    setCopyFailed(false)
    try {
      await navigator.clipboard.writeText(text)
      if (request !== copyRequest.current) return
      setCopied(true)
    } catch {
      if (request !== copyRequest.current) return
      setCopyAttempt((attempt) => attempt + 1)
      setCopyFailed(true)
    }
  }

  return (
    <div className="docs-code-block">
      <div className="docs-code-toolbar">
        <span>{languageLabel}</span>
        <Button variant="ghost" size="xs" onClick={() => void copy()} aria-label="Copy code">
          {copied ? 'Copied' : copyFailed ? 'Retry copy' : 'Copy'}
        </Button>
      </div>
      <pre>{children}</pre>
      <span className="sr-only" aria-live="polite">
        {copied
          ? 'Code copied to clipboard.'
          : copyFailed
            ? `Could not copy code. Try again. Attempt ${copyAttempt}.`
            : ''}
      </span>
    </div>
  )
}
