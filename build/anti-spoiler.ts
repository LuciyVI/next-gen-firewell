import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { normalizePath, transformWithEsbuild, type Plugin } from 'vite'
import JavaScriptObfuscator from 'javascript-obfuscator'
import { inspectReleaseFile } from './release-policy.mjs'

const sourceRoot = normalizePath(fileURLToPath(new URL('../src/', import.meta.url)))
const protectedModules = new Set(['scenarios.ts', 'session.ts', 'game.ts'])

/**
 * A reading obstacle for the public browser game, not an encryption boundary.
 * Transform only game data/rules before Rollup calculates content hashes;
 * dependencies and the interface retain normal Vite output and performance.
 */
export function antiSpoiler(): Plugin {
  return {
    name: 'packet-control-anti-spoiler',
    apply: 'build',
    enforce: 'post',
    async transform(source, id) {
      const path = normalizePath(id.split('?')[0])
      if (!path.startsWith(sourceRoot) || !protectedModules.has(path.slice(sourceRoot.length))) return null
      const javascript = await transformWithEsbuild(source, path, {
        loader: 'ts',
        target: 'es2022',
        sourcemap: false,
        legalComments: 'none',
      })
      // Reproducible builds; the seed is intentionally not a secret.
      const seed = createHash('sha256').update(path.slice(sourceRoot.length)).digest().readUInt32LE(0)
      const result = JavaScriptObfuscator.obfuscate(javascript.code, {
        target: 'browser-no-eval',
        compact: true,
        seed,
        sourceMap: false,
        stringArray: true,
        stringArrayThreshold: 1,
        stringArrayEncoding: ['base64'],
        stringArrayShuffle: true,
        stringArrayRotate: false,
        stringArrayIndexShift: true,
        stringArrayWrappersCount: 1,
        stringArrayWrappersType: 'function',
        transformObjectKeys: true,
        renameGlobals: false,
        renameProperties: false,
        identifierNamesGenerator: 'hexadecimal',
        controlFlowFlattening: false,
        deadCodeInjection: false,
        debugProtection: false,
        debugProtectionInterval: 0,
        disableConsoleOutput: false,
        selfDefending: false,
        numbersToExpressions: false,
        splitStrings: false,
        unicodeEscapeSequence: false,
      })
      return { code: result.getObfuscatedCode(), map: null }
    },
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        const contents = output.type === 'chunk'
          ? output.code
          : typeof output.source === 'string'
            ? output.source
            : new TextDecoder().decode(output.source)
        const failures = inspectReleaseFile(output.fileName, contents)
        if (failures.length) this.error(`Release inspection failed:\n${failures.join('\n')}`)
      }
    },
  }
}
