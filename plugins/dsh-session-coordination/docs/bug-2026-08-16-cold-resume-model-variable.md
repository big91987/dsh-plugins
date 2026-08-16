# Bug 记录：冷唤醒会话时 persona `{{model}}` 变量无值导致回复失败

- 状态：Fixed
- 发现日期：2026-08-16
- 影响插件：`dsh-session-coordination`
- 影响 Host：`@deepseek-ai/dsh@0.1.0-rc.6`
- 修复 commit：见下方「修复」一节

## 一、现象

向一个 stored（休眠归档）的独立 Session 通过 `send_message_to_thread` 发送消息时，消息投递成功（目标 Session 被冷唤醒、进入新 turn），但目标 Session 处理失败，`turn/end` 以 error 结束：

```text
prompt variable "{{model}}" has no value for this assembly (section "deployment:persona")
code: UNKNOWN
```

结果：消息「进去了」但目标会话没有产生任何回复，跨会话对话链路未真正闭环。

## 二、发现过程

1. 在 Web GUI 中用 `send_message_to_thread` 向「查询Deepseek V4 Pro与Flash API价格」（stored 状态）会话发消息；
2. `read_thread` 观察到消息以 `source.kind: session-relay` 成功进入对方会话、对方进入 turn 3 开始处理；
3. 但 `wait_threads` 返回的 `turn/end` 事件带 `error`，错误信息即上面的 `{{model}}` 无值报错；
4. 沿报错文本在 Harness 源码中定位变量渲染逻辑，追到根因。

## 三、根因

### 3.1 报错的直接来源

`{{model}}` 是系统提示词（system prompt）的**提示词变量**，由 `@deepseek-ai/dsh-agent-loop` 注册：

```ts
// packages/core/agent-loop/src/index.ts
ctx.systemPrompt.variable('model', context => context.agent?.options.model)
```

persona 段落（`deployment:persona`）的模板里引用了 `{{model}}`。装配 system prompt 时（`agent-loop/src/agent.ts` 的 `assemble(assembleContextFor(this, signal))`），变量求值读的是 **`agent.options.model`**。

渲染逻辑（`packages/core/system-prompt/src/index.ts` 的 `interpolate`）：

```ts
const value = variables[name]
if (value === undefined) {
  throw new Error(`prompt variable "{{${name}}}" has no value for this assembly (${kind} "${input.name}")`)
}
```

当 `agent.options.model` 为 `undefined` 时，`{{model}}` 求值失败，抛错。

### 3.2 为什么冷唤醒时 `agent.options.model` 是 undefined

`dsh-session-coordination` 的 `sendMessage` 对 stored 会话走冷唤醒路径 `resumeTarget`（`src/service.ts`）：

```ts
handle = await this.ctx.agents.resume({
  resumeSessionId: id,
  ...(signal === undefined ? {} : { signal }),
  setup: async agentCtx => { await this.ctx.agentPresets.mount(agentCtx, preset) },
})
```

关键点：**`resume` 没有传 `agentOptions`**。而 `agent-loop` 的 `resumeWith` 里是：

```ts
return await this.setupAndPublish(
  ownerCtx, id, preparation,
  options.agentOptions ?? {},   // ← 没传就是空对象
  options.setup, options.signal, 'resume',
)
```

于是被唤醒的 agent 的 `options` 是空对象，`options.model` 为 `undefined`。system prompt 装配发生在任何请求路由解析之前（`agent.ts:230` 先 assemble，之后才在 `agent/request` waterfall 里补 model），所以 persona 的 `{{model}}` 在装配阶段就炸了。

### 3.3 为什么平时不炸、只有冷唤醒炸

| 路径 | `agent.options.model` | 结果 |
|---|---|---|
| 用户正常点开会话（UI 选模型） | 有值（构造时 options 带 model） | ✅ |
| `fork_thread`（`agents.create`） | 传了 `agentOptions`/meta | ✅ |
| `send_message_to_thread` 冷唤醒（`agents.resume`） | **没传 agentOptions → undefined** | 💥 |

对比 `forkThread`（`src/service.ts` 的 create 分支）就清楚了：create 时把 `agentPreset` 等放进 meta，而 resume 分支只传了 `resumeSessionId` + `setup`，漏掉了模型路由。

## 四、修复

### 4.1 方案

冷唤醒 `resumeTarget` 时，从目标会话的事件日志里恢复它**最后一次使用的 provider/model**，作为 `agentOptions` 传给 `agents.resume`：

1. 新增 `lastRoutedAgentOptions(events)`：扫描事件日志，取最后一个 `request/header` 事件的 `header.config.provider/model`（`request/header` 事件记录了会话实际使用的路由，权威且与模型无关）；
2. `resumeTarget` 里把结果透传给 `agents.resume({ ..., agentOptions })`；
3. 找不到 `request/header` 时（理论上只可能是从未请求过的空会话）返回 `undefined`，保持原行为（不传 agentOptions），不更糟。

修复后的 `resumeTarget`：

```ts
const agentOptions = lastRoutedAgentOptions(source.events)
let handle: AgentHandle
try {
  handle = await this.ctx.agents.resume({
    resumeSessionId: id,
    ...(signal === undefined ? {} : { signal }),
    ...(agentOptions === undefined ? {} : { agentOptions }),
    setup: async agentCtx => { await this.ctx.agentPresets.mount(agentCtx, preset) },
  })
} catch (error) { ... }
```

### 4.2 为什么从事件日志恢复而不是用别的来源

- `readSession` 返回的 `session` 是 `SessionHeader`，**不含** provider/model（模型路由不在 header 里）；
- 会话最后一次实际使用的路由唯一权威来源就是事件日志里的 `request/header`（`EpochHeader.config`）；
- 这也保证了「会话原来用哪个模型，冷唤醒后还用哪个模型」，语义正确。

## 五、验证

- 新增 2 个单元测试（`tests/service.spec.ts`）：
  1. 冷唤醒 stored 会话时，`resume` 收到 `agentOptions: { provider, model }`（从 `request/header` 恢复）；
  2. 无 `request/header` 的会话冷唤醒时不传 `agentOptions`（防御路径）。
- 全部测试通过：`15 passed`。
- `pnpm typecheck` / `pnpm build` 通过。

修复后，向「查询Deepseek V4 Pro与Flash API价格」这类 stored 会话发消息，目标会话会以它原来的 `deepseek-v4-pro` 路由恢复，persona 的 `{{model}}` 正常渲染，回复可正常产生。

## 六、后续建议（可选）

- 同类风险点：任何「从持久化恢复 agent 而不带模型」的路径都应检查 persona 变量是否依赖 `agent.options.model`。若将来 persona 模板引入更多 `{{...}}` 变量（如 `{{cwd}}`），冷唤醒路径同样需要保证对应变量来源可用。
