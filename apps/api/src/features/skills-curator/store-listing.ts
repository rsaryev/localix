import type { ConfigField, Listing, ListingDetail, ListingRef, Scope } from '@localixai/store'

import type { CuratorSkillRecord } from './contracts'

/**
 * A SKILL AS A LISTING (`docs/internals/store.md`, "Skills"). The id is built from the scope and
 * the name, which is what identifies a skill on disk and survives its being rewritten:
 *
 *   `user:<name>`      a skill of the person's, kept in their home
 *   `project:<name>`   a skill of a project, kept in its folder
 *
 * A plugin's skills are components of the plugin and are not listed here. A skill that a
 * Claude Code folder holds (`~/.claude/skills`, a command file) is listed and read-only.
 */

/** One skill as the files give it: what the person writes, and where it is. */
export interface StoredSkill {
  name: string
  description: string
  content: string
  scope: 'global' | 'project'
  path?: string | undefined
  validation?: { errors: string[]; warnings: string[] }
}

/** What one name is on a shelf: the file, and what the curator knows when it manages it. */
export interface SkillEntry {
  name: string
  scope: Scope
  /** Absent when it is archived: an archived skill is not discovered. */
  skill: StoredSkill | null
  managed: CuratorSkillRecord | null
}

export interface SkillRef {
  scope: Scope
  name: string
}

export function refOf(id: string): SkillRef | null {
  const [scope, ...rest] = id.split(':')
  const name = rest.join(':')
  return (scope === 'user' || scope === 'project') && name ? { scope, name } : null
}

export const idOf = (ref: SkillRef): string => `${ref.scope}:${ref.name}`
export const listingRef = (ref: SkillRef): ListingRef => ({ kind: 'skill', id: idOf(ref) })

/** Where an unmanaged skill is defined, as the page names it. */
function folderOf(path = ''): string {
  if (path.includes('/.claude/commands/')) return 'a Claude Code command file'
  if (path.includes('/.claude/skills/')) return 'a Claude Code skills folder'
  return 'a skills folder Localix does not manage'
}

const times = (count: number) => `${count} ${count === 1 ? 'time' : 'times'}`

export function skillListing(entry: SkillEntry, enabled: boolean): Listing {
  const project = entry.scope === 'project'
  const archived = entry.managed?.state === 'archived'
  const description = entry.skill?.description ?? entry.managed?.description ?? ''
  return {
    ref: listingRef(entry),
    name: entry.name,
    displayName: entry.name,
    summary: description || 'No description',
    tags: [...(archived ? ['archived'] : []), ...(entry.managed?.pinned ? ['pinned'] : [])],
    publisher: { name: 'You', verified: false },
    source: entry.managed
      ? {
          id: project ? 'skills:project' : 'skills:yours',
          label: project ? 'This project' : 'Your skills',
        }
      : { id: 'skills:folders', label: 'Skill folders' },
    contents: { skill: 1 },
    runsCode: false,
    featured: false,
    recommended: false,
    installs: [{ scope: entry.scope, enabled: enabled && !archived }],
    authored: project ? 'project' : 'user',
    ...(entry.managed ? { configurable: true } : {}),
  }
}

export function skillDetail(listing: Listing, entry: SkillEntry): ListingDetail {
  const used = entry.managed?.getCount ?? 0
  const kept = entry.scope === 'project' ? 'This project' : 'Your skills'
  const facts: [string, string | undefined][] = [
    ['Kept in', entry.managed ? kept : folderOf(entry.skill?.path ?? '')],
    ['Used', used > 0 ? times(used) : undefined],
    ['Problem', entry.skill?.validation?.errors[0]],
  ]
  return {
    ...listing,
    readme: entry.skill?.content || null,
    media: [],
    facts: facts.flatMap(([label, value]) => (value ? [{ label, value }] : [])),
    components: [{ kind: 'skill', name: entry.name }],
  }
}

export const NAME_FIELD: ConfigField = {
  key: 'name',
  label: 'Name',
  help: 'Lowercase letters, numbers and dashes. The agent and /name use it.',
  type: 'string',
  required: true,
  secret: false,
}

export const BODY_FIELDS: ConfigField[] = [
  {
    key: 'description',
    label: 'Description',
    help: 'When the agent should use this skill.',
    type: 'string',
    required: true,
    secret: false,
  },
  {
    key: 'content',
    label: 'Instructions',
    help: 'What to do, in Markdown.',
    type: 'string',
    required: true,
    secret: false,
    multiline: true,
  },
]
