import { describe, expect, test } from 'bun:test'
import type { StoreActor } from '@localixai/store'

import { ConflictError, NotFoundError } from '../../lib/domain-errors'
import { createSkillStoreProvider, type SkillStoreDeps, type StoredSkill } from './store-provider'

const actor: StoreActor = { userId: 'u1' }
const inProject: StoreActor & { projectId: string } = { userId: 'u1', projectId: 'p1' }

const NOW = new Date('2026-06-11T12:00:00.000Z')
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString()

/** What the curator knows of a skill's idleness: set on the entry to make it stale or nearly. */
interface Idle {
  /** Last use; absent when never used. */
  lastUsedAt?: string
  idleSince: string
  staleAt: string
  archiveOn: string | null
}

type Entry = StoredSkill & { archived?: boolean; pinned?: boolean; idle?: Idle }

const skill = (name: string, scope: 'global' | 'project', extra: Partial<Entry> = {}): Entry => ({
  name,
  description: `About ${name}`,
  content: `Body of ${name}`,
  scope,
  path: `/home/.claude/skills/${name}/SKILL.md`,
  ...extra,
})

/** The provider over skills kept in memory: a home, a project's folder and the rules. */
function setup(seed: Entry[] = []) {
  const entries = [...seed]
  const off = new Set<string>()
  const calls: string[] = []
  const outside = new Set<() => void>()
  const inScope = (projectId: string | null) => (e: Entry) =>
    e.scope === (projectId ? 'project' : 'global')
  const deps: SkillStoreDeps = {
    skills: {
      list: async () => ({
        skills: entries.filter((e) => !e.archived),
      }),
      get: async (_user, name, projectId) => {
        const found = entries.find((e) => e.name === name && !e.archived && inScope(projectId)(e))
        if (!found) throw new NotFoundError('skill_not_found', `Skill "${name}" not found`)
        return found
      },
      create: async (_user, input) => {
        calls.push(`create ${input.name}`)
        entries.push(skill(input.name, input.projectId ? 'project' : 'global', input))
      },
      update: async (_user, _id, input) => {
        calls.push(`update ${input.name}`)
        const found = entries.find((e) => e.name === input.name)!
        Object.assign(found, { description: input.description, content: input.content })
      },
      remove: async (_user, name) => {
        calls.push(`remove ${name}`)
        entries.splice(
          entries.findIndex((e) => e.name === name),
          1,
        )
      },
    },
    curator: {
      listSkills: async (_user, opts) =>
        entries
          .filter(inScope(opts?.projectId ?? null))
          .filter((e) => e.path?.includes('/.claude/skills/'))
          .map((e) => ({
            name: e.name,
            description: e.description,
            scope: e.scope,
            dir: `/home/.claude/skills/${e.name}`,
            getCount: 3,
            lastUsedAt: e.idle?.lastUsedAt ?? null,
            pinned: Boolean(e.pinned),
            archivedAt: e.archived ? '2026-01-01T00:00:00.000Z' : null,
            state: e.archived
              ? ('archived' as const)
              : e.idle && !e.pinned && Date.parse(e.idle.staleAt) < NOW.getTime()
                ? ('stale' as const)
                : ('active' as const),
            ...(e.archived || e.pinned || !e.idle
              ? {}
              : {
                  idleSince: e.idle.idleSince,
                  staleAt: e.idle.staleAt,
                  archiveOn: e.idle.archiveOn,
                }),
          })),
      archiveUnused: async (_user, input) => {
        const stale = entries.filter(
          (e) => input.names.includes(e.name) && !e.pinned && !e.archived && e.idle,
        )
        calls.push(`archive-unused ${stale.map((e) => e.name).join(',')}`)
        for (const e of stale) e.archived = true
        return stale.map((e) => ({ name: e.name })) as never
      },
      archive: async (_user, input) => {
        calls.push(`archive ${input.name}`)
        entries.find((e) => e.name === input.name)!.archived = true
        return {} as never
      },
      restore: async (_user, input) => {
        calls.push(`restore ${input.name}`)
        entries.find((e) => e.name === input.name)!.archived = false
        return {} as never
      },
      setPinned: async (_user, input) => {
        calls.push(`${input.pinned ? 'pin' : 'unpin'} ${input.name}`)
        entries.find((e) => e.name === input.name)!.pinned = input.pinned
        return {} as never
      },
    },
    availability: {
      reader: async () => ({ effectFor: (_kind, name) => (off.has(name) ? 'deny' : 'allow') }),
      set: async (_user, changes) => {
        for (const change of changes) {
          if (change.enabled) off.delete(change.name)
          else off.add(change.name)
        }
      },
    },
    now: () => NOW,
    onChange: (listener) => {
      outside.add(listener)
      return () => outside.delete(listener)
    },
  }
  const changeOutside = () => outside.forEach((listener) => listener())
  return { provider: createSkillStoreProvider(deps), entries, off, calls, changeOutside }
}

describe('the skill Store provider', () => {
  test('a skill switched or saved outside the Store tells its subscribers, until they unsubscribe', () => {
    const { provider, changeOutside } = setup([skill('review', 'global')])
    let heard = 0
    const stop = provider.subscribe(() => heard++)
    changeOutside()
    stop()
    changeOutside()
    expect(heard).toBe(1)
  })

  test('a skill the person wrote is on Yours with its switch, and one in a project is not', async () => {
    const { provider, off } = setup([skill('review', 'global'), skill('deploy', 'project')])
    off.add('review')

    const { listings } = await provider.listings(actor)

    expect(listings.map((l) => l.ref.id)).toEqual(['user:review'])
    expect(listings[0]).toMatchObject({
      ref: { kind: 'skill', id: 'user:review' },
      authored: 'user',
      configurable: true,
      summary: 'About review',
      installs: [{ scope: 'user', enabled: false }],
    })
  })

  test('the Project shelf lists the project’s own skills and nothing of the person’s', async () => {
    const { provider } = setup([skill('review', 'global'), skill('deploy', 'project')])

    const listed = await provider.projectListings!(inProject)

    expect(listed.map((l) => l.ref.id)).toEqual(['project:deploy'])
    expect(listed[0]).toMatchObject({ authored: 'project', installs: [{ scope: 'project' }] })
  })

  test('a skill outside the folders Localix manages is listed and cannot be changed here', async () => {
    // Discovered by the files, unknown to the curator: the portable `.agents/skills` folder.
    const found = skill('from-claude', 'global', {
      path: '/home/.agents/skills/from-claude/SKILL.md',
    })
    const { provider } = setup([skill('mine', 'global'), found])

    const { listings } = await provider.listings(actor)

    expect(listings.find((l) => l.ref.id === 'user:mine')!.configurable).toBe(true)
    expect(listings.find((l) => l.ref.id === 'user:from-claude')!.configurable).toBeUndefined()
    expect(await provider.config!('user:from-claude', 'user', actor)).toBeNull()
    await expect(provider.remove('user:from-claude', 'user', actor)).rejects.toThrow(/folder/u)
  })

  test('its page reads the skill and says how much it was used', async () => {
    const { provider } = setup([skill('review', 'global')])

    const detail = await provider.detail('user:review', actor)

    expect(detail.readme).toBe('Body of review')
    expect(detail.facts).toContainEqual({ label: 'Used', value: '3 times' })
    expect(detail.components).toEqual([{ kind: 'skill', name: 'review' }])
  })

  test('adding one writes it for the person, or for the open project', async () => {
    const { provider, calls, entries } = setup()
    const form = await provider.createFields!(inProject)
    expect(form.fields.map((f) => f.key)).toEqual(['name', 'description', 'content'])
    expect(form.fields.find((f) => f.key === 'content')).toMatchObject({ multiline: true })
    expect(form.scopes).toEqual(['user', 'project'])
    expect((await provider.createFields!(actor)).scopes).toEqual(['user'])

    const mine = await provider.create!(
      'user',
      { name: 'review', description: 'Review a diff', content: 'Read it.' },
      actor,
    )
    const shared = await provider.create!(
      'project',
      { name: 'deploy', description: 'Ship it', content: 'Run it.' },
      inProject,
    )

    expect(mine).toEqual({ kind: 'skill', id: 'user:review' })
    expect(shared).toEqual({ kind: 'skill', id: 'project:deploy' })
    expect(calls).toEqual(['create review', 'create deploy'])
    expect(entries.find((e) => e.name === 'deploy')!.scope).toBe('project')
  })

  test('a name that is taken is refused instead of overwriting the skill', async () => {
    const { provider, calls } = setup([skill('review', 'global')])

    await expect(
      provider.create!('user', { name: 'review', description: 'x', content: 'y' }, actor),
    ).rejects.toBeInstanceOf(ConflictError)
    expect(calls).toEqual([])
  })

  test('a name the folder cannot carry, or a skill with nothing in it, is refused', async () => {
    const { provider, calls } = setup()
    const make = (values: Record<string, string>) => provider.create!('user', values, actor)
    const full = { name: 'ok', description: 'x', content: 'y' }

    await expect(make({ ...full, name: 'has space' })).rejects.toMatchObject({
      code: 'skill_store_name',
    })
    await expect(make({ ...full, description: ' ' })).rejects.toMatchObject({
      code: 'skill_store_missing',
    })
    await expect(make({ ...full, content: '' })).rejects.toMatchObject({
      code: 'skill_store_missing',
    })
    expect(calls).toEqual([])
  })

  test('a project skill needs an open project', async () => {
    const { provider } = setup()

    await expect(
      provider.create!('project', { name: 'a', description: 'x', content: 'y' }, actor),
    ).rejects.toMatchObject({ code: 'skill_store_no_project' })
  })

  test('its settings are the description and the instructions, and saving rewrites the file', async () => {
    const { provider, calls, entries } = setup([skill('review', 'global')])

    const config = await provider.config!('user:review', 'user', actor)
    expect(config!.fields.map((f) => f.key)).toEqual(['description', 'content'])
    expect(config!.values).toEqual({ description: 'About review', content: 'Body of review' })

    await provider.setConfig!('user:review', 'user', { content: 'New body' }, actor)

    expect(calls).toEqual(['update review'])
    expect(entries[0]).toMatchObject({ description: 'About review', content: 'New body' })
  })

  test('pin, unpin and archive are actions on the skill, and an archived one offers restore', async () => {
    const { provider, calls } = setup([skill('review', 'global')])

    const before = await provider.config!('user:review', 'user', actor)
    expect(before!.actions!.map((a) => a.id)).toEqual(['pin', 'archive'])

    expect(await provider.runAction!('user:review', 'user', 'pin', actor)).toMatchObject({
      ok: true,
    })
    expect((await provider.config!('user:review', 'user', actor))!.actions![0]!.id).toBe('unpin')
    await provider.runAction!('user:review', 'user', 'archive', actor)

    const archived = await provider.config!('user:review', 'user', actor)
    expect(archived!.fields).toEqual([])
    expect(archived!.actions!.map((a) => a.id)).toEqual(['restore'])
    expect((await provider.listings(actor)).listings[0]).toMatchObject({
      tags: expect.arrayContaining(['archived']),
      installs: [{ scope: 'user', enabled: false }],
    })

    await provider.runAction!('user:review', 'user', 'restore', actor)
    expect(calls).toEqual(['pin review', 'archive review', 'restore review'])
  })

  test('removing deletes the skill, and an archived one is restored first', async () => {
    const { provider, calls } = setup([
      skill('review', 'global'),
      skill('old', 'global', { archived: true }),
    ])

    await provider.remove('user:review', 'user', actor)
    await expect(provider.remove('user:old', 'user', actor)).rejects.toThrow(/restore/u)

    expect(calls).toEqual(['remove review'])
  })

  test('a switch is a rule, and a missing skill is a not-found', async () => {
    const { provider, off } = setup([skill('review', 'global')])

    await provider.setEnabled!('user:review', 'user', false, actor)
    expect(off.has('review')).toBe(true)
    await expect(provider.detail('user:nope', actor)).rejects.toBeInstanceOf(NotFoundError)
  })

  describe('Archive unused', () => {
    const stale = (days: number, used = true): Idle => ({
      ...(used ? { lastUsedAt: daysAgo(days) } : {}),
      idleSince: daysAgo(days),
      staleAt: daysAgo(days - (used ? 90 : 30)),
      archiveOn: new Date(NOW.getTime() + 4 * 86_400_000).toISOString(),
    })
    const shelf = () =>
      setup([
        skill('long-idle', 'global', { idle: stale(100) }),
        skill('never-used', 'global', { idle: stale(45, false) }),
        skill('kept', 'global', { idle: stale(300), pinned: true }),
        skill('fresh', 'global', { idle: stale(10) }),
        skill('plain', 'global'),
        skill('deploy', 'project', { idle: stale(120) }),
      ])

    test('Yours and the Project shelf offer it, and a project shelf only with a project open', async () => {
      const { provider } = shelf()
      expect((await provider.shelfActions!('user', actor)).map((a) => a.id)).toEqual([
        'archive-unused',
      ])
      expect((await provider.shelfActions!('project', inProject)).map((a) => a.id)).toEqual([
        'archive-unused',
      ])
      expect(await provider.shelfActions!('project', actor)).toEqual([])
    })

    test('the preview lists exactly the stale skills nobody pinned, and why', async () => {
      const { provider, calls } = shelf()

      const plan = await provider.planShelfAction!('archive-unused', 'user', actor)

      expect(plan.items).toEqual([
        {
          ref: { kind: 'skill', id: 'user:long-idle' },
          name: 'long-idle',
          reason: 'Last used 100 days ago',
        },
        {
          ref: { kind: 'skill', id: 'user:never-used' },
          name: 'never-used',
          reason: 'Never used, 45 days old',
        },
      ])
      expect(calls).toEqual([])
    })

    test('the Project shelf previews the project’s skills, not the person’s', async () => {
      const { provider } = shelf()
      const plan = await provider.planShelfAction!('archive-unused', 'project', inProject)
      expect(plan.items.map((i) => i.ref.id)).toEqual(['project:deploy'])
    })

    test('confirming archives what was previewed and nothing else', async () => {
      const { provider, calls } = shelf()
      let heard = 0
      provider.subscribe(() => heard++)

      const result = await provider.runShelfAction!(
        'archive-unused',
        'user',
        ['user:long-idle', 'user:kept'],
        actor,
      )

      expect(calls).toEqual(['archive-unused long-idle'])
      expect(result).toMatchObject({ ok: true, message: 'Archived 1 skill' })
      expect(heard).toBe(1)
      const { listings } = await provider.listings(actor)
      expect(listings.find((l) => l.name === 'long-idle')?.tags).toContain('archived')
      expect(listings.find((l) => l.name === 'never-used')?.tags).not.toContain('archived')
    })

    test('an action it does not know is refused', async () => {
      const { provider } = shelf()
      await expect(provider.planShelfAction!('purge', 'user', actor)).rejects.toThrow(/purge/u)
    })
  })

  describe('a skill that is idle says so on its page', () => {
    const at = (idle: Idle) => setup([skill('review', 'global', { idle })])
    const fact = async (provider: ReturnType<typeof setup>['provider']) =>
      (await provider.detail('user:review', actor)).notice?.text

    test('a stale skill names its days and the scheduled pass that archives it', async () => {
      const { provider } = at({
        lastUsedAt: daysAgo(95),
        idleSince: daysAgo(95),
        staleAt: daysAgo(5),
        archiveOn: '2026-06-15T12:00:00.000Z',
      })
      expect(await fact(provider)).toBe(
        'Not used for 95 days. Archived on 15 Jun 2026 unless pinned.',
      )
    })

    test('one never used says never, and one about to go stale already warns', async () => {
      const { provider } = at({
        idleSince: daysAgo(25),
        staleAt: new Date(NOW.getTime() + 5 * 86_400_000).toISOString(),
        archiveOn: '2026-06-22T12:00:00.000Z',
      })
      expect(await fact(provider)).toBe(
        'Never used, made 25 days ago. Archived on 22 Jun 2026 unless pinned.',
      )
    })

    test('a skill used lately has no warning', async () => {
      const { provider } = at({
        lastUsedAt: daysAgo(10),
        idleSince: daysAgo(10),
        staleAt: new Date(NOW.getTime() + 80 * 86_400_000).toISOString(),
        archiveOn: '2026-09-03T12:00:00.000Z',
      })
      expect(await fact(provider)).toBeUndefined()
    })

    test('a project skill is never archived on its own: its page says where to archive it', async () => {
      const { provider } = setup([
        skill('deploy', 'project', {
          idle: {
            lastUsedAt: daysAgo(120),
            idleSince: daysAgo(120),
            staleAt: daysAgo(30),
            archiveOn: null,
          },
        }),
      ])
      const detail = await provider.detail('project:deploy', inProject)
      expect(detail.notice).toEqual({
        text: 'Not used for 120 days. Archive unused on the Project shelf would archive it unless pinned.',
        action: expect.objectContaining({ id: 'pin', label: 'Pin' }),
      })
    })

    test('a pinned skill has none', async () => {
      const { provider } = setup([
        skill('review', 'global', {
          pinned: true,
          idle: { idleSince: daysAgo(400), staleAt: daysAgo(370), archiveOn: null },
        }),
      ])
      expect(await fact(provider)).toBeUndefined()
    })
  })
})
