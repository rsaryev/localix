import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import cpp from 'highlight.js/lib/languages/cpp'
import css from 'highlight.js/lib/languages/css'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'

const languages = {
  bash,
  cpp,
  css,
  java,
  javascript,
  json,
  python,
  rust,
  sql,
  typescript,
  xml,
}

for (const [name, language] of Object.entries(languages)) hljs.registerLanguage(name, language)

const MAX_CODE_BLOCKS = 100
const MAX_CODE_CHARACTERS = 64_000

export function highlightReaderCode(root: HTMLElement): number {
  let highlighted = 0
  for (const code of Array.from(root.querySelectorAll<HTMLElement>('pre code')).slice(
    0,
    MAX_CODE_BLOCKS,
  )) {
    if ((code.textContent?.length ?? 0) > MAX_CODE_CHARACTERS) continue
    hljs.highlightElement(code)
    highlighted += 1
  }
  return highlighted
}
