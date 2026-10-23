import type { DbConnectionConfig } from '../../dbClient'
import { miniAppSecrets } from '@localixai/mini-app-sdk/ui/runtime'
import {
  deriveSecretKey,
  deriveSecretKeyFromHost,
  deriveSshSecretKey,
  deriveTlsSecretKey,
  extractUrlPassword,
  isSecretToken,
  secretToken,
} from '../../model/connectionSecret'

/**
 * Vault raw DB/SSH credentials before persistence. File-vs-network is recognized by the
 * public config shape, not a dialect list, so adding another file engine needs no change.
 */
export async function vaultSecrets(
  config: DbConnectionConfig,
  opts: {
    vaultPassword: boolean
    passwordInFields: boolean
    vaultSsh: boolean
    vaultTlsKey: boolean
  },
  writeSecret: (request: { key: string; value: string }) => Promise<unknown> = (request) =>
    miniAppSecrets.set(request),
): Promise<DbConnectionConfig> {
  let finalConfig = config
  if (opts.vaultPassword && !('file' in config)) {
    if (opts.passwordInFields && config.password && !isSecretToken(config.password)) {
      const key = deriveSecretKeyFromHost(config.host ?? '')
      await writeSecret({ key, value: config.password })
      finalConfig = { ...config, password: secretToken(key) }
    } else if (!opts.passwordInFields && config.url) {
      const password = extractUrlPassword(config.url)
      if (password && !isSecretToken(password.password)) {
        const key = deriveSecretKey(config.url)
        await writeSecret({ key, value: password.password })
        finalConfig = { ...config, url: password.toToken(key) }
      }
    }
  }
  if (
    opts.vaultTlsKey &&
    !('file' in finalConfig) &&
    finalConfig.ssl &&
    typeof finalConfig.ssl === 'object' &&
    finalConfig.ssl.key &&
    !isSecretToken(finalConfig.ssl.key)
  ) {
    let host = finalConfig.host ?? ''
    if (!host && finalConfig.url) {
      try {
        host = new URL(finalConfig.url).hostname
      } catch {
        // The fallback key remains schema-valid for a library-specific URL.
      }
    }
    const key = deriveTlsSecretKey(host)
    await writeSecret({ key, value: finalConfig.ssl.key })
    finalConfig = {
      ...finalConfig,
      ssl: { ...finalConfig.ssl, key: secretToken(key) },
    }
  }
  if (opts.vaultSsh && !('file' in finalConfig) && finalConfig.ssh) {
    const ssh = { ...finalConfig.ssh }
    if (ssh.password && !isSecretToken(ssh.password)) {
      const key = deriveSshSecretKey(ssh.host, 'pw')
      await writeSecret({ key, value: ssh.password })
      ssh.password = secretToken(key)
    }
    if (ssh.privateKey && !isSecretToken(ssh.privateKey)) {
      const key = deriveSshSecretKey(ssh.host, 'private-key')
      await writeSecret({ key, value: ssh.privateKey })
      ssh.privateKey = secretToken(key)
    }
    if (ssh.passphrase && !isSecretToken(ssh.passphrase)) {
      const key = deriveSshSecretKey(ssh.host, 'passphrase')
      await writeSecret({ key, value: ssh.passphrase })
      ssh.passphrase = secretToken(key)
    }
    finalConfig = { ...finalConfig, ssh }
  }
  return finalConfig
}
