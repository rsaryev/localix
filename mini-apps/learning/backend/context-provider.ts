import {
  createResourceContextProvider,
  type ContextProviderContribution,
} from '@localixai/mini-app-sdk/backend'

import type { LearningService } from './service'
import { createLearningResourceProvider } from './resource-provider'

export function createLearningContextProvider(
  service: LearningService,
): ContextProviderContribution {
  return createResourceContextProvider({
    id: 'learning:context',
    namespace: 'learning',
    kind: () => 'learning-material',
    revisionPrefix: 'learning-content',
    sensitivity: 'project',
    maxTokens: 8_000,
    expander: createLearningResourceProvider(service),
  })
}
