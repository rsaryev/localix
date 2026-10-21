/* eslint-disable react-refresh/only-export-components */
import { useMemo } from 'react'
import { useChatStore } from '@/entities/chat/model/store'
import { selectComposerProjectId } from './commandScope'
import type { SlashCommand } from './SlashCommandMenu'
import type { SkillSummary } from '@/shared/api/contracts'
import { useCapabilities } from '@/shared/contrib/capabilityCache'

const NO_SKILLS: SkillSummary[] = []

const SkillIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M8 1.5l1.8 3.7 4.1.6-3 2.9.7 4.1L8 11.4 4.4 12.8l.7-4.1-3-2.9 4.1-.6L8 1.5z"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
  </svg>
)

/**
 * Fetches the user's saved skills and exposes them as slash commands, appended
 * AFTER the built-ins so they never crowd out the core commands. Skills run the
 * agent with their stored template (with optional `$ARGUMENTS`).
 */
export function useSkillCommands(sessionId: string | null, enabled = true): SlashCommand[] {
  const projectId = useChatStore((state) => selectComposerProjectId(state, sessionId))
  // Skills ride in the scope's capability document as catalog summaries — exactly the
  // fields a command needs (name, description, argument hint, invocability). The body
  // is not here, and does not need to be: running a skill names it, it does not send it.
  const { snapshot } = useCapabilities(projectId ?? '', enabled)
  const skills = snapshot?.skills ?? NO_SKILLS

  return useMemo(
    () =>
      // CC `user-invocable: false` — hide from user menu; still model-invocable.
      skills.flatMap((skill) =>
        skill.userInvocable === false
          ? []
          : [
              {
                id: `skill:${skill.name}`,
                trigger: skill.name,
                title: skill.name,
                description: skill.description || 'Saved skill',
                icon: <SkillIcon />,
                kind: 'skill',
                skillName: skill.name,
                badge: 'apply',
                ...(skill.argumentHint ? { placeholder: skill.argumentHint } : {}),
              },
            ],
      ),
    [skills],
  )
}
