#!/usr/bin/env node
/** Repair this plugin's legacy relay source in a copy, then use official DSH migration. */
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import * as fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { pipeline } from 'node:stream/promises'
import { createZstdCompress, zstdCompressSync, constants } from 'node:zlib'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

export function normalizeRow(row) {
  if (row.type === 'subagent/descriptor' && row.data?.version === 2) {
    const data = row.data
    const fields = data.mode === 'one-shot' ? ['version','mode','provider','label']
      : ['version','mode','provider','label','agentProvider','agentModel','persona','toolFilter']
    const invalid = () => { throw new Error('invalid legacy descriptor; refusing conversion') }
    if (!['one-shot','continuable'].includes(data.mode) || Object.keys(data).some(k => !fields.includes(k))
        || typeof data.provider !== 'string') invalid()
    if (data.mode === 'continuable' && typeof data.label !== 'string') invalid()
    for (const key of ['label','agentProvider','agentModel','persona']) {
      if (Object.hasOwn(data,key) && typeof data[key] !== 'string') invalid()
    }
    if (Object.hasOwn(data,'toolFilter')) {
      const filter = data.toolFilter
      if (!filter || typeof filter !== 'object' || Array.isArray(filter)
          || !Object.keys(filter).length || Object.keys(filter).some(k => !['allow','deny'].includes(k))) invalid()
      for (const values of Object.values(filter)) if (!Array.isArray(values) || values.some(v => typeof v !== 'string')) invalid()
    }
    // Released descriptor v3 only adds OPTIONAL agentReasoningEffort to v2.
    // Leave it absent: keep the original route, persona and tool restrictions.
    row.data = { ...data, version: 3 }
    return 1
  }
  const messages = []
  if (row.type === 'user/message') messages.push(row.data)
  if (row.type === 'assistant/message' || row.type === 'tool/result') messages.push(row.data?.message)
  if (row.type === 'agent/inbox/spliced') messages.push(...(row.data?.inserted ?? []))
  if (row.type === 'session/title-llm-request') messages.push(...(row.data?.messages ?? []))
  let count = 0
  for (const message of messages) {
    const source = message?.source
    if (source?.kind !== 'session-relay') continue
    if (Object.keys(source).sort().join(',') !== 'form,kind,senderSessionId'
        || source.form !== 'relay' || typeof source.senderSessionId !== 'string'
        || source.senderSessionId.length === 0) throw new Error('invalid legacy relay; refusing conversion')
    message.source = { ...source, kind: 'agent-message' }
    count++
  }
  return count
}

async function digest(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function files(root) {
  const result = []
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`symlink refused: ${path}`)
    if (entry.isDirectory()) result.push(...await files(path))
    else if (entry.isFile()) result.push(path)
    else throw new Error(`non-regular artifact refused: ${path}`)
  }
  return result
}

async function sdk(packagePath) {
  const manifestPath = await fs.realpath(resolve(packagePath))
  const req = createRequire(manifestPath)
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  if (manifest.name !== '@deepseek-ai/dsh' || manifest.version !== '0.2.0-rc.2') {
    throw new Error('This adapter is validated only with @deepseek-ai/dsh 0.2.0-rc.2')
  }
  const load = name => import(pathToFileURL(req.resolve(name)))
  return { load }
}

async function migrationWorker(stageRoot, packagePath, id, access = 'write') {
  const { load } = await sdk(packagePath)
  const { Context } = await load('@deepseek-ai/cordis')
  const { default: Persistence } = await load('@deepseek-ai/dsh-session-persistence-jsonl')
  const storage = new Persistence(new Context(), { root: resolve(stageRoot), compression: 'zstd' })
  const handle = await storage.open(id, access)
  try {
    const { events } = await handle.read()
    if (access === 'write') await handle.flush()
    // Only metadata leaves the process; no messages, prompts, tokens or tool output.
    return { id, version: handle.header.version, events: events.length }
  } finally { await handle.close() }
}

async function migrateIsolated(stage, packagePath, id) {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--worker', stage, packagePath, id], { stdio: ['ignore', 'pipe', 'pipe'] })
  let output = '', errors = ''
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { errors += chunk })
  const [code] = await once(child, 'exit')
  if (code !== 0) throw new Error(`official migration failed (${id}): ${errors.slice(-2000)}`)
  return JSON.parse(output.trim())
}

export async function normalizeFile(path) {
  const temp = `${path}.relay-stage`
  const decoder = spawn('zstd', ['-q', '-d', '-c', '--', path], { stdio: ['ignore', 'pipe', 'pipe'] })
  const decoded = new Promise((ok, fail) => { decoder.on('error', fail); decoder.on('close', code => code === 0 ? ok() : fail(new Error('zstd decoder rejected artifact'))) })
  decoded.catch(() => {})
  const input = decoder.stdout
  decoder.stderr.resume()
  const compression = { params: { [constants.ZSTD_c_checksumFlag]: 1 } }
  const compressed = createZstdCompress(compression)
  const destination = createWriteStream(temp, { flags: 'wx', mode: 0o600 })
  const output = pipeline(compressed, destination)
  // Attach a handler immediately; await the original promise after the writer ends.
  output.catch(() => {})
  const lines = createInterface({ input, crlfDelay: Infinity })
  let replacements = 0, header
  try {
    for await (const line of lines) {
      if (!line) throw new Error('empty JSONL record refused')
      const row = JSON.parse(line)
      if (!header) {
        header = row
        // DSH requires the first Zstd frame to contain exactly the header line.
        if (!destination.write(zstdCompressSync(Buffer.from(`${line}\n`), compression))) await once(destination, 'drain')
        continue
      }
      const changed = normalizeRow(row)
      replacements += changed
      if (!compressed.write(`${changed ? JSON.stringify(row) : line}\n`)) await once(compressed, 'drain')
    }
    await decoded
    compressed.end()
    await output
    if (replacements) await fs.rename(temp, path)
    else await fs.rm(temp)
    return { replacements, id: header?.id, version: header?.version ?? 0 }
  } catch (error) {
    decoder.kill(); input.destroy(); compressed.destroy(); lines.close()
    await output.catch(() => {})
    await fs.rm(temp, { force: true })
    throw error
  }
}

export async function prepare({ source, stage, dshPackage }) {
  source = await fs.realpath(resolve(source))
  stage = resolve(stage)
  if (stage === source || stage.startsWith(`${source}/`)) throw new Error('stage must be outside source')
  const originalFiles = await files(source)
  await fs.mkdir(stage, { mode: 0o700 }) // Never reuse a partial staging directory.
  const inventory = []
  for (const path of originalFiles) inventory.push({ path: relative(source, path), sha256: await digest(path) })
  const stageRoot = join(stage, 'sessions')
  await fs.cp(source, stageRoot, { recursive: true, errorOnExist: true, force: false })
  const selected = new Map()
  for (const entry of inventory) {
    const match = /^session(?:\.v([1-9][0-9]*))?\.jsonl\.zstd$/.exec(entry.path.split('/').at(-1))
    if (!match) continue
    const version = Number(match[1] ?? 0), dir = dirname(entry.path)
    if (!selected.has(dir) || selected.get(dir).version < version) selected.set(dir, { ...entry, version })
  }
  const repairs = [], failures = [], pending = []
  for (const entry of selected.values()) {
    if (entry.version >= 3) continue
    const path = join(stageRoot, entry.path)
    try {
      const changed = await normalizeFile(path)
      if (!changed.replacements) continue
      pending.push({ entry, changed, path })
    } catch (error) { failures.push({ path: entry.path, error: error.message }); console.error(JSON.stringify(failures.at(-1))) }
  }
  for (const { entry, changed, path } of pending) {
    try {
      const migrated = await migrateIsolated(stageRoot, dshPackage, changed.id)
      const target = join(dirname(entry.path), `session.v${migrated.version}.jsonl.zstd`)
      const record = { source: entry.path, sourceSha256: entry.sha256, replacements: changed.replacements,
        normalizedSha256: await digest(path), target, targetSha256: await digest(join(stageRoot, target)), ...migrated }
      repairs.push(record)
      console.log(JSON.stringify({ prepared: record.id, replacements: record.replacements, events: record.events, version: record.version }))
    } catch (error) { failures.push({ path: entry.path, error: error.message }); console.error(JSON.stringify(failures.at(-1))) }
  }
  // Source backup must be byte-identical even when any migration fails.
  for (const entry of inventory) if (await digest(join(source, entry.path)) !== entry.sha256) throw new Error('source changed during preparation')
  const receipt = { adapter: 'session-coordination-legacy-source-descriptor-v1', dshVersion: '0.2.0-rc.2', createdAt: new Date().toISOString(), source,
    inventory, repairs, failures }
  await fs.writeFile(join(stage, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  return receipt
}

export async function apply({ stage, destination, dshPackage }) {
  stage = await fs.realpath(resolve(stage)); destination = await fs.realpath(resolve(destination))
  const receipt = JSON.parse(await fs.readFile(join(stage, 'receipt.json'), 'utf8'))
  if (receipt.failures.length) throw new Error('preparation has failures; nothing will be published')
  const { load } = await sdk(dshPackage)
  const { tryLockExclusive } = await load('@deepseek-ai/node-addon-system/flock')
  // Protect the entire corpus used by official parent/child migration, not just each parent.
  for (const entry of receipt.inventory) {
    if (entry.path.endsWith('session.lock')) continue
    if (await digest(join(destination, entry.path)) !== entry.sha256) throw new Error(`destination changed: ${entry.path}`)
  }
  for (const record of receipt.repairs) {
    const source = join(destination, record.source), target = join(destination, record.target)
    const staged = join(stage, 'sessions', record.target)
    if (await digest(staged) !== record.targetSha256) throw new Error('staged target changed')
    const lockPath = join(dirname(source), 'session.lock')
    const lock = await fs.open(lockPath, 'a', 0o600)
    try {
      await tryLockExclusive(lock.fd)
      const held = await lock.stat(), current = await fs.stat(lockPath)
      if (held.ino !== current.ino || held.dev !== current.dev) throw new Error('lock inode changed')
      if (await digest(source) !== record.sourceSha256) throw new Error('original source changed')
      // Exclusive hard-link publication; existing current files are never overwritten.
      try { await fs.link(staged, target) } catch (error) {
        if (error.code !== 'EEXIST' || await digest(target) !== record.targetSha256) throw error
      }
      const directory = await fs.open(dirname(target), 'r')
      try { await directory.sync() } finally { await directory.close() }
      if (await digest(source) !== record.sourceSha256) throw new Error('original source changed after publication')
      await fs.writeFile(join(dirname(target), 'session-relay-repair.json'), `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx', mode: 0o600 }).catch(error => { if (error.code !== 'EEXIST') throw error })
      console.log(JSON.stringify({ published: record.id, events: record.events }))
    } finally { await lock.close() }
  }
}

async function main(args) {
  if (args[0] === '--worker') {
    console.log(JSON.stringify(await migrationWorker(args[1], args[2], args[3], args[4] ?? 'write')))
    return
  }
  const options = {}
  for (let i = 0; i < args.length; i += 2) {
    if (!['--source','--stage','--dsh-package','--apply-to'].includes(args[i]) || !args[i+1]) throw new Error('usage: --source <backed-up-sessions> --stage <new-directory> --dsh-package <installed-dsh/package.json>; apply: --stage <prepared-directory> --apply-to <sessions> --dsh-package <installed-dsh/package.json>')
    options[args[i].slice(2)] = args[i+1]
  }
  if (!options.stage || !options['dsh-package']) throw new Error('stage and dsh-package required')
  if (options['apply-to']) await apply({ stage: options.stage, destination: options['apply-to'], dshPackage: options['dsh-package'] })
  else {
    if (!options.source) throw new Error('source required')
    const result = await prepare({ source: options.source, stage: options.stage, dshPackage: options['dsh-package'] })
    console.log(JSON.stringify({ prepared: result.repairs.length, failures: result.failures.length }))
    if (result.failures.length) process.exitCode = 1
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1 })
}
