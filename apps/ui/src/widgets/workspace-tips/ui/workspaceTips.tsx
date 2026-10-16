import type { ComponentType } from 'react'
import { ApprovalScene } from './scenes/ApprovalScene'
import { AppearanceAction, AppearanceScene } from './scenes/AppearanceScene'
import { KeymapAction, KeymapScene } from './scenes/KeymapScene'
import { MentionScene } from './scenes/MentionScene'
import { ModelAction, ModelScene } from './scenes/ModelScene'
import { PaletteScene } from './scenes/PaletteScene'
import { ProjectAction, ProjectScene } from './scenes/ProjectScene'
import { TeamScene } from './scenes/TeamScene'

/**
 * One slide: a looping miniature of a real surface and a two-tone sentence (the lead in full
 * ink, the rest faint). When the slide asks for a choice, the sentence ends in it: `rest`
 * then leads into `Action`, the current value, which opens the pick.
 */
export interface WorkspaceTip {
  id: string
  lead: string
  rest: string
  Scene: ComponentType
  Action?: ComponentType
}

/**
 * Ranked by what a new user hits: nothing sends without a model; what the agent may do
 * on its own and where it works come next; then how to point it at things, how to move
 * fast, what else it can do, and comfort last. Choices alternate with how-it-works
 * slides so the carousel never reads as a settings form. Every scene draws a surface
 * that exists today — no split groups, no rail theme button. Ids are stable: the
 * last-seen tip is remembered.
 */
export const WORKSPACE_TIPS: WorkspaceTip[] = [
  {
    id: 'model',
    lead: 'Connect a model.',
    rest: 'Sign in or paste an API key, then pick what new chats start on —',
    Scene: ModelScene,
    Action: ModelAction,
  },
  {
    id: 'approvals',
    lead: 'You approve what matters.',
    rest: 'Commands the rules ask about wait for you. The shield chip switches to Plan, Bypass or Autonomous.',
    Scene: ApprovalScene,
  },
  {
    id: 'project',
    lead: 'Open a project folder.',
    rest: 'The agent works inside it, with its files, terminal and Git —',
    Scene: ProjectScene,
    Action: ProjectAction,
  },
  {
    id: 'mentions',
    lead: 'Point at anything with @.',
    rest: 'Type @ to browse the project, narrow by name and link files, folders, sessions or terminals.',
    Scene: MentionScene,
  },
  {
    id: 'keymap',
    lead: 'Keep the keys you know.',
    rest: 'Every shortcut follows the keymap you pick —',
    Scene: KeymapScene,
    Action: KeymapAction,
  },
  {
    id: 'palette',
    lead: 'Every command, one search.',
    rest: 'Open the command palette and type — files, sessions and symbols sit one key away.',
    Scene: PaletteScene,
  },
  {
    id: 'team',
    lead: 'A team in one chat.',
    rest: 'Add agents to the conversation and hand one the turn with its @handle.',
    Scene: TeamScene,
  },
  {
    id: 'appearance',
    lead: 'Make it yours.',
    rest: 'Fonts and code style live in Preferences; one click sets the theme —',
    Scene: AppearanceScene,
    Action: AppearanceAction,
  },
]
