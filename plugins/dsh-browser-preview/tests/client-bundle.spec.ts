import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clientBundle } from '../scripts/tsdown.client.ts'

function clientConfig() {
  const packageRoot = fileURLToPath(new URL('..', import.meta.url))
  vi.spyOn(process, 'cwd').mockReturnValue(packageRoot)
  return clientBundle('dsh-browser-preview', ['src/index.ts'])({})
    .find(config => config.name === 'dsh-browser-preview/client')!
}

afterEach(() => vi.restoreAllMocks())

describe('DSH 0.2 browser module identity', () => {
  it('resolves the shared store from the shell instead of duplicating its engine', () => {
    const config = clientConfig()
    const noExternal = config.noExternal as (id: string) => boolean | undefined
    expect(noExternal('@deepseek-ai/dsh-client-store')).toBeUndefined()
    expect(config.external).toContain('@deepseek-ai/dsh-client-store')
  })

  it('keeps dockkit identity in the shell module table', () => {
    expect(clientConfig().external).toContain('@deepseek-ai/dsh-client-ui-dockkit')
  })

  it('rejects the removed runtime client import at the purity boundary', () => {
    const config = clientConfig()
    const plugins = config.plugins as Array<{ name: string; resolveId?: (source: string) => unknown }>
    const gate = plugins.find(plugin => plugin.name === 'dsh-client-bundle-purity')!
    expect(() => gate.resolveId!('@deepseek-ai/dsh-client-runtime/client')).toThrow('client bundle purity')
  })
})
