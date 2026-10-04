interface NativeSelection {
  agentId: string
  preferredProvider?: string
  preferredModel?: string
  preferredEffort?: string
  maxTurns?: number
  pinnedSkills?: readonly string[]
}

interface ExternalSelection extends Omit<NativeSelection, 'agentId'> {
  agentId?: string
  prompt: string
  tools?: readonly string[]
  disallowedTools?: readonly string[]
  memory?: 'user' | 'project' | 'local'
  color?: string
  isolation?: 'isolated'
  background?: boolean
  hooks?: unknown
}

interface SelectionPorts {
  projectId?: string | null
  cwd?: string | null
  resolveAgentById?: (
    agentId: string,
    scope: { projectId?: string; cwd: string | null },
  ) => NativeSelection | null | Promise<NativeSelection | null>
  resolveSubagentType?: (
    role: string,
    scope: { projectId?: string; cwd: string | null },
  ) => ExternalSelection | null | Promise<ExternalSelection | null>
}

/** Resolve an explicit identity for the session-fork compatibility API. */
export async function resolveDelegateSelection(
  ports: SelectionPorts,
  agentId: string | undefined,
  roleName: string | undefined,
): Promise<ExternalSelection | null> {
  const scope = {
    ...(ports.projectId ? { projectId: ports.projectId } : {}),
    cwd: ports.cwd ?? null,
  }
  if (agentId) {
    const native = await ports.resolveAgentById?.(agentId, scope)
    return native ? { ...native, prompt: '' } : null
  }
  return roleName ? ((await ports.resolveSubagentType?.(roleName, scope)) ?? null) : null
}
