import { hasHighlightGrammar } from './highlightCode'

/** Auto-coloring prose as JavaScript hides the difference between logs and source.
 * Require valid structured data, a supported fence, or a distinctive source construct.
 * Detection is bounded before parsing, independently of the transcript's display limit. */
export function detectCodeLanguage(text: string): string | undefined {
  if (text.length > 32_000) return undefined
  const source = text.trim()
  if (!source) return undefined

  const fence = source.match(/^```([\w+-]+)[^\S\n]*\n[\s\S]*\n```$/u)
  if (fence) return hasHighlightGrammar(fence[1]!) ? fence[1]!.toLowerCase() : undefined

  const isJson = (value: string) => {
    if (!/^[{[]/u.test(value)) return false
    try {
      JSON.parse(value)
      return true
    } catch {
      return false
    }
  }
  if (isJson(source)) return 'json'
  const lines = source.split('\n').filter((line) => line.trim())
  if (lines.length > 1 && lines.every((line) => isJson(line.trim()))) return 'json'

  const signatures: Array<[string, RegExp]> = [
    [
      'sql',
      /^(?:SELECT\b[\s\S]+\bFROM\s+[\w"`[]|(?:CREATE|ALTER)\s+TABLE\b|INSERT\s+INTO\b|UPDATE\s+\w+\s+SET\b|DELETE\s+FROM\b)/iu,
    ],
    ['python', /^(?:async\s+)?def\s+\w+\([^\n]*\)\s*(?:->[^\n]+)?\s*:/mu],
    ['rust', /^(?:pub\s+)?(?:async\s+)?fn\s+\w+\([^\n]*\)[^{]*\{/mu],
    ['go', /^func\s+(?:\([^\n]+\)\s+)?\w+\([^\n]*\)[^{]*\{/mu],
    ['java', /^(?:public\s+)?(?:final\s+)?class\s+\w+(?:\s+extends\s+\w+)?\s*\{/mu],
    ['cpp', /^\s*#include\s*[<"][\w/.]+[>"]/mu],
    [
      'typescript',
      /^(?:(?:export\s+)?(?:interface|type)\s+\w+(?:\s*=|\s*\{)|(?:const|let)\s+\w+\s*:\s*\w+\s*=)/mu,
    ],
    [
      'javascript',
      /^(?:export\s+)?(?:(?:async\s+)?function\s+\w+\s*\(|(?:const|let|var)\s+\w+\s*=)/mu,
    ],
    ['css', /^[.#][\w-]+\s*\{\s*[\w-]+\s*:/mu],
  ]
  return signatures.find(([, signature]) => signature.test(source))?.[0]
}
