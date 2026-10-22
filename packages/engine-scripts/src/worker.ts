/**
 * THE WORKER a VM runs in, off the host's thread: one script's run (`worker-run.ts`) or a
 * long-lived VM (`worker-vm.ts`), as the host's `workerData` says.
 *
 * Importing this module starts the worker. A bundled host bundles it from the package's `./worker`
 * export, the same build the host itself resolves, and passes the file as the sandbox's `workerUrl`.
 */
import { parentPort, workerData } from 'node:worker_threads'

import type { VmWorkerData, WorkerData } from './protocol'
import { reportCrash, startRun } from './worker-run'
import { startVm } from './worker-vm'

if (parentPort) {
  const data = workerData as WorkerData | VmWorkerData
  if (data.mode === 'vm') startVm(data)
  else startRun(data).catch(reportCrash)
}
