/** Development ports. One module so the launcher, its checks and its log lines agree. */

/** The port `apps/ui`'s dev script passes to Vite. */
export const DEFAULT_DEV_UI_PORT = 5050
/** The port the development API prefers; the runtime picks another when it is taken. */
export const DEFAULT_DEV_API_PORT = 5051

export const devUiPort = (env = process.env) =>
  Number(env.LOCALIX_DEV_UI_PORT || DEFAULT_DEV_UI_PORT)

export const devApiPort = (env = process.env) =>
  Number(env.LOCALIX_DEV_API_PORT || DEFAULT_DEV_API_PORT)
