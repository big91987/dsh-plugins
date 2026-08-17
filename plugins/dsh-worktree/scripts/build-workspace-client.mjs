import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const OFFICIAL_SHA256 = '7579ea4578750df71309dcf4881cf588aced13cf8137273a2c308a29bceb6464'

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
    `\t\tvar exports = module.exports;\n${remoteBundle}\n\t\tconst DSH_WORKTREE_REMOTE = DSHWorktreeRemoteBundle.default ?? DSHWorktreeRemoteBundle;\n\t\tlet continueInNewChat;\n\t\tlet continueInNewWorktree;\n`,
    'module prelude',
  )
  output = replaceOnce(
    output,
    '\t\tlet continueInNewWorktree;\n',
    `\t\tlet continueInNewWorktree;
\t\tlet worktreeRemote;
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
\t\t\tconst refresh = (0, react.useCallback)(() => {
\t\t\t\tif (worktreeRemote === void 0) return Promise.resolve();
\t\t\t\treturn worktreeRemote.listPending().then((result) => {
\t\t\t\t\tif (!result.ok) throw new Error(result.error.message);
\t\t\t\t\tsetItems(result.value);
\t\t\t\t});
\t\t\t}, []);
\t\t\t(0, react.useEffect)(() => {
\t\t\t\tlet disposed = false;
\t\t\t\tconst poll = () => { refresh().catch((reason) => {
\t\t\t\t\tif (!disposed) console.warn("pending Worktree refresh rejected:", reason);
\t\t\t\t}); };
\t\t\t\tpoll();
\t\t\t\tconst timer = window.setInterval(poll, 500);
\t\t\t\treturn () => { disposed = true; window.clearInterval(timer); };
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
  output = replaceOnce(
    output,
    `\t\t\t\t{\n\t\t\t\t\tid: "fork",\n\t\t\t\t\tlabel: t("menu.fork"),\n\t\t\t\t\ticon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBranchOutline16, {})\n\t\t\t\t},`,
    `\t\t\t\t{\n\t\t\t\t\tid: "continue-chat",\n\t\t\t\t\tlabel: t("menu.continueChat"),\n\t\t\t\t\ticon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBranchOutline16, {})\n\t\t\t\t},\n\t\t\t\t{\n\t\t\t\t\tid: "continue-worktree",\n\t\t\t\t\tlabel: t("menu.continueWorktree"),\n\t\t\t\t\ticon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderClose16, {})\n\t\t\t\t},`,
    'Fork menu item',
  )
  output = replaceOnce(
    output,
    '\t\t\tconst [menuOpen, setMenuOpen] = (0, react.useState)(false);\n\t\t\tconst sessionMenuItems = [',
    '\t\t\tconst [menuOpen, setMenuOpen] = (0, react.useState)(false);\n\t\t\tconst [contextMenuPoint, setContextMenuPoint] = (0, react.useState)(null);\n\t\t\tconst sessionMenuItems = [',
    'Session context-menu anchor state',
  )
  output = replaceOnce(
    output,
    '\t\t\tconst workspaces = useWorkspaces((state) => state.items);',
    '\t\t\tconst rawWorkspaces = useWorkspaces((state) => state.items);\n\t\t\tconst worktreeMappings = useWorktreeMappings();\n\t\t\tconst workspaces = (0, react.useMemo)(() => projectWorktreeWorkspaces(rawWorkspaces, worktreeMappings), [rawWorkspaces, worktreeMappings]);',
    'Workspace Worktree projection',
  )
  output = replaceOnce(
    output,
    '\t\t\t\tconst members = [];\n\t\t\t\tfor (const id of workspace.sessionIds) {',
    '\t\t\t\tconst members = [];\n\t\t\t\tconst worktreeSessionIds = new Set(workspace.worktreeSessionIds ?? []);\n\t\t\t\tfor (const id of workspace.sessionIds) {',
    'group Worktree identity set',
  )
  output = replaceOnce(
    output,
    '\t\t\t\t\tmembers.push(summary);',
    '\t\t\t\t\tmembers.push(worktreeSessionIds.has(id) ? { ...summary, worktree: true } : summary);',
    'group Worktree Session marker',
  )
  output = replaceOnce(
    output,
    '\t\t\t\tcompleted: s.completed === true,\n\t\t\t\tupdatedAt: s.updatedAt,',
    '\t\t\t\tcompleted: s.completed === true,\n\t\t\t\tworktree: s.worktree === true,\n\t\t\t\tupdatedAt: s.updatedAt,',
    'derived Worktree Session marker',
  )
  output = replaceOnce(
    output,
    '\t\tfunction deriveFlat(list, archivedSessionIds) {\n\t\t\tconst archived = new Set(archivedSessionIds);\n\t\t\tconst descendants = (0, _deepseek_ai_dsh_client_runtime_client.indexSubagentDescendants)(list.byId);',
    '\t\tfunction deriveFlat(list, archivedSessionIds, workspaces) {\n\t\t\tconst archived = new Set(archivedSessionIds);\n\t\t\tconst descendants = (0, _deepseek_ai_dsh_client_runtime_client.indexSubagentDescendants)(list.byId);\n\t\t\tconst worktreeSessionIds = new Set(workspaces.flatMap((workspace) => workspace.worktreeSessionIds ?? []));',
    'flat Worktree Session identity',
  )
  output = replaceOnce(
    output,
    '\t\t\t\trows.push(s);\n\t\t\t}\n\t\t\trows.sort(byRecency);',
    '\t\t\t\trows.push(worktreeSessionIds.has(id) ? { ...s, worktree: true } : s);\n\t\t\t}\n\t\t\trows.sort(byRecency);',
    'flat Worktree Session marker',
  )
  output = replaceOnce(
    output,
    '\t\tfunction FlatList({ useSessions, open, forkSession, onSessionRename, onSessionArchive, archivedSessionIds, orderBy, sessionOrderByAccount, sessionUpdatedAtByAccount, syncSessionOrderAccount, setSessionOrder, t }) {\n\t\t\tconst list = useSessions((s) => s);\n\t\t\tconst baseRows = (0, react.useMemo)(() => deriveFlat(list, archivedSessionIds), [list, archivedSessionIds]);',
    '\t\tfunction FlatList({ useSessions, open, forkSession, onSessionRename, onSessionArchive, archivedSessionIds, workspaces, orderBy, sessionOrderByAccount, sessionUpdatedAtByAccount, syncSessionOrderAccount, setSessionOrder, t }) {\n\t\t\tconst list = useSessions((s) => s);\n\t\t\tconst baseRows = (0, react.useMemo)(() => deriveFlat(list, archivedSessionIds, workspaces), [list, archivedSessionIds, workspaces]);',
    'flat Worktree projection input',
  )
  output = replaceOnce(
    output,
    '\t\t\t\t\t\t\tarchivedSessionIds,\n\t\t\t\t\t\t\torderBy,',
    '\t\t\t\t\t\t\tarchivedSessionIds,\n\t\t\t\t\t\t\tworkspaces,\n\t\t\t\t\t\t\torderBy,',
    'flat Worktree Workspace prop',
  )
  output = replaceOnce(
    output,
    `\t\t\t\t\tonClick: () => {\n\t\t\t\t\t\tonOpen(node.id);\n\t\t\t\t\t},`,
    `\t\t\t\t\tonClick: () => {\n\t\t\t\t\t\tonOpen(node.id);\n\t\t\t\t\t},
\t\t\t\t\tonContextMenu: (e) => {
\t\t\t\t\t\tif (row.blank) return;
\t\t\t\t\t\te.preventDefault();
\t\t\t\t\t\te.stopPropagation();
\t\t\t\t\t\tsetContextMenuPoint(new DOMRect(e.clientX, e.clientY, 0, 0));
\t\t\t\t\t\tsetMenuOpen(true);
\t\t\t\t\t},`,
    'Session row context-menu handler',
  )
  output = replaceOnce(
    output,
    '\t\t\t\t\t\t\t\tportal: true,\n\t\t\t\t\t\t\t\tcloseOnPointerLeave: true,',
    '\t\t\t\t\t\t\t\tportal: true,\n\t\t\t\t\t\t\t\tgetAnchorRect: contextMenuPoint === null ? void 0 : () => contextMenuPoint,\n\t\t\t\t\t\t\t\tcloseOnPointerLeave: true,',
    'Session context-menu cursor anchor',
  )
  output = replaceOnce(
    output,
    '\t\t\t\t\t\t\t\t\t\te.stopPropagation();\n\t\t\t\t\t\t\t\t\t\tsetMenuOpen((v) => !v);',
    '\t\t\t\t\t\t\t\t\t\te.stopPropagation();\n\t\t\t\t\t\t\t\t\t\tsetContextMenuPoint(null);\n\t\t\t\t\t\t\t\t\t\tsetMenuOpen((v) => !v);',
    'Session overflow anchor reset',
  )
  output = replaceOnce(
    output,
    `\t\t\t\t\t\t(0, react_jsx_runtime.jsx)("span", {
\t\t\t\t\t\t\tclassName: Rows_module_css_default.title,
\t\t\t\t\t\t\tchildren: title
\t\t\t\t\t\t}),`,
    `\t\t\t\t\t\t(0, react_jsx_runtime.jsx)("span", {
\t\t\t\t\t\t\tclassName: Rows_module_css_default.title,
\t\t\t\t\t\t\tchildren: title
\t\t\t\t\t\t}),
\t\t\t\t\t\trow.worktree && (0, react_jsx_runtime.jsx)("span", {
\t\t\t\t\t\t\t"aria-label": t("session.worktree"),
\t\t\t\t\t\t\ttitle: t("session.worktree"),
\t\t\t\t\t\t\tstyle: { display: "inline-flex", flex: "none", marginInlineEnd: "6px", opacity: .65 },
\t\t\t\t\t\t\tchildren: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBranchOutline16, { size: 13 })
\t\t\t\t\t\t}),`,
    'Worktree Session indicator',
  )
  output = replaceOnce(
    output,
    '\t\t\t\t\t\t\t\t\tif (id === "fork") onFork(node.id);',
    '\t\t\t\t\t\t\t\t\tif (id === "continue-chat") continueInNewChat?.(node.id);\n\t\t\t\t\t\t\t\t\tif (id === "continue-worktree") continueInNewWorktree?.(node.id);',
    'Fork menu handler',
  )
  output = replaceOnce(
    output,
    '\t\t\t"menu.fork": "分叉会话",',
    '\t\t\t"menu.continueChat": "在新聊天中继续",\n\t\t\t"menu.continueWorktree": "在新工作树中继续",',
    'Chinese Fork label',
  )
  output = replaceOnce(
    output,
    '\t\t\t"delete.pending": "正在删除工作区…",',
    `\t\t\t"delete.pending": "正在删除工作区…",
\t\t\t"pending.stage.queued": "工作树等待创建",
\t\t\t"pending.stage.creating": "正在创建工作树",
\t\t\t"pending.stage.setting-up": "正在初始化工作树",
\t\t\t"pending.stage.worktree-ready": "工作树已就绪",
\t\t\t"pending.stage.published": "新工作树聊天已就绪",
\t\t\t"pending.stage.failed": "工作树创建失败",
\t\t\t"pending.stage.cancelled": "工作树创建已取消",
\t\t\t"pending.source": "来源会话：{id}",
\t\t\t"pending.output.truncated": "较早输出已截断",
\t\t\t"pending.action.cancel": "取消",
\t\t\t"pending.action.retry": "重试",
\t\t\t"pending.action.continueWithoutSetup": "忽略初始化错误并继续",
\t\t\t"pending.action.dismiss": "关闭",
\t\t\t"session.worktree": "工作树会话",`,
    'Chinese pending labels',
  )
  output = replaceOnce(
    output,
    '\t\t\t"menu.fork": "Fork session",',
    '\t\t\t"menu.continueChat": "Continue in new chat",\n\t\t\t"menu.continueWorktree": "Continue in new worktree",',
    'English Fork label',
  )
  output = replaceOnce(
    output,
    '\t\t\t"delete.pending": "Deleting workspace…",',
    `\t\t\t"delete.pending": "Deleting workspace…",
\t\t\t"pending.stage.queued": "Worktree queued",
\t\t\t"pending.stage.creating": "Creating worktree",
\t\t\t"pending.stage.setting-up": "Setting up worktree",
\t\t\t"pending.stage.worktree-ready": "Worktree ready",
\t\t\t"pending.stage.published": "New worktree chat ready",
\t\t\t"pending.stage.failed": "Worktree creation failed",
\t\t\t"pending.stage.cancelled": "Worktree creation cancelled",
\t\t\t"pending.source": "Source session: {id}",
\t\t\t"pending.output.truncated": "Earlier output truncated",
\t\t\t"pending.action.cancel": "Cancel",
\t\t\t"pending.action.retry": "Retry",
\t\t\t"pending.action.continueWithoutSetup": "Continue without setup",
\t\t\t"pending.action.dismiss": "Dismiss",
\t\t\t"session.worktree": "Worktree session",`,
    'English pending labels',
  )
  output = replaceOnce(
    output,
    '\t\t\t\t\t!wide && (0, react_jsx_runtime.jsx)("div", {',
    `\t\t\t\t\t(0, react_jsx_runtime.jsx)(PendingWorktrees, { open, t, visible: wide }),
\t\t\t\t\t!wide && (0, react_jsx_runtime.jsx)("div", {`,
    'pending Worktree panel',
  )
  output = replaceOnce(
    output,
    '\t\tfunction apply(ctx) {\n',
    `\t\tasync function apply(ctx) {\n\t\t\tconst disposeWorktreeRemote = await ctx.remote.$mount(DSH_WORKTREE_REMOTE);\n\t\t\tcontinueInNewChat = (sessionId) => {\n\t\t\t\tctx.remote.dshWorktree.continueInChat({ sourceSessionId: sessionId }).then((result) => {\n\t\t\t\t\tif (!result.ok) throw new Error(result.error.message);\n\t\t\t\t\tctx.sessions.open(result.value.sessionId);\n\t\t\t\t}).catch((reason) => { console.warn("continue in new chat rejected:", reason); });\n\t\t\t};\n\t\t\tcontinueInNewWorktree = (sessionId) => {\n\t\t\t\tctx.remote.dshWorktree.continueInWorktree({ sourceSessionId: sessionId }).then((result) => {\n\t\t\t\t\tif (!result.ok) throw new Error(result.error.message);\n\t\t\t\t\tautoOpenPendingIds.add(result.value.pendingSessionId);\n\t\t\t\t}).catch((reason) => { console.warn("continue in new worktree rejected:", reason); });\n\t\t\t};\n`,
    'apply declaration',
  )
  output = replaceOnce(
    output,
    '\t\t\tconst disposeWorktreeRemote = await ctx.remote.$mount(DSH_WORKTREE_REMOTE);\n',
    '\t\t\tconst disposeWorktreeRemote = await ctx.remote.$mount(DSH_WORKTREE_REMOTE);\n\t\t\tworktreeRemote = ctx.get("remote.dshWorktree");\n\t\t\tif (worktreeRemote === void 0) throw new Error("dsh-worktree Remote namespace did not mount");\n\t\t\tawait refreshWorktreeMappings();\n',
    'mounted Remote lookup',
  )
  output = replaceOnce(
    output,
    'ctx.remote.dshWorktree.continueInChat',
    'worktreeRemote.continueInChat',
    'new-chat Remote call',
  )
  output = replaceOnce(
    output,
    'ctx.remote.dshWorktree.continueInWorktree',
    'worktreeRemote.continueInWorktree',
    'Worktree Remote call',
  )
  output = replaceOnce(
    output,
    `\t\t\tctx.slots.inject("conversation.hero.workspace", () => ctx.slots.register({\n\t\t\t\tname: "conversation.hero.workspace",\n\t\t\t\tchildren: { "conversation.hero.workspace.directoryFlow": {\n\t\t\t\t\tkind: "single",\n\t\t\t\t\tscope: "root"\n\t\t\t\t} },\n\t\t\t\tinject: pickerInjected,\n\t\t\t\tlocale: NS\n\t\t\t}, WorkspacePicker));\n\t\t}`,
    `\t\t\tctx.slots.inject("conversation.hero.workspace", () => ctx.slots.register({\n\t\t\t\tname: "conversation.hero.workspace",\n\t\t\t\tchildren: { "conversation.hero.workspace.directoryFlow": {\n\t\t\t\t\tkind: "single",\n\t\t\t\t\tscope: "root"\n\t\t\t\t} },\n\t\t\t\tinject: pickerInjected,\n\t\t\t\tlocale: NS\n\t\t\t}, WorkspacePicker));\n\t\t\treturn async () => {\n\t\t\t\tcontinueInNewChat = void 0;\n\t\t\t\tcontinueInNewWorktree = void 0;\n\t\t\t\tautoOpenPendingIds.clear();\n\t\t\t\tcurrentWorktreeMappings = [];\n\t\t\t\tworktreeMappingListeners.clear();\n\t\t\t\tworktreeRemote = void 0;\n\t\t\t\tawait disposeWorktreeRemote();\n\t\t\t};\n\t\t}`,
    'apply tail',
  )
  output = replaceOnce(
    output,
    `\t\t\t"workspaces",\n\t\t\t"locale"`,
    `\t\t\t"workspaces",\n\t\t\t"locale",\n\t\t\t"remote"`,
    'runtime injection list',
  )
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
