/**
 * Where a plugin's `sensitive` userConfig values live (`ext/option-vault.ts`): the vault, not `capability_source.config`.
 *
 * Claude Code keeps a sensitive option in the platform's credential store and only the others in
 * `settings.json`. Localix wrote every option, secrets included, as JSON into the source row, so a
 * token sat in plain text in `localix.db` and its WAL. A sensitive value now goes to the vault
 * (encrypted, audited, shielded from transcripts), and the row keeps only a handle,
 * `secret:plugin-option.<plugin>.<scope>.<key>`, which says the option is set without saying what
 * it is.
 *
 * A module-level registration rather than a constructor argument, for the reason spelled out at
 * `observeMcpOAuthSecrets`: the catalog that hands config to a plugin is built at half a dozen
 * construction sites the composition root reaches separately (runs, channels, monitors,
 * backends, mods). Every one of them goes through `buildPluginCatalog`, which hydrates here, so
 * the seam is one. Unset (tests, scripts), options are stored as they always were.
 */
import { optionVault } from '../ext/option-vault'

const options = optionVault('plugin-option.')

export const {
  optionKey: pluginOptionKey,
  sealsSecrets,
  isSecretHandle,
  sealSecretOptions,
  hydrateSecretOptions,
  hydrateSecretOption,
  forgetSecretOptions,
} = options
