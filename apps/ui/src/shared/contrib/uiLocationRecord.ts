import type {
  UiAnchorOpenResult,
  UiLocationContribution,
  UiLocationDescriptor,
  UiLocationParamSchema,
  UiLocationPresentation,
} from '@localixai/plugin-sdk/ui'

type NormalizedArgs = Record<string, string | string[] | boolean | number>
export type ErasedLocation = Omit<UiLocationContribution, 'present' | 'resolve'> & {
  source: object
  present?(args: NormalizedArgs): UiLocationPresentation
  resolve(args: NormalizedArgs): UiAnchorOpenResult | null
}

export function uiLocationIconId(id: string): string {
  return `ui-location:${id}`
}

export const locationDescriptor = (entry: ErasedLocation): UiLocationDescriptor => ({
  id: entry.id,
  uri: entry.uri,
  title: entry.title,
  ...(entry.description ? { description: entry.description } : {}),
  keywords: [...(entry.keywords ?? [])],
  ...(entry.group ? { group: entry.group } : {}),
  ...(entry.Icon ? { icon: uiLocationIconId(entry.id) } : {}),
  effect: entry.effect,
  surface: entry.surface,
  ...(entry.agent ? { agent: { ...entry.agent } } : {}),
  params: Object.fromEntries(
    Object.entries(entry.params ?? {}).map(([key, definition]) => [
      key,
      definition.type === 'string' && definition.values
        ? { ...definition, values: [...definition.values] }
        : { ...definition },
    ]),
  ),
  exposure: { ...entry.exposure },
})

export function storeLocationContribution(
  contribution: UiLocationContribution<UiLocationParamSchema>,
  id: string,
  uri: string,
  schema: UiLocationParamSchema,
): ErasedLocation {
  const normalizedParams = Object.freeze(
    Object.fromEntries(
      Object.entries(schema).map(([key, definition]) => [
        key,
        Object.freeze(
          definition.type === 'string' && definition.values
            ? { ...definition, values: Object.freeze([...definition.values]) }
            : { ...definition },
        ),
      ]),
    ),
  )
  return Object.freeze({
    ...contribution,
    id,
    uri,
    title: contribution.title.trim(),
    keywords: contribution.keywords ? Object.freeze([...contribution.keywords]) : undefined,
    params: normalizedParams,
    exposure: Object.freeze({ ...contribution.exposure }),
    agent: contribution.agent ? Object.freeze({ ...contribution.agent }) : undefined,
    source: contribution,
  }) as unknown as ErasedLocation
}
