import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('dsh-worktree browser face', () => {
  it('declares a Web client export that ships in the package', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      exports?: Record<string, { types?: string, default?: string }>
      files?: string[]
      dsh?: { client?: { inject?: string[], platform?: string } }
    }

    expect(manifest.exports?.['./client']).toEqual({
      types: './lib/types/client/index.d.ts',
      default: './lib/client.js',
    })
    expect(manifest.dsh?.client).toEqual({
      inject: [
        '@deepseek-ai/dsh-api-gateway',
        '@deepseek-ai/dsh-client-locale',
        '@deepseek-ai/dsh-client-runtime',
        '@deepseek-ai/dsh-client-ui-conversation',
        '@deepseek-ai/dsh-client-ui-sidebar',
      ],
      platform: 'web',
    })
    expect(manifest.files).toContain('lib/client.js')
    expect(manifest.files).toContain('lib/types')
  })
})
