import { test } from 'vitest'
import assert from 'node:assert/strict'
import { normalizeRow, normalizeFile } from '../scripts/repair-session-sources.mjs'

test('repairs only the attributed peer source and preserves message content', () => {
 const source = { kind: 'session-relay', form: 'relay', senderSessionId: 'session-sender' }
 const row = { type: 'agent/inbox/spliced', seq: 17, time: 123, data: { inserted: [{ id: 'm1', source, content: [{ type: 'text', text: '原消息' }] }] } }
 const original = structuredClone(row)
 assert.equal(normalizeRow(row), 1)
 assert.deepEqual(row, { ...original, data: { inserted: [{ ...original.data.inserted[0], source: { ...source, kind: 'agent-message' } }] } })
})
test('refuses a relay with missing attribution or unknown fields', () => {
 for (const source of [{ kind: 'session-relay', form: 'relay' }, { kind: 'session-relay', form: 'relay', senderSessionId: 's', unexpected: true }]) {
  const row = { type: 'user/message', data: { source } }
  assert.throws(() => normalizeRow(row), /invalid legacy relay/)
 }
})
test('does not rewrite JSON embedded in tool output or unrelated sources', () => {
 const row = { type: 'tool/result', data: { message: { source: { kind: 'tool' }, content: [{ source: { kind: 'session-relay', form: 'relay', senderSessionId: 's' } }] } } }
 const original = structuredClone(row)
 assert.equal(normalizeRow(row), 0)
 assert.deepEqual(row, original)
})

import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { execFileSync } from 'node:child_process'

test('normalizes a concatenated-frame legacy log without losing complete records', async () => {
 const root = await mkdtemp(join(tmpdir(), 'relay-regression-'))
 const path = join(root, 'session.jsonl.zstd')
 const header = { type: 'session', id: 'session-example', version: 0 }
 const message = { type: 'user/message', seq: 0, time: 1, data: { id: 'message-example', source: { kind: 'session-relay', form: 'relay', senderSessionId: 'sender' }, content: [{ type: 'text', text: '中文正文' }] } }
 try {
  await writeFile(path, Buffer.concat([header, message].map(row => zstdCompressSync(Buffer.from(JSON.stringify(row) + '\n')))))
  assert.deepEqual(await normalizeFile(path), { replacements: 1, id: 'session-example', version: 0 })
  const rows = execFileSync('zstd', ['-q', '-d', '-c', path]).toString().trim().split('\n').map(line => JSON.parse(line))
  assert.deepEqual(rows, [header, { ...message, data: { ...message.data, source: { ...message.data.source, kind: 'agent-message' } } }])
 } finally { await rm(root, { recursive: true, force: true }) }
})
test('a corrupt compressed log rejects without changing its bytes', async () => {
 const root = await mkdtemp(join(tmpdir(), 'relay-corruption-'))
 const path = join(root, 'session.jsonl.zstd')
 const original = Buffer.from('not-a-zstd-log')
 try {
  await writeFile(path, original)
  await assert.rejects(normalizeFile(path), /zstd decoder/)
  assert.deepEqual(await readFile(path), original)
 } finally { await rm(root, { recursive: true, force: true }) }
})

test('upgrades the released v2 subagent descriptor without changing its route or policy', () => {
 const row = { type: 'subagent/descriptor', seq: 27, time: 1, data: { version: 2, mode: 'continuable', provider: 'agent', label: 'review', agentProvider: 'provider', agentModel: 'model', persona: 'review carefully', toolFilter: { deny: ['write'] } } }
 const original = structuredClone(row)
 assert.equal(normalizeRow(row), 1)
 assert.deepEqual(row, { ...original, data: { ...original.data, version: 3 } })
})
test('refuses unsupported descriptor extensions rather than discarding them', () => {
 const row = { type: 'subagent/descriptor', data: { version: 2, mode: 'continuable', provider: 'agent', label: 'review', secretExtraPolicy: 'restriction' } }
 assert.throws(() => normalizeRow(row), /invalid legacy descriptor/)
})
