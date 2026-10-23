/**
 * What this mini app's UI can announce, and what its readers watch.
 *
 * One value both sides import, so a writer and a reader can never disagree about the name. The
 * protocol, the key semantics and the reasoning are in `mini-app-sdk/ui/resource-topics`.
 */
import { resourceTopic } from '@localixai/mini-app-sdk/ui/resource-topics'

/**
 * A session's courses and how far through each one it is.
 *
 * Keyed by SESSION — a course is stored and resolved inside the chat that owns it — so a write
 * invalidates that session alone and another chat's list is left where it was.
 */
export const LEARNING_COURSES = resourceTopic('learning:courses')
