import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
// Choose an available port instead of interrupting another development server.
const reservation = createServer()
reservation.listen(0, '127.0.0.1')
await once(reservation, 'listening')
const port = reservation.address().port
await new Promise((done) => reservation.close(done))
const server = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
let serverLog = ''
server.stdout.on('data', chunk => { serverLog += chunk })
server.stderr.on('data', chunk => { serverLog += chunk })
let processError
server.on('error', error => { processError = error })
const serverExit = once(server, 'exit')
const baseURL = `http://127.0.0.1:${port}`

async function test(script, extraEnv = {}) {
  const child = spawn(process.execPath, ['--import', 'tsx', resolve(root, script)], { cwd: root, stdio: 'inherit', env: { ...process.env, ...extraEnv } })
  const [status, signal] = await once(child, 'exit')
  if (status !== 0) throw new Error(`${script} failed (${signal || status})`)
}

try {
  let ready = false
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (processError) throw processError
    if (server.exitCode !== null) throw new Error(`Preview failed: ${serverLog}`)
    try { if ((await fetch(baseURL, { signal: AbortSignal.timeout(500) })).ok) { ready = true; break } } catch { /* Wait for the server we started. */ }
    await delay(125)
  }
  if (!ready) throw new Error(`Preview startup timed out: ${serverLog}`)
  await test('tests/e2e.mjs', { E2E_BASE_URL: baseURL })
  await test('tests/standalone.mjs')
} finally {
  if (server.exitCode === null && server.signalCode === null) server.kill('SIGTERM')
  await serverExit
}
