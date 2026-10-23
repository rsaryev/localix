/**
 * The mini app's work-item kinds, in one place.
 *
 * Every host registration must be namespaced by its owner — `assertMiniAppOwnedIdentity` throws
 * otherwise, and because `registerUi` latches its guard before registering, one bare id costs the
 * mini app its entire UI. The rail viewlet, the anchor target and the breadcrumb button all have to
 * name the SAME string, and they live in three files, so the string lives here rather than in the
 * one that happened to declare it first.
 */
export const GIT_WORKSPACE_KIND = 'git-workspace:workspace'
