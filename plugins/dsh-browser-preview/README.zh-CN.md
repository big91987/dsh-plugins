# dsh-browser-preview

面向 DeepSeek Harness Web 的 Session 共享浏览器。它把网页作为右侧预览面板显示，Agent 和用户操作的是同一个 Playwright 页面，避免 `dsh-f12-inspector` 的跨域 iframe、文件树和协议日志挤占预览空间。

## 功能

- Session 顶部提供“浏览器预览”按钮；Agent 调用打开工具时右栏也会自动展开。
- 右栏只保留后退、前进、刷新、地址栏、标注、最大化和关闭，不显示文件浏览器、编辑器或调试日志。
- 可以直接点击、滚动和键盘输入；浏览器实际运行在 DSH Host，因此通过 ngrok 打开 DSH 时也能访问 Host 所在机器的 localhost 页面。
- 每个 Session 使用独立页面，不会把不同任务的登录态和导航混在一起。
- 标注模式点击网页元素，填写意见后会把 URL、CSS selector、文本和位置加入当前 Session 输入框。
- Agent 工具 `browser_preview_open`、`browser_preview_snapshot`、`browser_preview_inspect`、`browser_preview_close` 操作同一页面；截图通过 DSH Attachment 服务持久化后交给多模态模型。

## 安装

在仓库根目录构建并加入 `web` Profile：

```sh
pnpm install --frozen-lockfile
pnpm --dir plugins/dsh-browser-preview build
npx @deepseek-ai/dsh@0.1.1-rc.2 plugin --profile web add ./plugins/dsh-browser-preview
npx @deepseek-ai/dsh@0.1.1-rc.2 web
```

安装后刷新已经打开的 DSH 页面。首次打开预览时，插件会尝试使用本机 Chrome、Chromium 或 Edge；也可以在插件配置中设置 `executablePath`。

如果装过旧的 F12 Inspector，验收新插件后再卸载，避免两个网页工具同时出现在界面中：

```sh
npx @deepseek-ai/dsh@0.1.1-rc.2 plugin --profile web remove dsh-f12-inspector
```

卸载不会删除 DSH Session。插件关闭或卸载时只会结束它自己创建的临时浏览器 Context。

## 使用

手工使用：打开一个 Session，点击标题栏的圆形浏览器按钮，在地址栏输入 `localhost:端口` 或完整 URL。点击右上角 `↗` 可最大化；点击铅笔进入元素标注模式。

Agent 使用示例：

```text
在右侧浏览器打开 http://127.0.0.1:3000，检查当前页面。
```

```text
截取当前浏览器页面并检查布局问题。
```

## 与 Codex 的差异

行为目标参考 Codex Desktop 的共享内置浏览器，但 Codex Desktop 的界面源码不在公开的 `openai/codex` 仓库中，因此本插件是基于公开产品行为和 DSH 扩展接口重新实现，不是复制其私有 UI 源码。

DSH `0.1.1-rc.2` 的右侧详情栏是单占用 Slot，没有“按状态临时替换详情内容”的公开扩展点。本插件使用官方 Session 头部 Slot 添加入口，并在浏览器激活期间把自己的面板投影到现有详情列；关闭后官方工具详情恢复。这个兼容层需要在 DSH 客户端升级后重新验证。

网页不是 iframe，而是 Host 端独立浏览器的 CDP screencast。这解决了 `X-Frame-Options`、CSP 和跨域页面无法注入检查脚本的问题，但视频、高帧率动画和复杂拖拽的体验仍不如本地浏览器原生标签页。
