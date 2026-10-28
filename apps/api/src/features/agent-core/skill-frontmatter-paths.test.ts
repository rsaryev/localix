import { expect, it } from 'bun:test'

import { parseSkillFrontmatter } from './skill-frontmatter'

// skills.md: `paths` takes glob patterns, comma-separated; a brace glob keeps its own commas.
const skill = (paths: string) => `---\nname: ts\npaths: ${paths}\n---\nBody.\n`

it('a brace glob in `paths` is not split on the comma inside the braces', () => {
  expect(parseSkillFrontmatter(skill('src/**/*.{ts,tsx}')).activationPaths).toEqual([
    'src/**/*.{ts,tsx}',
  ])
  expect(parseSkillFrontmatter(skill('src/**/*.{ts,tsx}, docs/**/*.md')).activationPaths).toEqual([
    'src/**/*.{ts,tsx}',
    'docs/**/*.md',
  ])
})
