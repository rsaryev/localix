/**
 * Context-fabric contracts now live in `@localixai/plugin-sdk/backend` so plugins
 * consume them from the SDK instead of deep-importing this host path. This file
 * re-exports them to keep the host's existing internal import path working.
 */
export type {
  AutomaticContextProvider,
  AutomaticContextRequest,
  ContextContribution,
  ContextDestination,
  ContextEstimate,
  ContextProviderContribution,
  ContextReference,
  ContextReferenceAttributes,
  ContextResolver,
  ContextScope,
  ContextSensitivity,
  ResolveContext,
} from '@localixai/plugin-sdk/backend'
