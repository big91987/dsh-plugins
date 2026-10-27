import { readdir, readFile, access } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const ignored = new Set(['.git', 'node_modules', 'lib', '.artifacts', 'coverage', '.playwright-cli'])
let count = 0
const failures = []
async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await check(path)
    else if (entry.name.endsWith('.md')) {
      count++
      const text = await readFile(path, 'utf8')
      for (const match of text.matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
        const link = match[1].replace(/^<|>$/g, '')
        if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(link)) continue
        const target = decodeURIComponent(link.split('#')[0])
        if (!target) continue
        try { await access(resolve(dirname(path), target)) }
        catch { failures.push(`${path.slice(root.length + 1)}: ${link}`) }
      }
    }
  }
}
await check(root)
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1 }
else console.log(`Documentation links passed (${count} Markdown files).`)
