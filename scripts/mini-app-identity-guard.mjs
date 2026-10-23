/**
 * Pure detector for the semantic mini app boundary. The repository check supplies
 * identities discovered from real mini app registrations; this module knows only
 * categories and matching rules, so its complete pipeline can be mutation-tested.
 */

export function regexAlternation(values) {
  const escaped = [...new Set(values)]
    .filter((value) => typeof value === 'string' && value.length > 0)
    .sort((left, right) => left.localeCompare(right))
    .map((value) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
  return escaped.length > 0 ? escaped.join('|') : '(?!)'
}

function exactIdentityReference(source, values, owners) {
  for (const value of new Set(values)) {
    const identity = regexAlternation([value])
    for (const owner of owners) {
      const pattern = new RegExp(
        `\\b${owner}\\b[^\\n]{0,100}(?:={1,3}|:|\\.includes\\()\\s*['"]${identity}['"]`,
        'iu',
      )
      if (pattern.test(source)) return value
    }
  }
  return undefined
}

export function createMiniAppIdentityGuard(catalog) {
  // A compound tool name (`mini_app_tool`) is never prose, so any mention counts. A one-word name
  // (`notes`) is also an ordinary word and enum value — only a tool-shaped reference
  // (`toolName: 'notes'`, `tool === 'notes'`) names the tool.
  const compoundTools = [...catalog.toolNames].filter((name) => /[_-]/u.test(name))
  const wordTools = [...catalog.toolNames].filter((name) => !/[_-]/u.test(name))
  const toolPattern = new RegExp(`\\b(?:${regexAlternation(compoundTools)})\\b`, 'u')
  const slashCommandPattern = new RegExp(
    `(["'\`])/(?:${regexAlternation(catalog.commandNames)})\\1`,
    'u',
  )
  const agentPattern = new RegExp(`\\b(?:${regexAlternation(catalog.agentNames)})\\b`, 'u')
  const backendPattern = new RegExp(`\\b(?:${regexAlternation(catalog.backendSubsystems)})\\b`, 'u')
  const uiPattern = new RegExp(`(['"])(?:${regexAlternation(catalog.uiContributionIds)})\\1`, 'u')
  const resourcePattern = new RegExp(
    `localix:\\/\\/resource\\/(?:${regexAlternation(catalog.resourceProviders)})(?:\\/|\\b)`,
    'u',
  )
  const contextProviderPattern = new RegExp(
    `\\b(?:${regexAlternation(catalog.contextProviders)})\\b`,
    'u',
  )
  const searchProviderPattern = new RegExp(
    `\\b(?:${regexAlternation(catalog.searchProviders)})\\b`,
    'u',
  )
  const routePattern = new RegExp(`(?:${regexAlternation(catalog.routeMounts)})(?:\\/|\\b)`, 'u')
  const websocketPattern = new RegExp(`\\b(?:${regexAlternation(catalog.wsCommands)})\\b`, 'u')
  const miniAppOwnedNamespacePattern = new RegExp(
    `["'\`](?:${regexAlternation(catalog.miniAppNames)}):`,
    'u',
  )

  const embeddedMiniAppIdentityPattern = new RegExp(
    `(?:mini-app|channel):(?:${regexAlternation(catalog.miniAppNames)})(?=[^A-Za-z0-9_-]|$)|` +
      `(?:mini-app-|[?&]id=)(?:${regexAlternation(catalog.miniAppNames)})(?=[^A-Za-z0-9_-]|$)|` +
      `mcp_(?:_plugin_)?(?:${regexAlternation(catalog.miniAppNames)})_`,
    'u',
  )

  function inspect(path, source) {
    const findings = []
    const concreteTool =
      source.match(toolPattern)?.[0] ??
      exactIdentityReference(source, wordTools, ['tool', 'toolName', 'toolId'])
    if (concreteTool) {
      findings.push(
        `${path}: production core names concrete mini app tool "${concreteTool}"; ` +
          'consume descriptor metadata or a generic SDK result contract instead',
      )
    }
    const concreteCommand = source.match(slashCommandPattern)?.[0]
    if (concreteCommand) {
      findings.push(
        `${path}: core names concrete mini app command "${concreteCommand}"; ` +
          'consume the command descriptor supplied by mini app discovery',
      )
    }
    const concreteAgent = source.match(agentPattern)?.[0]
    if (concreteAgent) {
      findings.push(
        `${path}: core names concrete mini app agent "${concreteAgent}"; ` +
          'consume the namespaced agent descriptor supplied by mini app discovery',
      )
    }

    const rawChecks = [
      [backendPattern, 'backend subsystem', 'compose BackendSubsystem descriptors generically'],
      [resourcePattern, 'resource namespace', 'treat provider URIs as opaque SDK values'],
      [
        contextProviderPattern,
        'provider',
        'consume provider descriptors and opaque provider IDs instead',
      ],
      [searchProviderPattern, 'search provider', 'consume registered SearchProvider metadata'],
      [
        routePattern,
        'route',
        'mount and consume mini app routes through generic registration metadata instead',
      ],
      [
        websocketPattern,
        'websocket command',
        'dispatch contributed streams through the generic registry',
      ],
    ]
    for (const [pattern, kind, remedy] of rawChecks) {
      const identity = source.match(pattern)?.[0]
      if (identity) {
        findings.push(
          `${path}: production core names concrete mini app ${String(kind)} ` +
            `"${identity}"; ${String(remedy)}`,
        )
      }
    }

    const contextualChecks = [
      [
        catalog.channelNames,
        ['channel', 'channelName', 'channelId'],
        'channel',
        'consume registered channel descriptors',
      ],
      [
        catalog.miniAppNames,
        ['miniApp', 'miniAppName', 'miniAppId'],
        'bundled mini app',
        'use manifest metadata and generic mini app lifecycle APIs',
      ],
    ]
    for (const [values, owners, kind, remedy] of contextualChecks) {
      const identity = exactIdentityReference(source, values, owners)
      if (identity) {
        findings.push(
          `${path}: production core branches on ${String(kind)} "${identity}"; ${String(remedy)}`,
        )
      }
    }

    const concreteUi = source.match(uiPattern)?.[0]
    if (concreteUi) {
      findings.push(
        `${path}: production core branches on mini app UI contribution "${concreteUi}"; ` +
          'consume MiniAppUiHost registry metadata',
      )
    }
    const concreteNamespace = source.match(miniAppOwnedNamespacePattern)?.[0]
    if (concreteNamespace) {
      findings.push(
        `${path}: production core names mini-app-owned namespace "${concreteNamespace.slice(1)}"; ` +
          'treat contributed identities as opaque registry values',
      )
    }
    const embeddedIdentity = source.match(embeddedMiniAppIdentityPattern)?.[0]
    if (embeddedIdentity) {
      findings.push(
        `${path}: core embeds bundled mini app identity "${embeddedIdentity}" in a protocol value; ` +
          'use a synthetic fixture or consume the opaque value from mini app metadata',
      )
    }
    return findings
  }

  return { inspect }
}

export function miniAppUiNamespaceProblems(contributions) {
  return contributions.flatMap(({ id, path, miniAppName }) =>
    id.startsWith(`${miniAppName}:`)
      ? []
      : [`${path}: mini app UI contribution "${id}" is not namespaced by owner "${miniAppName}:"`],
  )
}
