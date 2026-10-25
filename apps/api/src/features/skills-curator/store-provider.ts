import { createChangeSignal } from '@localixai/store'
import type {
  ActionResult,
  CreateForm,
  ListingConfig,
  ListingRef,
  Scope,
  StoreActor,
  StoreProvider,
} from '@localixai/store'

import { ConflictError, InvalidRequestError, NotFoundError } from '../../lib/domain-errors'
import {
  ARCHIVE,
  RESTORE,
  SKILL_NAME,
  UNPIN,
  knownShelfAction,
  textOf,
} from './store-provider-actions'
import type { SkillStoreDeps } from './store-provider-types'
import { ARCHIVE_UNUSED, archiveUnusedPlan } from './store-idle'
import {
  BODY_FIELDS,
  NAME_FIELD,
  PIN,
  listingRef,
  refOf,
  skillDetail,
  skillListing,
  type SkillEntry,
  type SkillRef,
} from './store-listing'

export type { StoredSkill } from './store-listing'
export type { SkillFiles, SkillStoreDeps } from './store-provider-types'

/**
 * SKILLS AS A STORE PROVIDER (`docs/internals/store.md`, "Skills"). A skill is a `SKILL.md`: the
 * provider lists the person's on Yours and the open project's on its shelf, writes one from a
 * form, edits it on its page, and gives it the curator's archive, restore and pin as actions.
 * Plugins' skills follow their plugin; a skill a Claude Code folder holds is listed and
 * read-only. Commands are skills too (a `.claude/commands` file is discovered as one), so there
 * is no separate kind.
 */
export function createSkillStoreProvider(deps: SkillStoreDeps): StoreProvider {
  const { changed, subscribe } = createChangeSignal((listener) => deps.onChange(listener))

  const nowMs = () => (deps.now ?? (() => new Date()))().getTime()

  const enabledOf = async (userId: string) => {
    const reader = await deps.availability.reader(userId)
    return (name: string) => reader.effectFor('skill', name) !== 'deny'
  }

  const projectOf = (scope: Scope, actor: StoreActor): string => {
    if (scope === 'user') return ''
    if (!actor.projectId)
      throw new InvalidRequestError(
        'skill_store_no_project',
        'Open a project to add a skill for it',
      )
    return actor.projectId
  }

  const projectIdOf = (ref: SkillRef, actor: StoreActor) =>
    ref.scope === 'project' ? (actor.projectId ?? null) : null

  /** The skills of one shelf: the files' skills of that scope, and the archived ones. */
  async function entriesOf(userId: string, projectId: string): Promise<SkillEntry[]> {
    const scope: Scope = projectId ? 'project' : 'user'
    const [files, managed] = await Promise.all([
      deps.skills.list(userId, projectId || null),
      deps.curator.listSkills(userId, { projectId: projectId || null }),
    ])
    const record = new Map(managed.map((m) => [m.name, m]))
    const present = files.skills
      .filter((s) => s.scope === (projectId ? 'project' : 'global'))
      .map((skill) => ({ name: skill.name, scope, skill, managed: record.get(skill.name) ?? null }))
    const seen = new Set(present.map((e) => e.name))
    const archived = managed
      .filter((m) => m.state === 'archived' && !seen.has(m.name))
      .map((m) => ({ name: m.name, scope, skill: null, managed: m }))
    return [...present, ...archived]
  }

  async function find(id: string, actor: StoreActor) {
    const ref = refOf(id)
    const missing = () => new NotFoundError('skill_store_not_found', `No skill "${id}"`)
    if (!ref || (ref.scope === 'project' && !actor.projectId)) throw missing()
    const entries = await entriesOf(actor.userId, ref.scope === 'project' ? actor.projectId! : '')
    const entry = entries.find((e) => e.name === ref.name)
    if (!entry) throw missing()
    return { ref, entry }
  }

  /** A skill Localix keeps: the one the person can edit, archive and remove. */
  async function own(id: string, actor: StoreActor) {
    const found = await find(id, actor)
    if (!found.entry.managed)
      throw new InvalidRequestError(
        'skill_store_folder',
        `${found.ref.name} lives in a skills folder Localix does not manage: change it there`,
      )
    return found
  }

  async function shelf(userId: string, projectId: string) {
    const enabled = await enabledOf(userId)
    const entries = await entriesOf(userId, projectId)
    return entries.map((entry) => skillListing(entry, enabled(entry.name)))
  }

  return {
    kind: 'skill',

    async listings(actor) {
      return { listings: await shelf(actor.userId, ''), problems: [] }
    },

    projectListings: (actor) => shelf(actor.userId, actor.projectId),

    async detail(id, actor) {
      const { entry } = await find(id, actor)
      const enabled = await enabledOf(actor.userId)
      return skillDetail(skillListing(entry, enabled(entry.name)), entry, nowMs())
    },

    async remove(id, _scope, actor) {
      const { ref, entry } = await own(id, actor)
      if (!entry.skill)
        throw new InvalidRequestError(
          'skill_store_archived',
          `${ref.name} is archived: restore it before removing it`,
        )
      await deps.skills.remove(actor.userId, ref.name, projectIdOf(ref, actor))
      changed()
    },

    async setEnabled(id, _scope, enabled, actor) {
      const { entry } = await find(id, actor)
      await deps.availability.set(actor.userId, [{ name: entry.name, enabled }])
      changed()
    },

    async config(id, scope, actor): Promise<ListingConfig | null> {
      const { ref, entry } = await find(id, actor)
      if (!entry.managed || ref.scope !== scope) return null
      const base = { scope, scopes: [scope], set: [] }
      if (!entry.skill) return { ...base, fields: [], values: {}, actions: [RESTORE] }
      const full = await deps.skills.get(actor.userId, ref.name, projectIdOf(ref, actor))
      return {
        ...base,
        fields: BODY_FIELDS,
        values: { description: full.description, content: full.content },
        actions: [entry.managed.pinned ? UNPIN : PIN, ARCHIVE],
      }
    },

    async setConfig(id, _scope, values, actor) {
      const { ref, entry } = await own(id, actor)
      if (!entry.skill)
        throw new InvalidRequestError('skill_store_archived', 'Restore it to edit it')
      const projectId = projectIdOf(ref, actor)
      const full = await deps.skills.get(actor.userId, ref.name, projectId)
      await deps.skills.update(actor.userId, `file:${full.path ?? ref.name}`, {
        name: ref.name,
        description: textOf(values, 'description', full.description),
        content: textOf(values, 'content', full.content),
        projectId,
      })
      changed()
    },

    async createFields(actor): Promise<CreateForm> {
      return {
        fields: [NAME_FIELD, ...BODY_FIELDS],
        scopes: actor.projectId ? ['user', 'project'] : ['user'],
        noun: 'skill',
      }
    },

    async create(scope, values, actor): Promise<ListingRef> {
      const projectId = projectOf(scope, actor)
      const name = textOf(values, 'name').trim()
      if (!SKILL_NAME.test(name))
        throw new InvalidRequestError(
          'skill_store_name',
          'Name a skill with letters, numbers, dashes or underscores',
        )
      for (const key of ['description', 'content'])
        if (!textOf(values, key).trim())
          throw new InvalidRequestError('skill_store_missing', `A skill needs its ${key}`)
      if ((await entriesOf(actor.userId, projectId)).some((e) => e.name === name))
        throw new ConflictError('skill_name_conflict', `A skill named "${name}" already exists`)
      await deps.skills.create(actor.userId, {
        name,
        description: textOf(values, 'description'),
        content: textOf(values, 'content'),
        projectId: projectId || null,
      })
      changed()
      return listingRef({ scope, name })
    },

    async runAction(id, _scope, action, actor): Promise<ActionResult> {
      const { ref } = await own(id, actor)
      const at = { name: ref.name, projectId: projectIdOf(ref, actor) }
      const done = (message: string): ActionResult => {
        changed()
        return { ok: true, message }
      }
      if (action === 'pin' || action === 'unpin') {
        const scope = ref.scope === 'project' ? 'project' : 'global'
        await deps.curator.setPinned(actor.userId, { ...at, scope, pinned: action === 'pin' })
        return done(action === 'pin' ? 'Pinned' : 'Unpinned')
      }
      if (action === 'archive') {
        await deps.curator.archive(actor.userId, at)
        return done(`${ref.name} is archived`)
      }
      if (action === 'restore') {
        await deps.curator.restore(actor.userId, at)
        return done(`${ref.name} is back in use`)
      }
      throw new InvalidRequestError('skill_store_action', `A skill cannot "${action}"`)
    },

    async shelfActions(scope, actor) {
      return scope === 'project' && !actor.projectId ? [] : [ARCHIVE_UNUSED]
    },

    async planShelfAction(action, scope, actor) {
      knownShelfAction(action)
      const skills = await deps.curator.listSkills(actor.userId, {
        projectId: projectOf(scope, actor) || null,
      })
      return archiveUnusedPlan(skills, nowMs())
    },

    async runShelfAction(action, scope, ids, actor): Promise<ActionResult> {
      knownShelfAction(action)
      const names = ids.flatMap((id) => {
        const ref = refOf(id)
        return ref?.scope === scope ? [ref.name] : []
      })
      const archived = await deps.curator.archiveUnused(actor.userId, {
        names,
        projectId: projectOf(scope, actor) || null,
      })
      changed()
      return {
        ok: true,
        message:
          archived.length === 0
            ? 'Nothing was archived: those skills were used or pinned meanwhile'
            : `Archived ${archived.length} ${archived.length === 1 ? 'skill' : 'skills'}`,
      }
    },

    subscribe,
  }
}
