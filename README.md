# dsh-taskmirror

> **Post-task 9-dimension retrospective hook for DeepSeek Harness (DSH)**
>
> 每当一个大任务结束，自动触发 9 维自检，并把复盘沉淀到 `~/.claude/memory/dsh-taskmirror/<sessionId>.md`。

本仓库只提供一个 **hook 脚本**，不含 cordis 插件代码；触发由社区插件
[dsh-hooks](https://github.com/PeterBon/dsh-hooks)（`0.14.4`，配置驱动的生命周期 hooks 引擎）负责。

---

## 工作原理

```
DSH turn 结束
   └─ dsh-hooks 收到 turn/end
        └─ 匹配 when: completed | max-tokens
             └─ spawn: node scripts/taskmirror.mjs   (环境变量携带上下文)
                  ├─ 跳过 subagent / fork / 未知 reason
                  ├─ 同 session 5 分钟 cooldown
                  └─ 写 ~/.claude/memory/dsh-taskmirror/<sessionId>.md
```

上下文通过 `DSH_HOOK_*` 环境变量传入（不拼接进 shell 字符串，防注入）。
脚本只读这些变量、只写一个 markdown 文件，**零 npm 依赖**。

---

## 安装

### 1. 把 dsh-hooks 装进目标 profile

```bash
dsh plugin --profile <profile> add github:PeterBon/dsh-hooks
```

`<profile>` 是 DSH 实际启动的那个（`$DSH_HOME/profiles/<name>`）。
在 DSH Desktop 上，本机是 `desktop`，且 **`desktop` profile 由 Electron 独占管理，
CLI 会拒绝操作它**（`profile "desktop" is managed exclusively by the Electron application`）——
这种情况直接在 profile 目录里跑 pnpm：

```powershell
cd $env:DSH_HOME\profiles\desktop
pnpm add github:PeterBon/dsh-hooks
```

### 2. 放置本脚本

脚本不需要装进 profile 的 `node_modules`（它不是 cordis 插件）。
放到任意稳定路径即可，例如 `~/.agents/skills/dsh-taskmirror/scripts/taskmirror.mjs`。

### 3. 把 hook 配置写进 profile 的 `cordis.patch.yml`

直接复制 [`examples/cordis.patch.yml`](examples/cordis.patch.yml) 的内容。
目标文件是 **`$DSH_HOME/profiles/<profile>/cordis.patch.yml`**。

> ⚠️ **位置最容易搞错。** 本机 `DSH_HOME=D:\dsh-data`，所以真实路径是
> `D:\dsh-data\profiles\desktop\cordis.patch.yml`，**不是** `C:\Users\<你>\.dsh\profiles\...`
> （后者是 CLI 默认 home，若 `DSH_HOME` 被改过就与运行时不是同一个）。
> 用 `dsh` 进程自己的环境变量确认：`DSH_PROFILE_DIR`。

### 三条硬规则（踩过坑才有这版）

| # | 规则 | 原因 |
|---|---|---|
| 1 | dsh-hooks 只进 `dependencies` **不会**自动挂载，必须写 `insert` | DSH 只应用 `dsh.profile.bundles` 里各包自带的 patch |
| 2 | 新增插件必须用**不带 `id` 的 `insert`** | patch 层默认只按 id 覆盖已存在条目；写 `- id: dsh-hooks` 而它不存在时会 warn `entry not found` 并跳过 |
| 3 | `config` 直接写在 insert 行内 | 见规则 2：另起 `- id: dsh-hooks` 块等于覆盖一个不存在的条目 |

（规则来源：`@deepseek-ai/dsh-app-boot/lib/index.js` — insert 分支会把不带 id 的
insert 直接追加到根条目列表。）

---

## 生效与验证

DSH 的 `desktop` profile 声明了 `patchReload: live`，实测改完 `cordis.patch.yml`
后 **DSH 会热加载并挂载，无需重启**；其他 profile 可能需要重启。

三层验证（本仓库的 0.2.0 就是这样验过的）：

```powershell
# 1) 插件是否挂载 + hooks 是否按预期解析
Invoke-RestMethod http://127.0.0.1:19387/dsh-hooks/status | ConvertTo-Json -Depth 4
#    → ok:true, version 0.14.4, hookCount:3, hooks[...] 列出每条 on/when/run

# 2) 是否真的触发过（dsh-hooks 的执行历史）
Get-Content ~\.dsh\dsh-hooks\history.jsonl -Tail 10
#    → {"kind":"run","event":"turn/end","outcome":"spawned",...}
#      {"kind":"run","event":"turn/end","outcome":"exit-0","exitCode":0,"durationMs":88,...}

# 3) 复盘文件是否真的写出来了
Get-ChildItem ~\.claude\memory\dsh-taskmirror\
```

实测记录（2026-10-15，DSH Desktop + desktop profile）：

| 证据 | 结果 |
|---|---|
| `/dsh-hooks/status` | `ok:true`，`version 0.14.4`，`hookCount:3`，三条 hook 与配置一致 |
| `history.jsonl` | `turn/end` → `spawned` → `exit-0`，`durationMs: 88` |
| 复盘文件 | `session-<id>.md`，2518 字节，含 9 维 + turn/reason/cwd 元数据 |
| 触发会话 | 就是当时的会话自身（`DSH_HOOK_SESSION_ID` 与 `DSH_SESSION_ID` 一致） |

---

## 9 维自检内容

- **A** 职责单一性
- **B** 依赖健康度
- **C** 测试完备性
- **D** 改动安全性
- **E** 体积（800 行上限）
- **F** 债台账完整度
- **G** 过程规范度
- **H** 可推广性
- **I** 品牌一致性

## 脚本行为细节

- **跳过**：`DSH_HOOK_SUBAGENT=1`（子代理）、`DSH_HOOK_PARENT_SESSION_ID` 非空（fork）、
  `reason` 不在 `{completed, error, aborted, max-tokens}` 内
- **cooldown**：同 session 5 分钟内只写一次（状态存 `~/.dsh/taskmirror-cooldown.json`）
  —— 状态文件在 `~/.dsh`（脚本固定用它），与 `DSH_HOME` 无关
- **截断**：`DSH_HOOK_CONTENT` 只取前 2000 字符
- **stdout**：成功 `written: <path>`，跳过 `skipped: <原因>` / `cooldown: ...`，失败非零退出

### 可选环境变量（覆盖落盘位置）

| 变量 | 默认值 | 用途 |
|---|---|---|
| `TASKMIRROR_MEMORY_DIR` | `~/.claude/memory/dsh-taskmirror` | 复盘输出目录 |
| `TASKMIRROR_COOLDOWN_FILE` | `~/.dsh/taskmirror-cooldown.json` | cooldown 状态文件 |

主要给测试隔离用，也可以用来把复盘中转到别的目录。

输出文件结构：

```markdown
# TaskMirror 复盘

**生成时间**：2026-10-15T04:50:49.035Z
**session**：<会话标题>
**sessionId**：session-78b6f146-...
**turn**：72
**reason**：completed
**cwd**：D:\setup_temp\product-marketing_new
**duration**：?ms

## 9 维自检
9 维自检：
- A 职责单一性
- ...

## 本轮摘要
<本回合最后一段助手文本，截断 2000 字符>
```

## 测试

```bash
node --test "test/*.spec.mjs"
```

17 个用例，**全部走隔离沙箱**：每个用例通过 `TASKMIRROR_*` 把状态重定向到临时目录，
所以两个 spec 文件可以并行跑而不互相干扰，也**不会读写用户真实的
`~/.claude/memory/dsh-taskmirror/` 与 `~/.dsh/taskmirror-cooldown.json`**
（有一个专门用例断言这一点）。

覆盖：完整路径写入、subagent/fork/未知 reason 跳过、max-tokens/aborted/error 不跳过、
cooldown 命中与互不影响、中文/emoji/换行/超长截断（精确 2000）、空 content 兜底、
空 sessionId、5 路并发、多级目录创建、9 维顺序、沙箱隔离性。

> 注：`node --test test/`（目录形式）在 Node 24 上不被接受，需用 glob 形式。

## 文件清单

```
dsh-taskmirror/
├── package.json               — 无运行时依赖；bin: dsh-taskmirror
├── README.md
├── examples/
│   └── cordis.patch.yml       — 直接复制到 profile 的 hook 配置模板
├── scripts/
│   └── taskmirror.mjs         — 9 维复盘主逻辑（145 行）
└── test/
    ├── helpers.mjs            — 隔离沙箱 + spawn 封装
    ├── plugin.spec.mjs        — 6 个单元用例
    └── stress.spec.mjs        — 11 个压测用例
```

## 局限 / 待办

- **只写文件，不回注上下文**：脚本产出的是给人看的复盘文件，不会作为 reminder
  注入 agent 的下一轮。若要「模型自己执行 9 维自检」，需要 hook 用
  `input: 'stdin'` 取完整上下文，或改走 `agent/turn-starting` 之类的回合边界事件。
- **`duration` 常为空**：本机实测 `DSH_HOOK_DURATION_MS` 未在 `turn/end` 时送达
  （显示 `?ms`），原因待查；其他 `DSH_HOOK_*` 变量正常。
- **profile patch 可能被 GUI 重写**：从 DSH 设置面板改设置时，profile 的
  `cordis.patch.yml` 会被程序改写。实测发生过条目被覆盖，建议改完 GUI 设置后
  回查 insert 块是否还在（`/dsh-hooks/status` 的 `hookCount` 是最快的判据）。
- **`dsh-hooks` CLI 的 profile 路径硬编码为 `~/.dsh`**：其 `dry-run` / `tail` /
  飞书扫码 / Web GUI 保存都读 `~/.dsh/profiles/<name>/cordis.patch.yml`。
  当 `DSH_HOME != ~/.dsh`（本机即是）时，这些工具会看错文件——**运行时以
  `$DSH_HOME/profiles/...` 为准**。

## 引用

- [PeterBon/dsh-hooks](https://github.com/PeterBon/dsh-hooks) — 配置驱动 lifecycle hooks
- [DSH hooks 桥接 Discussion #6786](https://github.com/deepseek-ai/deepseek-harness/discussions/6786) — 已知桥接 bug
- [Discussion #506 agent/turn-starting/aborting](https://github.com/deepseek-ai/deepseek-harness/discussions/506) — 回合边界事件提案

## 协议

MIT
