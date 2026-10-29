import { readdir, readFile } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspectReleaseFile } from '../build/release-policy.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const dist = resolve(root, 'dist')
let checked = 0
let javascriptFiles = 0
const failures = []

async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Release must not contain symlinks: ${relative(dist, path)}`)
    if (entry.isDirectory()) { await inspect(path); continue }
    const name = relative(dist, path).replaceAll('\\', '/')
    if (/\.m?js$/i.test(name)) javascriptFiles += 1
    const text = await readFile(path, 'utf8')
    failures.push(...inspectReleaseFile(name, text))
    checked += 1
  }
}

await inspect(dist)
if (!javascriptFiles) failures.push('dist/: expected at least one built JavaScript asset')
if (failures.length) throw new Error(`Release inspection failed:\n${failures.join('\n')}`)
console.log(`PASS release inspection: ${checked} files; no source maps, source files or readable answer-table sentinels`)
