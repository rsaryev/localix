/**
 * A list of rows separated by hairlines, closed top and bottom — a settings group, a detail
 * table, the rows of a stats section.
 *
 * Fourteen lists spelled this by hand across settings, secrets, the model picker and boards, at
 * three different alphas (25, 30, 35%), so two groups on one settings page could be ruled with
 * visibly different lines. It is the faint border step: the separators sit inside a group and
 * must stay quieter than the group's own outline.
 */
export const DIVIDED_LIST = 'divide-y divide-border-faint border-y border-border-faint'
