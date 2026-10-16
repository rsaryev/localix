/**
 * cURL's flag vocabulary — split from the importer so the lists are readable as data.
 *
 * The distinction that matters is between flags we READ and flags we merely CONSUME. A flag like
 * `-o out.json` takes a value we don't import; if the parser skips the flag but not its value,
 * `out.json` is left over and later mistaken for the request URL. That failure is silent (you get
 * a request to a plausible-looking wrong url), so the ignored-but-valued list is a correctness
 * requirement, not politeness.
 */

/** Flags we read. Everything else is skipped (and its value consumed, if it has one). */
export const SUPPORTED_FLAGS: readonly string[] = [
  'url',
  'u',
  'user',
  'header',
  'H',
  'cookie',
  'b',
  'get',
  'G',
  'd',
  'data',
  'data-raw',
  'data-urlencode',
  'data-binary',
  'data-ascii',
  'form',
  'F',
  'request',
  'X',
  'compressed',
  'oauth2-bearer',
  'location',
  'L',
  'head',
  'I',
]

/**
 * Flags that take a value we do NOT import. Their value must still be consumed.
 *
 * `--oauth2-bearer` was here, which silently DROPPED a credential: curl sends it as
 * `Authorization: Bearer <token>`, so it is a bearer token by another spelling and belongs in
 * SUPPORTED_FLAGS. Consuming a value is right for `-o out.json`; it is not right for a secret.
 */
export const IGNORED_VALUE_FLAGS: readonly string[] = [
  'o',
  'output',
  'A',
  'user-agent',
  'e',
  'referer',
  'x',
  'proxy',
  'U',
  'proxy-user',
  'm',
  'max-time',
  'connect-timeout',
  'retry',
  'max-redirs',
  'limit-rate',
  'cacert',
  'capath',
  'E',
  'cert',
  'cert-type',
  'key',
  'key-type',
  'T',
  'upload-file',
  'w',
  'write-out',
  'D',
  'dump-header',
  'r',
  'range',
  'C',
  'continue-at',
  'c',
  'cookie-jar',
  'K',
  'config',
  'resolve',
  'connect-to',
  'interface',
]

/** Flags that are booleans — they never swallow the following token as a value. */
export const BOOLEAN_FLAGS: readonly string[] = [
  'compressed',
  'G',
  'get',
  'L',
  'location',
  'I',
  'head',
  'k',
  'insecure',
  's',
  'silent',
  'v',
  'verbose',
  'i',
  'include',
  'f',
  'fail',
]

/** The `-d`/`--data*` family, in the order the importer resolves them. */
export const DATA_FLAGS: readonly string[] = [
  'd',
  'data',
  'data-raw',
  'data-binary',
  'data-ascii',
  'data-urlencode',
]
