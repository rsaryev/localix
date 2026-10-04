import type { Project } from '@/shared/api/contracts'
import { scopeAgentId } from '@/shared/api/capabilityScope'
import { CapabilityIntro } from './capabilities/CapabilityIntro'
import { ResearchSection } from './capabilities/ResearchSection'
import { ToolsRegistry } from './capabilities/ToolsRegistry'

interface ToolsSettingsProps {
  /** '' = sessions without a project, `agent:<handle>` an agent, otherwise a project id. */
  scope: string
  projects: Project[]
}

/**
 * Settings → Capabilities → Tools, for whichever scope the picker points at.
 *
 * The three scopes differ only in what the intro says. They compose rather than override:
 * the run takes the strictest verdict of the installation, the project and the agent, so
 * switching something off here can never be undone further in — which is why an agent
 * scope needs no separate screen and gets none.
 */
export function ToolsSettings({ scope, projects }: ToolsSettingsProps) {
  const agentId = scopeAgentId(scope)
  // A removed project falls back to the no-project scope, exactly as before.
  const project = (!agentId && scope && projects.find((p) => p.id === scope)) || null

  return (
    <div className="text-left">
      {/* The one line that earns its place on a capability tab: it changes with the scope
          switcher, so it answers "whose rules am I editing" rather than restating the tab's
          own name. The sentence about narrowing went with the rest of the prose — it is the
          same rule on all three scopes, and a rule stated on every screen is read on none. */}
      <CapabilityIntro>
        {agentId ? (
          <>
            What <strong>{agentId}</strong> may use, wherever it runs.
          </>
        ) : project ? (
          <>
            Rules for <strong>{project.name}</strong>, on top of the installation-wide ones.
          </>
        ) : (
          'Installation-wide rules, and the ones sessions without a project get.'
        )}
      </CapabilityIntro>

      {/* Every tool the scope knows about, with a switch — the same registry shape Skills,
          MCP and Plugins use. The ordered rule list that used to live here governs five kinds,
          not one, and is its own tab now. */}
      <ToolsRegistry key={scope} scope={scope} />

      {/* Research is a USER-level switch, not a scope's, so it appears once — in the scope
          that has no narrower owner to confuse it with. */}
      {!agentId && !project && <ResearchSection />}
    </div>
  )
}
