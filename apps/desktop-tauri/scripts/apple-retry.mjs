// `stapler` looks the ticket up in Apple's CloudKit, and a hosted runner loses that connection now
// and then (`NSURLErrorDomain -1005`, exit 68): the ticket is there, the question was not
// answered. So a step that asks Apple is asked again, a few times, before the release fails.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Run `command` until it exits 0 or `attempts` are spent; the last exit code. */
export async function untilAppleAnswers(run, command, { attempts = 4, wait = sleep } = {}) {
  let code = await run(command)
  for (let attempt = 1; code !== 0 && attempt < attempts; attempt += 1) {
    console.error(`[tauri-release] ${command.slice(0, 3).join(' ')} exited ${code}; asking again`)
    await wait(30_000)
    code = await run(command)
  }
  return code
}
