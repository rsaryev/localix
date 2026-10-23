/**
 * The app's one way to report a problem: {@link ProblemLine} on the surface, the full report in the
 * Event Center, which already renders bodies, actions and traces. Anything that needs a second
 * shape should change this one — a local variant is the fragmentation this folder exists to end.
 */

export { ProblemLine, type ProblemLineProps } from './ProblemLine'
export { ProblemState, type ProblemStateProps } from './ProblemState'
// One implementation for core and plugins alike: the hook needs only React and the bound toast, so
// it lives in the SDK and the app reads it from there rather than keeping a second copy.
export {
  useProblemReport,
  type OwnedProblemReport,
} from '@localixai/mini-app-sdk/ui/use-problem-report'
export { PROBLEM_SEVERITY, type SeverityPresentation } from './severity'
