import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const entry = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs')
const env = { ...process.env }
if (process.allowedNodeEnvironmentFlags.has('--no-experimental-webstorage')) {
  env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ''} --no-experimental-webstorage`.trim()
}
const result = spawnSync(process.execPath, [entry, 'run', ...process.argv.slice(2)], { env, stdio: 'inherit' })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
