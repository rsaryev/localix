import { addEdge, cyclicEdges, importsOf, resolveSpec, type Rule } from './kit'

/** API feature rules: A4 (composition), A5 (Kysely in repositories), A6 (no cycles), A7 (HTTP errors). */

const FEATURES = 'apps/api/src/features/'
const featureOf = (file: string | null) =>
  file?.startsWith(FEATURES) ? file.slice(FEATURES.length).split('/')[0] : null
const CONSTRUCTOR = /^create\w*(?:Repository|Service)$/u

export const A4_COMPOSITION_ROOT: Rule = {
  id: 'A4',
  fix: 'take the dependency as a port in your deps and let apps/api/src/bootstrap/ construct it',
  detect(sources) {
    const found: string[] = []
    for (const source of sources) {
      const own = featureOf(source.file)
      if (!own) continue
      for (const ref of importsOf(source)) {
        if (ref.typeOnly) continue
        const other = featureOf(resolveSpec(source.file, ref.spec))
        if (!other || other === own) continue
        for (const name of ref.names) {
          if (CONSTRUCTOR.test(name) && new RegExp(`\\b${name}\\s*\\(`, 'u').test(source.code))
            found.push(`${source.file} calls ${name} (${other})`)
        }
      }
    }
    return found
  },
}

const KYSELY_HOME = [
  /(?:^|\/)[^/]*repositor(?:y|ies)[^/]*(?:\/|\.[jt]s$)/u,
  /^apps\/api\/src\/db\//u,
  /^apps\/api\/src\/bootstrap\//u,
  /^apps\/api\/migrations\//u,
]

export const A5_KYSELY_IN_REPOSITORIES: Rule = {
  id: 'A5',
  fix: 'move the query into a *repository* module of the owning feature and call it from there',
  detect(sources) {
    const found: string[] = []
    for (const source of sources) {
      if (!source.file.startsWith('apps/api/')) continue
      if (KYSELY_HOME.some((pattern) => pattern.test(source.file))) continue
      if (importsOf(source).some((ref) => /^kysely(?:\/|$)/u.test(ref.spec) && !ref.typeOnly))
        found.push(`${source.file} imports kysely`)
    }
    return found
  },
}

export const A6_FEATURE_CYCLES: Rule = {
  id: 'A6',
  fix: 'break the cycle: depend one way and invert the other through a port or a change-feed notice',
  detect(sources) {
    const graph = new Map<string, Set<string>>()
    for (const source of sources) {
      const own = featureOf(source.file)
      if (!own) continue
      for (const ref of importsOf(source)) {
        if (ref.typeOnly) continue
        const other = featureOf(resolveSpec(source.file, ref.spec))
        if (other) addEdge(graph, own, other)
      }
    }
    return cyclicEdges(graph).map((edge) => `feature cycle ${edge}`)
  },
}

const ROUTE_MODULE = /(?:^|[/._-])routes?(?:[/._-]|$)/u

export const A7_HTTP_ERRORS_IN_ROUTES: Rule = {
  id: 'A7',
  fix: 'throw a domain error from the service and map it to an ApiError in the route module',
  detect(sources) {
    const found: string[] = []
    for (const source of sources) {
      if (!source.file.startsWith('apps/api/src/')) continue
      const name = source.file.slice(source.file.lastIndexOf('/', source.file.length) + 1)
      if (ROUTE_MODULE.test(name) || /\/routes\//u.test(source.file)) continue
      if (/\bnew\s+ApiError\s*\(/u.test(source.code)) found.push(`${source.file} creates ApiError`)
    }
    return found
  },
}
