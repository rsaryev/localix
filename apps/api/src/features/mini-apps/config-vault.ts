import { optionVault } from '../ext/option-vault'

/**
 * Where a mini app's `secret` settings live: the vault, under `mini-app-option.<app>.…`, never in
 * its settings row. Its own prefix, so a plugin's options and a mini app's never share an item.
 */
export const miniAppOptions = optionVault('mini-app-option.')
