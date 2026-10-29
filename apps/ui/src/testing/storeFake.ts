import { hasUpdate, type PackageKind } from '@localixai/store'
import { makeListingDetail } from '@localixai/store/testing'
import { ApiError } from '@/shared/api/internal'
import type { StoreClient } from '@/shared/api/store-client'
import { SOURCES, answer, type StoreFake } from './storeFixtures'

/** A client over `fake`, recording each write as one line ("install mini-app/puzzle user …"). */
export function fakeClient(fake: StoreFake): StoreClient {
  const call = (line: string) => void fake.calls.push(line)
  const find = (id: string) => fake.listings.find((l) => l.ref.id === id)!
  const needsYes = (id: string) =>
    !find(id).publisher.verified || find(id).source.trust === 'community'
  const where = (projectId?: string | null) => (projectId ? ` in ${projectId}` : '')
  return {
    page: async (asked) => {
      const query = asked ?? {}
      if (fake.failing?.page) throw new ApiError('The index is unreachable', 503, 'unavailable')
      fake.reads?.push(
        Object.entries(query)
          .map(([key, value]) => `${key}=${value}`)
          .join(' '),
      )
      return { ...answer(fake.listings, query), problems: fake.problems ?? [] }
    },
    detail: async (ref) => {
      if (fake.failing?.detail) throw new ApiError('Could not read it', 503, 'unavailable')
      if (!fake.listings.some((l) => l.ref.id === ref.id))
        throw new ApiError(`"${ref.id}" not found`, 404, 'not_found')
      return makeListingDetail(find(ref.id), {
        facts: [
          { label: 'Version', value: find(ref.id).version ?? '1.0.0' },
          { label: 'License', value: 'MIT' },
          { label: 'Homepage', value: 'https://example.test/puzzle' },
        ],
        ...(fake.notices?.[ref.id] ? { notice: fake.notices[ref.id] } : {}),
        components: find(ref.id).components ?? [
          { kind: 'screen', name: find(ref.id).displayName, description: 'A screen of its own' },
          { kind: 'command', name: `/${ref.id}:play` },
        ],
      })
    },
    plan: async (ref, scope) => {
      if (fake.failing?.plan) throw new ApiError('Could not fetch it', 503, 'unavailable')
      return {
        scope,
        adds: [],
        runs: [{ kind: 'hook', name: 'PreToolUse', command: 'node check.js' }],
        network: ['api.example.test'],
        requires: [],
        warnings: needsYes(ref.id) ? ['Localix does not review what this source lists'] : [],
        needsConsent: needsYes(ref.id),
      }
    },
    install: async (ref, scope, consent, projectId) => {
      if (needsYes(ref.id) && !consent.plan)
        throw new ApiError('Read what it runs, then say yes', 409, 'consent')
      call(
        `install ${ref.kind}/${ref.id} ${scope}${consent.plan ? ' consent' : ''}${where(projectId)}`,
      )
    },
    update: async (ref, scope) => call(`update ${ref.kind}/${ref.id} ${scope}`),
    remove: async (ref, scope) => call(`remove ${ref.kind}/${ref.id} ${scope}`),
    setEnabled: async (ref, scope, enabled) =>
      call(`${enabled ? 'enable' : 'disable'} ${ref.kind}/${ref.id} ${scope}`),
    config: async (ref, scope) => {
      const config = fake.configs?.[ref.id]?.[scope]
      if (!config) throw new ApiError('No settings', 404, 'store_config_not_found')
      return config
    },
    setConfig: async (ref, scope, values, projectId) => {
      if (fake.configFails) throw new ApiError(fake.configFails, 400, 'plugin_config_invalid')
      call(`config ${ref.kind}/${ref.id} ${scope}${where(projectId)} ${JSON.stringify(values)}`)
    },
    runAction: async (ref, scope, action) => {
      call(`action ${ref.kind}/${ref.id} ${scope} ${action}`)
      return fake.actionResults?.[action] ?? { ok: true }
    },
    creatable: async () => Object.keys(fake.creates ?? {}) as PackageKind[],
    createFields: async (kind) => fake.creates![kind]!,
    create: async (kind, scope, values, projectId) => {
      if (fake.createFails) throw new ApiError(fake.createFails, 409, 'store_exists')
      call(`create ${kind} ${scope}${where(projectId)} ${JSON.stringify(values)}`)
      return { kind, id: (values.name as string | undefined) ?? 'new' }
    },
    shelfActions: async (scope) => fake.shelfActions?.[scope] ?? [],
    planShelfAction: async (kind, action, scope) =>
      fake.shelfPlans?.[`${kind}/${action}/${scope}`] ?? { summary: '', items: [] },
    runShelfAction: async (kind, action, scope, ids, projectId) => {
      call(`shelf-run ${kind} ${action} ${scope} ${ids.join(',')}${where(projectId)}`)
      return { ok: true, message: 'Done' }
    },
    sources: async () => ({ sources: fake.sources ?? SOURCES, addable: ['mini-app', 'plugin'] }),
    reportWorkingSet: async (request) => {
      fake.recommendAsked?.push(
        `${request.references.map((reference) => reference.label).join(',')}${where(request.sessionId)}`,
      )
    },
    recommendations: async () => {
      if (fake.recommendPending)
        return { listings: [], matched: 0, strategy: { mode: 'hybrid' }, pending: true }
      const listings = (fake.recommended ?? []).map(find)
      return { listings, matched: listings.length, strategy: { mode: 'hybrid' }, pending: false }
    },
    discover: async () => {
      if (fake.failing?.discover) throw new ApiError('Could not read it', 503, 'unavailable')
      return {
        updates: { count: fake.listings.filter(hasUpdate).length },
        rows: [],
        categories: [],
        listings: fake.listings,
        ...fake.discover,
      }
    },
    previewSource: async (kind, input) => {
      call(`preview ${kind} ${input}`)
      if (fake.previewFails) throw new Error(fake.previewFails)
      if (fake.understood && !fake.understood.includes(kind))
        throw new Error(`Not a ${kind} source`)
      return {
        kind,
        id: input,
        label: input,
        publishers: ['Ada'],
        count: 3,
        icons: [],
        verified: false,
        added: false,
      }
    },
    addSource: async (kind, input) => call(`add source ${kind} ${input}`),
    removeSource: async (kind, id) => call(`remove source ${kind} ${id}`),
    refreshSource: async (kind, id) => call(`refresh source ${kind} ${id}`),
    setSourceAutoUpdate: async (kind, id, on) => {
      if (fake.autoUpdateFails) throw new Error(fake.autoUpdateFails)
      call(`auto-update ${kind} ${id} ${on}`)
    },
    activity: async () => ({ jobs: [], updates: [] }),
    applyUpdates: async () => {
      call('update all')
      return []
    },
  }
}
