import { clientBundle } from './scripts/tsdown.client.ts'

export default clientBundle('dsh-browser-preview', ['src/index.ts'], {
  libExternal: [
    '@deepseek-ai/dsh-agent',
    '@deepseek-ai/dsh-attachment',
    '@deepseek-ai/dsh-client-runtime',
    '@deepseek-ai/dsh-client-ui-conversation',
    '@deepseek-ai/dsh-client-ui-layout',
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-host-webserver',
    '@deepseek-ai/dsh-tools',
  ],
})
