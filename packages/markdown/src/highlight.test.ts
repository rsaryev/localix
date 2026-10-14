import { expect, test } from 'bun:test'
import { highlightCode } from './highlight'

test('shell aliases use Bash grammar for commands, variables, comments and quoted arguments', () => {
  const source = '# Install tools\nsudo apt-get update\necho "$HOME"\n'
  const bash = highlightCode(source, 'bash')
  expect(bash).toContain('hljs-built_in')
  expect(bash).toContain('hljs-comment')
  expect(bash).toContain('hljs-variable')
  expect(bash).toContain('hljs-string')
  for (const alias of ['sh', 'shell', 'zsh', 'BASH']) {
    expect(highlightCode(source, alias)).toBe(bash)
  }
})

test('explicit grammar preserves escaped source and does not detect languages in plain text', () => {
  const source = '<script>alert("code")</script> & exit'
  expect(highlightCode(source, 'text')).toBe(
    '&lt;script&gt;alert(&quot;code&quot;)&lt;/script&gt; &amp; exit',
  )
  expect(highlightCode(source, 'unknown')).toBe(highlightCode(source, 'text'))
  expect(highlightCode(source, 'bash')).not.toContain('<script>')
})

test('documentation fences use their declared grammar', () => {
  expect(highlightCode('export const count: number = 2', 'tsx')).toContain('hljs-keyword')
  expect(highlightCode('{"enabled": true}', 'json')).toContain('hljs-attr')
  expect(highlightCode('enabled: true', 'yaml')).toContain('hljs-attr')
  expect(highlightCode('<main>Preview</main>', 'html')).toContain('hljs-tag')
})
