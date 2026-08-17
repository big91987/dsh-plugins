# DSH 插件集

简体中文 | [English](README.md)

这个仓库包含三个可以独立安装的 DeepSeek Harness 插件，目标版本是 `@deepseek-ai/dsh@0.1.0-rc.6`。仓库目前主要供个人和可信同事从源码安装使用，尚未把三个包分别发布到 npm。

| 插件 | 用途 | 使用入口 |
| --- | --- | --- |
| [`dsh-worktree`](plugins/dsh-worktree/README.md) | 在新聊天或新 Git Worktree 中继续当前 Session | Session 右键菜单 |
| [`dsh-session-coordination`](plugins/dsh-session-coordination/README.md) | 让彼此独立的顶层 Session 查询、读历史、发消息、等待和派生新聊天 | 直接用自然语言要求 Agent 操作 |
| [`dsh-compact-img`](plugins/dsh-compact-img/README.md) | 把当前会话历史中的图片转换成文字检查点，以便切换到不支持图片的模型 | `/compact-img` 命令 |

三个插件只共用仓库和开发工具，运行时互不依赖。可以只安装一个，也可以全部安装。

## 一、环境要求

- macOS 或 Linux；Worktree 插件依赖本机 Git。
- Node.js `^22.19.0` 或 `>=24.0.0`。
- pnpm `11.7.0`。如果尚未启用，可先执行 `corepack enable`。
- DeepSeek Harness `0.1.0-rc.6`。
- 能正常运行 `npx @deepseek-ai/dsh web` 的 DSH 配置和模型凭证。

这里的 `rc.6` 是 `0.1.0` 正式版之前的第六个发布候选版本，不是插件的特殊运行模式。之所以固定它，是因为 Worktree 浏览器插件与这个版本的 Workspace 前端产物精确匹配。

## 二、安装

### 1. 克隆并构建

```sh
git clone https://github.com/big91987/dsh-plugins.git
cd dsh-plugins
pnpm install --frozen-lockfile
pnpm build
```

请把仓库放在长期不变的位置。下面的本地安装会让 DSH Profile 链接到这个目录；安装后移动或删除仓库，会让插件无法加载。

### 2. 安装需要的插件

全部安装：

```sh
npx @deepseek-ai/dsh@0.1.0-rc.6 plugin --profile web add ./plugins/dsh-worktree
npx @deepseek-ai/dsh@0.1.0-rc.6 plugin --profile web add ./plugins/dsh-session-coordination
npx @deepseek-ai/dsh@0.1.0-rc.6 plugin --profile web add ./plugins/dsh-compact-img
```

也可以只执行其中一条。安装目标是 DSH 的 `web` Profile，默认位于 `~/.dsh/profiles/web`；如果设置了 `DSH_HOME`，则位于 `$DSH_HOME/profiles/web`。

### 3. 启动

固定使用已验证版本：

```sh
npx @deepseek-ai/dsh@0.1.0-rc.6 web
```

平时使用下面的命令也可以，但 npm 的默认版本将来可能升级，因此升级后若 Worktree 插件构建或加载失败，应先核对实际 DSH 版本：

```sh
npx @deepseek-ai/dsh web
```

安装或更新浏览器插件后，需要停止并重新启动 DSH Web；已经打开的页面建议刷新一次。

## 三、Worktree 插件

### 能做什么

在左侧 Session 上点击右键，可以看到：

- **在新聊天中继续**：复制截至最后一个完整 turn 的历史，在相同工作目录中创建并自动打开新 Session。
- **在新工作树中继续**：从当前仓库的 `HEAD` 创建一个真实的 Git Worktree，把当前工作区状态带过去，创建 Session，并在成功后自动打开。

Worktree Session 在浏览器中投影到原项目下面，并带有工作树图标。它在 DSH Host 内部仍然拥有独立 Workspace，因为它的工作目录与原项目不同。

### 创建时会复制什么

新 Worktree 基于源仓库当前的 `HEAD`，同时复制：

- 已跟踪文件的 staged 和 unstaged 修改合并后的结果；
- 普通未跟踪文件；
- 被 Git 忽略的 `AGENTS.override.md`；
- 根目录 `.worktreeinclude` 中明确列出的其他 ignored 文件。

`.worktreeinclude` 每行写一个仓库相对路径或 Git pathspec，空行和以 `#` 开头的行会被忽略。例如：

```text
# Worktree 初始化也需要的本地文件
.env.local
config/private-development.json
```

不要在 `.worktreeinclude` 中加入不希望复制到并行开发目录的密钥。插件不会把 ignored 文件提交到 Git，但会真实复制到新目录。

### Worktree 创建在哪里

默认位置：

```text
~/.dsh/worktrees/<四位哈希>/<仓库目录名>
```

如果设置了 `DSH_HOME`，位置变成：

```text
$DSH_HOME/worktrees/<四位哈希>/<仓库目录名>
```

可以用下面的命令查看 Git 当前登记的所有 Worktree：

```sh
git -C /原项目路径 worktree list
```

### 分支、提交和合并

插件创建的是指向源 Session 创建时 `HEAD` 的 `detached HEAD` Worktree。它不会自动创建特性分支，也不会在任务结束后自动合并到主线。

需要保留修改时，可以让 Agent 执行，也可以自己进入 Worktree 后执行：

```sh
git switch -c feature/my-change
git add -A
git commit -m "feat: my change"
```

之后通过普通 Git merge、cherry-pick 或 Pull Request 合入主线。冲突检测和解决来自 Git 与 Agent 的通用能力，不是 Worktree 插件的专用合并功能。

### 失败与恢复

创建过程会显示 pending 状态。失败后根据阶段可以重试、取消、忽略初始化失败后继续，或者关闭失败记录。成功后 Session 会自动打开；内部 Worktree 元数据保存在 Git 公共目录中，因此重启 DSH 后仍可恢复项目投影关系。

### 删除和清理

卸载插件不会删除已经创建的 Worktree、分支、提交或 Session。需要清理时先确认修改已经提交或不再需要，然后运行：

```sh
git -C /原项目路径 worktree remove /完整的Worktree路径
git -C /原项目路径 worktree prune
```

不要直接用 `rm -rf` 删除仍被 Git 登记的 Worktree。Worktree 有未提交修改时，Git 默认会拒绝删除；只有确定不需要这些修改时才考虑 `git worktree remove --force`。

## 四、Session 通信插件

### 怎么使用

这不是斜杠命令，也没有额外界面。安装后，Agent 会得到五个模型工具。直接在任意顶层 Session 中用自然语言说明目标即可，例如：

```text
列出当前所有独立 Session，告诉我它们的标题、状态和 Session ID。
```

```text
读取 Session <ID> 最近的新消息，概括它正在处理什么。
```

```text
给 Session <ID> 发送消息：请检查当前实现的边界情况，完成后回复我。
```

```text
等待 Session <ID> 完成，然后把新增结果带回来。
```

```text
从 Session <ID> 最后一个完成的 turn 派生一个新聊天。
```

Agent 实际调用的工具是：

| 工具 | 作用 |
| --- | --- |
| `list_threads` | 列出 running、idle 和 stored 的独立顶层 Session，不唤醒它们 |
| `read_thread` | 按 Session ID 读取历史；支持 cursor 增量读取，不唤醒 stored Session |
| `send_message_to_thread` | 向目标 Session 投递下一轮用户消息；必要时冷唤醒 stored Session |
| `wait_threads` | 等待一到八个目标中的运行状态发生完成变化，并返回增量快照 |
| `fork_thread` | 从一个完整 turn 的历史前缀创建相同目录的新 Session |

插件故意排除 subagent 所属的内部任务 Session。它解决的是顶层聊天之间的协作，不替代 DSH 自己的 subagent 委派机制。

### 冷唤醒踩坑

早期版本给 stored Session 发消息时，只恢复了历史，没有恢复原 Session 最后使用的 provider/model，导致 persona 模板中的 `{{model}}` 无法渲染：消息已经进入目标 Session，但目标无法产生回复。

当前实现会从 Session 的最后一个 `request/header` 事件恢复实际路由，再调用 `agents.resume`。详细根因、修复和验证见[踩坑记录](plugins/dsh-session-coordination/docs/bug-2026-08-16-cold-resume-model-variable.md)。

如果目标 Session 从未成功发起过模型请求，事件日志可能没有可恢复的路由；这种极少见的空 Session 仍可能需要先在界面中手工选择模型并运行一次。

### 与官方能力的关系

这个插件使用官方的 Cordis 插件生命周期、Session 查询、Agent create/resume、Workspace registry、Session 事件日志和工具注册能力，属于附加式 Host 插件，不替换官方 UI。

但 DSH `0.1.0-rc.6` 没有一个“跨顶层 Session 通信”的单一公共 API，也没有 Codex 同名的线程管理协议。因此它不是几行代码调用一个现成接口，而是插件自己组合并负责以下语义：

- 哪些 Session 可以被列出，哪些 subagent Session 必须排除；
- 读取历史时不意外唤醒目标；
- 消息来源写入持久化日志；
- stored Session 的冷唤醒和模型路由恢复；
- 并发唤醒合并、等待超时和增量 cursor；
- 新聊天只复制完整 turn，避免截断中的工具调用进入新 Session。

这比 Worktree 的整段前端兼容补丁更接近官方扩展方式，但协议本身仍是本仓库维护的能力，DSH 升级后必须重新验证 Agent、Session 和 Workspace 的生命周期接口。

## 五、图片历史压缩插件

### 解决什么问题

当 Session 历史中包含粘贴图片、`read_image` 结果或嵌套在工具结果里的图片时，DSH 会阻止切换到不支持图片输入的模型。普通 `/compact` 只按通用历史窗口压缩，不能专门清除当前可见历史中的图片要求。

### 使用方法

1. 保持当前 Session 空闲，不要让它同时生成回复。
2. 确认当前选择的模型支持图片输入。
3. 输入：

```text
/compact-img
```

4. 等待命令报告已替换多少个含图项目。
5. 再手工切换到纯文本模型。

命令不接受参数。它会查找当前模型可见 surface 中的含图节点，把连续区域扩展到工具调用/结果配对完整的边界，通过当前 Session 最近实际路由的多模态模型生成文字摘要，然后用纯文本检查点替换这些区域。

### 注意事项

- 会产生一次或多次多模态模型调用，因此会消耗 token 并可能产生费用。
- 图片会被压缩成模型生成的文字描述，细节可能丢失。重要截图、图表数值和设计稿应先在外部保存。
- 原始 Session 事件及来源关系仍保留在持久化日志中，但后续普通模型上下文看到的是文字检查点，而不是原图。
- 只处理当前可见 surface；以前已经被其他 compaction shadow 的内容不会重新处理。
- 如果当前模型不支持图片，命令会报错并要求先切回多模态模型，不会静默丢弃图片。
- 如果 Session 尚无可用的 provider/model 路由，需要先正常运行一次多模态模型请求。

### 与官方能力的关系

插件通过官方 Commands、Session、LLM、Attachment 和 Compaction 服务实现持久化替换，没有修改 DSH UI，也没有绕过模型的图片输入检查。不过 `/compact-img` 的目标选择、含图 span 识别和提示词是本插件定义的行为，不是 DSH 内置 `/compact` 的官方模式。

## 六、更新

停止正在运行的 DSH Web，在仓库目录执行：

```sh
git pull --ff-only
pnpm install --frozen-lockfile
pnpm build
npx @deepseek-ai/dsh@0.1.0-rc.6 plugin --profile web install
npx @deepseek-ai/dsh@0.1.0-rc.6 web
```

本地 link 通常不需要重新执行 `add`；重新构建并运行 Profile 的 `install` 可以同步依赖。如果某个插件被从 Profile 中移除过，再单独执行对应的 `add`。

不要在未验证的情况下直接升级 DSH 主版本。Worktree 构建脚本会校验官方 Workspace bundle 的 SHA-256；版本不匹配时会明确失败，目的是防止把 RC6 的代码变换错误地应用到其他版本。

## 七、卸载

按需执行：

```sh
npx @deepseek-ai/dsh@0.1.0-rc.6 plugin --profile web remove dsh-worktree
npx @deepseek-ai/dsh@0.1.0-rc.6 plugin --profile web remove dsh-session-coordination
npx @deepseek-ai/dsh@0.1.0-rc.6 plugin --profile web remove dsh-compact-img
```

然后重启 DSH Web。卸载行为如下：

- Worktree 右键入口和项目投影消失，但 Git Worktree、其中的代码修改和已有 Session 不会被删除；Worktree Session 可能重新显示为独立 Workspace。
- Session 通信工具消失，但以前投递的消息和 `session-relay` 来源记录仍在 Session 日志中。
- `/compact-img` 命令消失；已经生成的文字检查点仍是 Session 持久化历史的一部分。

确认三个插件都卸载且不再需要本地源码后，才能删除这个仓库目录。

## 八、与 DSH `0.1.0-rc.6` 官方扩展机制的偏差

### 符合官方方式的部分

- 三个包都通过 `package.json` 的 `dsh.bundle.patch` 和 `cordis.patch.yml` 安装到 Profile。
- Host 功能通过 Cordis Service、依赖注入、effect 生命周期和工具/命令注册实现。
- Session 通信写入正式 Session 事件日志；图片压缩使用正式 compaction replacement 事件；模型可见内容可从日志重建。
- 三个插件可以独立安装，没有人为制造总插件运行时依赖。

### 当前接受的兼容实现

1. **Worktree 浏览器 UI 不是纯附加扩展。** RC6 没有公开的 Session 行右键菜单扩展点，因此插件禁用官方 `ui-workspace` 行，基于校验和锁定的官方 RC6 Workspace 编译产物生成兼容版本，再加入两个菜单项和 Worktree 投影。这是当前最大的升级风险。
2. **“同一项目”是浏览器投影。** DSH 的 Workspace 以规范化 cwd 为身份，Worktree 使用不同目录，所以 Host 内部必然是另一个 Workspace。插件在浏览器中把它投影到源项目下，但项目级排序、移动、删除等边缘操作不等价于真正的一等 Project→Worktree 模型。
3. **Worktree Remote 描述符目前手写。** 服务使用官方 Typert Remote 基类，但 descriptor 和 codec 没有走完整的 `@Remote` 生成流水线，升级协议时需要人工核对。
4. **配置校验没有完整 Schemastery 表面。** Worktree 的路径和数值会在加载时手工校验，但尚未提供官方文档建议的同名 `Config` Schema 和设置界面。
5. **跨 Session 协议由插件维护。** 官方提供组成它所需的底层服务，但没有 Codex 等价的一体化顶层 Session 通信接口；冷唤醒、路由恢复、等待和历史派生规则需要随 Host 生命周期变化重新验证。
6. **仓库暂时只支持源码链接安装。** 仓库根不是 Bundle，三个子包也没有面向 Git URL 安装的 `prepare` 发布流程，因此不能把 `github:big91987/dsh-plugins` 当作一个插件直接安装。当前支持方式是克隆、构建后分别添加三个子目录。
7. **`dsh.compatibility.host` 只是声明信息。** RC6 的 Profile 加载器不会根据这个字段自动阻止不兼容版本，真正保护主要来自固定依赖版本、测试和 Worktree bundle 校验和。

这些偏差是为了先满足个人和同事在固定 RC6 环境中的实际使用。后续如果需要面向更广泛用户发布，应优先等待或推动官方 Session 行 action 扩展点，再把三个子包分别标准化发布。

## 九、排查

### 插件没有出现

```sh
pnpm build
npx @deepseek-ai/dsh@0.1.0-rc.6 plugin --profile web install
npx @deepseek-ai/dsh@0.1.0-rc.6 web
```

同时确认仓库路径没有变化，并检查：

```text
~/.dsh/profiles/web/package.json
```

若设置了 `DSH_HOME`，检查 `$DSH_HOME/profiles/web/package.json`。其中应存在指向已安装插件目录的本地依赖。

### Worktree 创建失败

- 确认源 Session 有工作目录，而且位于 Git 仓库内。
- 执行 `git status` 和 `git worktree list` 检查仓库状态。
- 检查 `$DSH_HOME/worktrees` 或 `~/.dsh/worktrees` 的写权限。
- 如果刚升级过 DSH，先回到 `0.1.0-rc.6` 验证，不要绕过 bundle 校验和。

### Session 收到消息但不回复

- 用 `read_thread` 检查目标的 `turn/end` 是否带 error。
- 如果出现 `prompt variable "{{model}}" has no value`，确认使用的是包含冷唤醒修复的最新代码并已重新构建、重启。
- 如果目标从未成功请求过模型，先在目标 Session 中选择模型并手工运行一轮。

### `/compact-img` 报模型不支持图片

先切换到能够读取图片的多模态模型并让该路由生效，再运行 `/compact-img`；命令完成后才切换到纯文本模型。

## 十、开发验证

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```

各插件也可以单独验证：

```sh
pnpm --filter dsh-worktree test
pnpm --filter dsh-session-coordination test
pnpm --filter dsh-compact-img test
```

DeepSeek Harness 官方源码仓库在这个项目中只作为行为和接口参考；插件代码、提交和发布只发生在本仓库。
