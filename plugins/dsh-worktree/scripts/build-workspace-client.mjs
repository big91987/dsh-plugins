import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const OFFICIAL_SHA256 = 'e784543780fb8ac7c38c853afd26b9b1713c6907eec2b07eff37461e07bd3be9'

function replaceOnce(source, expected, replacement, label) {
  const first = source.indexOf(expected)
  const last = source.lastIndexOf(expected)
  if (first === -1 || first !== last) {
    throw new Error(`dsh-worktree client build: expected exactly one ${label}`)
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + expected.length)}`
}

/** Fold internal managed-Worktree Workspace rows into their original project row. */
export function projectWorktreeWorkspaces(workspaces, mappings) {
  const workspaceByPath = new Map(workspaces.map(workspace => [workspace.path, workspace]))
  const mappingByWorktreePath = new Map(mappings.map(mapping => [mapping.worktreeWorkspacePath, mapping]))
  const hiddenWorkspaceIds = new Set()
  const mergedBySourceId = new Map()

  for (const mapping of mappings) {
    const worktreeWorkspace = workspaceByPath.get(mapping.worktreeWorkspacePath)
    if (worktreeWorkspace === undefined) continue
    let sourcePath = mapping.sourceWorkspacePath
    const visited = new Set([mapping.worktreeWorkspacePath])
    while (mappingByWorktreePath.has(sourcePath) && !visited.has(sourcePath)) {
      visited.add(sourcePath)
      sourcePath = mappingByWorktreePath.get(sourcePath).sourceWorkspacePath
    }
    const sourceWorkspace = workspaceByPath.get(sourcePath)
    if (sourceWorkspace === undefined || sourceWorkspace.workspaceId === worktreeWorkspace.workspaceId) continue
    hiddenWorkspaceIds.add(worktreeWorkspace.workspaceId)
    const merged = mergedBySourceId.get(sourceWorkspace.workspaceId) ?? {
      sessionIds: new Set(sourceWorkspace.sessionIds),
      worktreeSessionIds: new Set(),
    }
    for (const sessionId of worktreeWorkspace.sessionIds) {
      merged.sessionIds.add(sessionId)
      merged.worktreeSessionIds.add(sessionId)
    }
    mergedBySourceId.set(sourceWorkspace.workspaceId, merged)
  }

  return workspaces.flatMap(workspace => {
    if (hiddenWorkspaceIds.has(workspace.workspaceId)) return []
    const merged = mergedBySourceId.get(workspace.workspaceId)
    return merged === undefined ? [workspace] : [{
      ...workspace,
      sessionIds: [...merged.sessionIds],
      worktreeSessionIds: [...merged.worktreeSessionIds],
    }]
  })
}

/** Poll only after the preceding request settles; disposal never schedules another request. */
export function startWorktreePolling(refresh, onError, timers, delay = 500) {
  let disposed = false
  let timer
  async function poll() {
    try { await refresh() } catch (reason) { if (!disposed) onError(reason) }
    finally { if (!disposed) timer = timers.setTimeout(poll, delay) }
  }
  void poll()
  return () => { disposed = true; if (timer !== undefined) timers.clearTimeout(timer) }
}

export function transformWorkspaceClient(source, remoteBundle) {
  const digest = createHash('sha256').update(source).digest('hex')
  if (digest !== OFFICIAL_SHA256) {
    throw new Error(`dsh-worktree client build: unsupported ui-workspace bundle ${digest}`)
  }
  let output = source
  output = replaceOnce(
    output,
    'id: "@deepseek-ai/dsh-client-ui-workspace",',
    'id: "dsh-worktree",',
    'module id',
  )
  output = replaceOnce(
    output,
    '\t\tvar exports = module.exports;\n',
    `\t\tvar exports = module.exports;\n${remoteBundle}\n\t\tconst DSH_WORKTREE_REMOTE = DSHWorktreeRemoteBundle.default ?? DSHWorktreeRemoteBundle;\n\t\tlet continueInNewWorktree;\n`,
    'module prelude',
  )
  output = replaceOnce(
    output,
    '\t\tlet continueInNewWorktree;\n',
    `\t\tlet continueInNewWorktree;
\t\tlet worktreeRemote;
\t\tlet worktreeWorkspaceSource;
\t\t${startWorktreePolling.toString()}
\t\tconst autoOpenPendingIds = new Set();
\t\tlet currentWorktreeMappings = [];
\t\tconst worktreeMappingListeners = new Set();
\t\t${projectWorktreeWorkspaces.toString()}
\t\tfunction subscribeWorktreeMappings(listener) {
\t\t\tworktreeMappingListeners.add(listener);
\t\t\treturn () => { worktreeMappingListeners.delete(listener); };
\t\t}
\t\tfunction refreshWorktreeMappings() {
\t\t\tif (worktreeRemote === void 0) return Promise.resolve();
\t\t\treturn worktreeRemote.listWorkspaceMappings().then((result) => {
\t\t\t\tif (!result.ok) throw new Error(result.error.message);
\t\t\t\tcurrentWorktreeMappings = result.value;
\t\t\t\tfor (const listener of worktreeMappingListeners) listener();
\t\t\t});
\t\t}
\t\tfunction useWorktreeMappings() {
\t\t\treturn (0, react.useSyncExternalStore)(subscribeWorktreeMappings, () => currentWorktreeMappings);
\t\t}
\t\tconst PENDING_ACTIVE_STAGES = new Set(["queued", "creating", "setting-up", "worktree-ready"]);
\t\tconst PENDING_STYLE = {
\t\t\tlist: { display: "grid", gap: "8px", padding: "8px 12px", overflow: "auto", maxHeight: "40vh" },
\t\t\tcard: { display: "grid", gap: "6px", padding: "10px", border: "1px solid var(--border-subtle, rgba(127,127,127,.28))", borderRadius: "8px", fontSize: "12px" },
\t\t\ttitle: { fontWeight: 600 },
\t\t\tsource: { opacity: .65, overflow: "hidden", textOverflow: "ellipsis" },
\t\t\terror: { color: "var(--text-danger, #d44)" },
\t\t\toutput: { margin: 0, padding: "8px", maxHeight: "120px", overflow: "auto", whiteSpace: "pre-wrap", background: "rgba(127,127,127,.1)", borderRadius: "6px" },
\t\t\tactions: { display: "flex", gap: "6px", flexWrap: "wrap" }
\t\t};
\t\tfunction PendingWorktrees({ open, t, visible }) {
\t\t\tconst [items, setItems] = (0, react.useState)([]);
\t\t\tconst opened = (0, react.useRef)(new Set());
\t\t\tconst alive = (0, react.useRef)(false);
\t\t\tconst refresh = (0, react.useCallback)(() => {
\t\t\t\tif (worktreeRemote === void 0) return Promise.resolve();
\t\t\t\treturn worktreeRemote.listPending().then((result) => {
\t\t\t\t\tif (!result.ok) throw new Error(result.error.message);
\t\t\t\t\tif (alive.current) setItems(result.value);
\t\t\t\t});
\t\t\t}, []);
\t\t\t(0, react.useEffect)(() => {
\t\t\t\talive.current = true;
\t\t\t\tconst stop = startWorktreePolling(refresh, (reason) => { console.warn("pending Worktree refresh rejected:", reason); }, window);
\t\t\t\treturn () => { alive.current = false; stop(); };
\t\t\t}, [refresh]);
\t\t\t(0, react.useEffect)(() => {
\t\t\t\tfor (const item of items) {
\t\t\t\t\tif (item.stage !== "published" || item.sessionId === void 0 || !autoOpenPendingIds.has(item.id) || opened.current.has(item.id)) continue;
\t\t\t\t\topened.current.add(item.id);
\t\t\t\t\tautoOpenPendingIds.delete(item.id);
\t\t\t\t\trefreshWorktreeMappings().then(() => {
\t\t\t\t\t\topen(item.sessionId);
\t\t\t\t\t\treturn worktreeRemote.dismissPending(item.id);
\t\t\t\t\t}).then((result) => {
\t\t\t\t\t\tif (!result.ok) throw new Error(result.error.message);
\t\t\t\t\t\treturn refresh();
\t\t\t\t\t}).catch((reason) => { console.warn("published Worktree open rejected:", reason); });
\t\t\t\t}
\t\t\t}, [items, open, refresh]);
\t\t\tif (!visible || items.length === 0) return null;
\t\t\tconst run = (action) => {
\t\t\t\tif (worktreeRemote === void 0) return;
\t\t\t\tPromise.resolve(action()).then((result) => {
\t\t\t\t\tif (!result.ok) throw new Error(result.error.message);
\t\t\t\t\treturn refresh();
\t\t\t\t}).catch((reason) => { console.warn("pending Worktree action rejected:", reason); });
\t\t\t};
\t\t\treturn (0, react_jsx_runtime.jsx)("div", {
\t\t\t\tstyle: PENDING_STYLE.list,
\t\t\t\trole: "status",
\t\t\t\tchildren: items.map((item) => {
\t\t\t\t\tconst output = [item.setupOutput.stdout, item.setupOutput.stderr].filter((part) => part.text !== "");
\t\t\t\t\tconst actions = [];
\t\t\t\t\tif (PENDING_ACTIVE_STAGES.has(item.stage)) actions.push((0, react_jsx_runtime.jsx)("button", { type: "button", onClick: () => { run(() => worktreeRemote.cancelPending(item.id)); }, children: t("pending.action.cancel") }, "cancel"));
\t\t\t\t\tif (item.stage === "failed") {
\t\t\t\t\t\tactions.push((0, react_jsx_runtime.jsx)("button", { type: "button", onClick: () => { run(() => worktreeRemote.retryPending({ id: item.id })); }, children: t("pending.action.retry") }, "retry"));
\t\t\t\t\t\tif (item.failureKind === "setup" && item.worktree !== void 0) actions.push((0, react_jsx_runtime.jsx)("button", { type: "button", onClick: () => { run(() => worktreeRemote.continuePendingWithoutSetup(item.id)); }, children: t("pending.action.continueWithoutSetup") }, "continue"));
\t\t\t\t\t\tactions.push((0, react_jsx_runtime.jsx)("button", { type: "button", onClick: () => { run(() => worktreeRemote.dismissPending(item.id)); }, children: t("pending.action.dismiss") }, "dismiss"));
\t\t\t\t\t}
\t\t\t\t\tif (item.stage === "cancelled") actions.push((0, react_jsx_runtime.jsx)("button", { type: "button", onClick: () => { run(() => worktreeRemote.dismissPending(item.id)); }, children: t("pending.action.dismiss") }, "dismiss"));
\t\t\t\t\treturn (0, react_jsx_runtime.jsxs)("section", {
\t\t\t\t\t\tstyle: PENDING_STYLE.card,
\t\t\t\t\t\tchildren: [
\t\t\t\t\t\t\t(0, react_jsx_runtime.jsx)("div", { style: PENDING_STYLE.title, children: t(\`pending.stage.\${item.stage}\`) }),
\t\t\t\t\t\t\t(0, react_jsx_runtime.jsx)("div", { style: PENDING_STYLE.source, children: t("pending.source", { id: item.sourceSessionId }) }),
\t\t\t\t\t\t\titem.error !== void 0 && (0, react_jsx_runtime.jsx)("div", { style: PENDING_STYLE.error, children: item.error }),
\t\t\t\t\t\t\toutput.length > 0 && (0, react_jsx_runtime.jsx)("pre", { style: PENDING_STYLE.output, children: output.map((part, index) => (0, react_jsx_runtime.jsx)("span", { children: [part.truncated ? \`\${t("pending.output.truncated")}\\n\` : "", part.text] }, index)) }),
\t\t\t\t\t\t\t(0, react_jsx_runtime.jsx)("div", { style: PENDING_STYLE.actions, children: actions })
\t\t\t\t\t\t]
\t\t\t\t\t}, item.id);
\t\t\t\t})
\t\t\t});
\t\t}
`,
    'pending Worktree component',
  )
  output = replaceOnce(output,
    '\t\t\tconst workspaces = ctx.get("workspaces");',
    '\t\t\tconst workspaces = ctx.get("workspaces");\n\t\t\tworktreeWorkspaceSource = workspaces.list;\n\t\t\tctx.effect(() => workspaces.list.subscribe(() => { currentWorktreeMappings = [...currentWorktreeMappings]; for (const listener of worktreeMappingListeners) listener(); }));',
    'Worktree marker Workspace source');
  output = replaceOnce(output,
    '\t\t\tconst storedWorkspaces = useWorkspaces((state) => state.items);',
    '\t\t\tconst rawWorkspaces = useWorkspaces((state) => state.items);\n\t\t\tconst worktreeMappings = useWorktreeMappings();\n\t\t\tconst storedWorkspaces = (0, react.useMemo)(() => projectWorktreeWorkspaces(rawWorkspaces, worktreeMappings), [rawWorkspaces, worktreeMappings]);',
    'Workspace Worktree projection');
  output = replaceOnce(output,
    '\t\t\tconst [menuOpen, setMenuOpen] = (0, react.useState)(false);\n\t\t\tconst menuOpenState =',
    '\t\t\tconst [menuOpen, setMenuOpen] = (0, react.useState)(false);\n\t\t\tconst [contextMenuPoint, setContextMenuPoint] = (0, react.useState)(null);\n\t\t\tconst mappings = useWorktreeMappings();\n\t\t\tconst worktree = mappings.some((mapping) => worktreeWorkspaceSource?.getSnapshot().items.some((workspace) => workspace.path === mapping.worktreeWorkspacePath && workspace.sessionIds.includes(node.id)));\n\t\t\tconst menuOpenState =',
    'Session context-menu and Worktree state');
  output = replaceOnce(output,
    '\t\t\t\t\tonClick: () => {\n\t\t\t\t\t\tonOpen(node.id);\n\t\t\t\t\t},',
    '\t\t\t\t\tonClick: () => {\n\t\t\t\t\t\tonOpen(node.id);\n\t\t\t\t\t},\n\t\t\t\t\tonContextMenu: (e) => {\n\t\t\t\t\t\tif (row.blank) return;\n\t\t\t\t\t\te.preventDefault();\n\t\t\t\t\t\te.stopPropagation();\n\t\t\t\t\t\tsetContextMenuPoint(new DOMRect(e.clientX, e.clientY, 0, 0));\n\t\t\t\t\t\tsetMenuOpen(true);\n\t\t\t\t\t},',
    'Session row context-menu handler');
  output = replaceOnce(output,
    '\t\t\t\t\t\t\t\tportal: true,\n\t\t\t\t\t\t\t\tcloseOnPointerLeave: true,',
    '\t\t\t\t\t\t\t\tportal: true,\n\t\t\t\t\t\t\t\tgetAnchorRect: contextMenuPoint === null ? void 0 : () => contextMenuPoint,\n\t\t\t\t\t\t\t\tcloseOnPointerLeave: true,',
    'Session context-menu cursor anchor');
  output = replaceOnce(output,
    '\t\t\t\t\t\t\t\t\tonClick: () => {\n\t\t\t\t\t\t\t\t\t\tsetMenuOpen((v) => !v);',
    '\t\t\t\t\t\t\t\t\tonClick: () => {\n\t\t\t\t\t\t\t\t\t\tsetContextMenuPoint(null);\n\t\t\t\t\t\t\t\t\t\tsetMenuOpen((v) => !v);',
    'Session overflow anchor reset');
  output = replaceOnce(output,
    '\t\t\t\t\t\t\tchildren: title\n\t\t\t\t\t\t}),',
    '\t\t\t\t\t\t\tchildren: title\n\t\t\t\t\t\t}),\n\t\t\t\t\t\tworktree && (0, react_jsx_runtime.jsx)("span", { "aria-label": t("session.worktree"), title: t("session.worktree"), style: { display: "inline-flex", flex: "none", marginInlineEnd: "6px", opacity: .65 }, children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBranchOutlineRegular, { size: 13 }) }),',
    'Worktree Session indicator');
  output = replaceOnce(output,
    '\t\tfunction apply(ctx) {\n',
    `\t\tfunction ContinueWorktreeMenuItem({ sessionId, useMenuOpenState, continueInWorktree, t }) {
\t\t\tconst [, setMenuOpen] = useMenuOpenState();
\t\t\treturn (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MenuItemButton, {
\t\t\t\ticon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBranchOutlineRegular, {}),
\t\t\t\tonSelect: () => { setMenuOpen(false); continueInWorktree(sessionId); },
\t\t\t\tchildren: t("menu.continueWorktree")
\t\t\t});
\t\t}
\t\tasync function apply(ctx) {
\t\t\tconst disposeWorktreeRemote = await ctx.remote.$mount(DSH_WORKTREE_REMOTE);
\t\t\tworktreeRemote = ctx.get("remote.dshWorktree");
\t\t\tif (worktreeRemote === void 0) throw new Error("dsh-worktree Remote namespace did not mount");
\t\t\tawait refreshWorktreeMappings();
\t\t\tcontinueInNewWorktree = (sessionId) => {
\t\t\t\tworktreeRemote.continueInWorktree({ sourceSessionId: sessionId }).then((result) => {
\t\t\t\t\tif (!result.ok) throw new Error(result.error.message);
\t\t\t\t\tautoOpenPendingIds.add(result.value.pendingSessionId);
\t\t\t\t}).catch((reason) => { console.warn("continue in new worktree rejected:", reason); });
\t\t\t};
\t\t\tctx.on("connection/reset", () => { refreshWorktreeMappings().catch((reason) => console.warn("Worktree mapping refresh rejected:", reason)); });
\t\t\tctx.slots.inject("sidebar.workspaces.session.menu.item", () => ctx.slots.register({
\t\t\t\tname: "sidebar.workspaces.session.menu.item", id: "continue-worktree", order: 350, locale: NS,
\t\t\t\tinject: () => ({ continueInWorktree: continueInNewWorktree })
\t\t\t}, ContinueWorktreeMenuItem));
`,
    'mounted Remote and Worktree menu contribution');
  output = replaceOnce(output,
    '\t\t\t\tclassName: clsx(WorkspaceBrowser_module_css_default.root, !wide && WorkspaceBrowser_module_css_default.rail),\n\t\t\t\tchildren: [',
    '\t\t\t\tclassName: clsx(WorkspaceBrowser_module_css_default.root, !wide && WorkspaceBrowser_module_css_default.rail),\n\t\t\t\tchildren: [\n\t\t\t\t\t(0, react_jsx_runtime.jsx)(PendingWorktrees, { open, t, visible: wide }),',
    'pending Worktree panel');
  for (const [language, labels] of Object.entries({
    zh: { 'menu.continueWorktree': '在新工作树中继续', 'session.worktree': '工作树会话', 'pending.stage.queued': '工作树等待创建', 'pending.stage.creating': '正在创建工作树', 'pending.stage.setting-up': '正在初始化工作树', 'pending.stage.worktree-ready': '工作树已就绪', 'pending.stage.published': '新工作树聊天已就绪', 'pending.stage.failed': '工作树创建失败', 'pending.stage.cancelled': '工作树创建已取消', 'pending.source': '来源会话：{id}', 'pending.output.truncated': '较早输出已截断', 'pending.action.cancel': '取消', 'pending.action.retry': '重试', 'pending.action.continueWithoutSetup': '忽略初始化错误并继续', 'pending.action.dismiss': '关闭' },
    en: { 'menu.continueWorktree': 'Continue in new worktree', 'session.worktree': 'Worktree session', 'pending.stage.queued': 'Worktree queued', 'pending.stage.creating': 'Creating worktree', 'pending.stage.setting-up': 'Setting up worktree', 'pending.stage.worktree-ready': 'Worktree ready', 'pending.stage.published': 'New worktree chat ready', 'pending.stage.failed': 'Worktree creation failed', 'pending.stage.cancelled': 'Worktree creation cancelled', 'pending.source': 'Source session: {id}', 'pending.output.truncated': 'Earlier output truncated', 'pending.action.cancel': 'Cancel', 'pending.action.retry': 'Retry', 'pending.action.continueWithoutSetup': 'Continue without setup', 'pending.action.dismiss': 'Dismiss' },
  })) {
    const anchor = `\t\t\t"menu.fork": "${language === 'zh' ? '分叉会话' : 'Fork session'}",`;
    output = replaceOnce(output, anchor, `${anchor}\n${Object.entries(labels).map(([key, value]) => `\t\t\t${JSON.stringify(key)}: ${JSON.stringify(value)},`).join('\n')}`, `${language} Worktree labels`);
  }
  output = replaceOnce(output,
    '\t\t\t}, WorkspacePicker));\n\t\t}',
    `\t\t\t}, WorkspacePicker));
\t\t\treturn async () => {
\t\t\t\tcontinueInNewWorktree = void 0;
\t\t\t\tautoOpenPendingIds.clear();
\t\t\t\tcurrentWorktreeMappings = [];
\t\t\t\tworktreeMappingListeners.clear();
\t\t\t\tworktreeRemote = void 0;
\t\t\t\tworktreeWorkspaceSource = void 0;
\t\t\t\tawait disposeWorktreeRemote();
\t\t\t};
\t\t}`, 'Worktree Remote cleanup');
  return output
}

async function main() {
  const here = dirname(fileURLToPath(import.meta.url))
  const require = createRequire(import.meta.url)
  const officialPath = require.resolve('@deepseek-ai/dsh-client-ui-workspace/client')
  const remoteBundle = readFileSync(resolve(here, '../lib/typert.remote-browser.iife.js'), 'utf8')
  const transformed = transformWorkspaceClient(readFileSync(officialPath, 'utf8'), remoteBundle)
  writeFileSync(resolve(here, '../lib/client.js'), transformed)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
