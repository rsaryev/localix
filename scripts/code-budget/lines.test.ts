import { describe, expect, test } from 'bun:test'
import { codeLines } from './lines.mjs'

describe('TypeScript and JavaScript', () => {
  test('comment-only and blank lines are not code; a line with code and a comment is', () => {
    const source = `// a line comment
/**
 * A doc comment over
 * several lines.
 */
export const limit = 3 // trailing

/* one block */ const after = 1
`
    expect(codeLines(source, 'a.ts')).toBe(2)
  })

  test('slashes inside strings, templates and URLs are code, not comments', () => {
    const source = `const url = 'https://localix.ai/docs'
const note = \`
// not a comment: inside a template
/* nor this */
\`
const pattern = /\\/\\/+/u
`
    expect(codeLines(source, 'b.ts')).toBe(6)
  })

  test('a JSX comment on its own line is not code', () => {
    const source = `export function A() {
  return (
    <div>
      {/* a JSX comment */}
      <span>text // in JSX text</span>
    </div>
  )
}
`
    expect(codeLines(source, 'A.tsx')).toBe(7)
  })

  test('a module that does not parse is reported, not guessed', () => {
    expect(() => codeLines('const = = 1\n', 'broken.ts')).toThrow('broken.ts')
  })
})

describe('Rust', () => {
  test('line, doc and nested block comments are not code; strings and lifetimes are', () => {
    const source = `//! Crate docs.
/// Item docs.
fn main<'a>(name: &'a str) {
    /* outer /* nested */ still a comment */
    let url = "https://localix.ai"; // trailing
    let raw = r#"// not a comment "quoted""#;
    let quote = '"';
}
`
    expect(codeLines(source, 'main.rs')).toBe(5)
  })
})

describe('CSS', () => {
  test('block comments are not code; `//` is ordinary text in CSS', () => {
    const source = `/* Tokens */
:root {
  /* the radius */
  --radius: 14px;
  background: url(//cdn.example/x.png);
}
`
    expect(codeLines(source, 'a.css')).toBe(4)
  })
})
