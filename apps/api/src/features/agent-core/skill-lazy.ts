import { readSkillMarkdownFileSync } from './skill-file'
import {
  makeSkill,
  parseMarkdownFrontmatter,
  type DiscoveredSkill,
  type SkillFrontmatter,
} from './skill-frontmatter'

/**
 * Keep discovery metadata-only after parsing. The prompt needs only each skill's name and
 * description, so retaining every body (up to 1 MiB each) on every turn wastes memory. A lazy,
 * memoized string accessor preserves the public shape while retaining full content only for
 * skills that are actually pinned, invoked, or read.
 */
export function makeLazySkill(
  fm: SkillFrontmatter,
  fallbackName: string,
  scope: 'project' | 'global',
  path: string,
  dir: string,
  readPath: string,
  transformContent?: (content: string) => string,
): DiscoveredSkill {
  const skill = makeSkill(fm, fallbackName, scope, path, dir)
  let loaded = false
  let content = ''
  Object.defineProperty(skill, 'content', {
    configurable: false,
    enumerable: true,
    get(): string {
      if (!loaded) {
        const body = parseMarkdownFrontmatter(readSkillMarkdownFileSync(readPath)).body
        content = transformContent ? transformContent(body) : body
        loaded = true
      }
      return content
    },
  })
  return skill
}
