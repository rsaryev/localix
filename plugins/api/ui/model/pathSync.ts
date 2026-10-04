import { PATH_PARAM_RE, type Pair } from '../../backend/request-spec'

/**
 * Make the Path rows a projection of the URL template.
 *
 * Names and ordering come from `/:name` placeholders. Existing values survive URL edits, duplicate
 * placeholders share one row, and stale rows disappear. The user edits only values in the grid;
 * the URL remains the single owner of parameter identity.
 */
export function syncPathParameters(url: string, current: readonly Pair[] = []): Pair[] {
  const previous = new Map(current.map((pair) => [pair.name, pair]))
  const names = [...new Set((url.match(PATH_PARAM_RE) ?? []).map((match) => match.slice(2)))]
  return names.map((name) => {
    const pair = previous.get(name)
    return pair ? { ...pair, name } : { name, value: '' }
  })
}
