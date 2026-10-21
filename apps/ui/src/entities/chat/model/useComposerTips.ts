import type { ComposerTip } from '@/shared/api/tips'
import { useCapabilities } from '@/shared/contrib/capabilityCache'
import { useChatStore } from './store'
import { selectComposerProjectId } from '../ui/prompt-input/commandScope'

/**
 * THE tip pool for this composer — read, never written.
 *
 * Scope tips are composed on the server (`capabilities/tips.ts`) from one scope's own
 * catalogs: its plugins, its enabled tools, its skills, and the shared slash-command
 * catalog. The client holds no scope catalog and writes no scope advice, because a second author
 * here is exactly how a composer ends up advertising a plugin the workspace does not
 * have and describing a command the parser has since renamed. UI-only settings advice
 * can join this pool through `useInlineCompletionTip`, without changing the wire contract.
 *
 * It costs no request: the capability document for this scope is already fetched.
 */

const NO_TIPS: ComposerTip[] = []

export function useComposerTips(sessionId: string | null, enabled = true): ComposerTip[] {
  // The same scope the composer's command menus read, for the same reason: the tip
  // band must describe the project this composer sends into, not the one the
  // workbench happens to be showing.
  const projectId = useChatStore((state) => selectComposerProjectId(state, sessionId))
  const { snapshot } = useCapabilities(projectId ?? '', enabled)
  return snapshot?.tips ?? NO_TIPS
}
