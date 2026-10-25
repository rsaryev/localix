import type { AvailabilityReader } from '../capabilities/availability'
import type { SkillsCuratorService } from './service'
import type { StoredSkill } from './store-listing'

export interface SkillWrite {
  name: string
  description: string
  content: string
  projectId: string | null
}

/** What the provider asks of the skill files: the chat service's SKILL.md operations. */
export interface SkillFiles {
  /** Every skill the files give: a project's, and the person's. */
  list(userId: string, projectId: string | null): Promise<{ skills: StoredSkill[] }>
  get(userId: string, name: string, projectId: string | null): Promise<StoredSkill>
  create(userId: string, input: SkillWrite): Promise<unknown>
  update(userId: string, id: string, input: SkillWrite): Promise<unknown>
  remove(userId: string, name: string, projectId: string | null): Promise<unknown>
}

export interface SkillStoreDeps {
  skills: SkillFiles
  /** Archive, restore and pin: the lifecycle the curator owns. */
  curator: Pick<
    SkillsCuratorService,
    'listSkills' | 'archive' | 'archiveUnused' | 'restore' | 'setPinned'
  >
  /** Whether each skill may run: a rule, shared with the Capabilities screen. */
  availability: {
    reader(userId: string): Promise<AvailabilityReader>
    set(userId: string, switches: Array<{ name: string; enabled: boolean }>): Promise<void>
  }
  /** The clock, for how long a skill has been idle. */
  now?: () => Date
  /**
   * Hear a change made outside the Store (a switch from the Capabilities screen, a file written by
   * a tool); returns the unsubscribe. The Store's own writes are announced here too.
   */
  onChange(listener: () => void): () => void
}
