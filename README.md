# dsh-taskmirror

> ⚠️ **本项目已降级为实验产物，不再作为复盘方案。**

## 为什么作废

公司知识库里**已有正式且更完整的复盘方案**：

| | 本仓库（作废） | 知识库《耗时复盘规范》（正式） |
|---|---|---|
| 权威出处 | ❌ 无——9 维维度是自拟的，引用的来源文件在本机不存在 | ✅ owner: 暗宇宙，权威等级: 权威 |
| 复盘口径 | 代码质量 9 维 | **四段耗时拆解**（模型思考/工具执行/等你回复/其他）+ 收尾门禁 + 标准沉淀闭环 |
| 实现 | 本仓库 2 个脚本 | `D:\claude-code\hooks\task-timing.mjs`（58KB，30 例测试，已适配 DSH 多帧 zstd 日志） |
| 报告 | 一份 markdown 清单 | `latest.md` / `history.jsonl` / `PLAYBOOK.md` |
| 触发 | 钩子 | 钩子（同机制，但踩过的坑都已处理） |

**规范位置**：`D:\暗宇宙\knowledge\content\engineering\guides\耗时复盘规范.md`

## 现在的做法（只用全局规则，不用钩子）

在 **`$DSH_HOME/AGENTS.md`** 写一行即可：

```markdown
**大任务执行结束后，必须先去知识库读《耗时复盘规范》，并按其实施复盘。**
规范位置：`<知识库>/content/engineering/guides/耗时复盘规范.md`
```

要点：
- **不挂钩子、不额外注入**——规则只写「去读哪个文档 + 照着做」。
- 规范是**单一真相源**：改规范即改规则，规则里不重复抄内容。
- 改完无需重启：实测 DSH 热加载并推 `Updated instructions from: …`。
- 验证方法见《全局规则触发测试协议》（L1 注入 / L2 检索 / L3 复盘 / L4 稳定性四层）。

## 本仓库保留了什么

```
dsh-taskmirror/
├── scripts/taskmirror.mjs      — 实验：写复盘快照（记录型钩子）
├── scripts/verify-self-contained.mjs
├── test/                       — 17 例（隔离沙箱）
├── retired/                    — 已废弃的 Stop 硬门禁实现
│   ├── taskmirror-reflect.mjs
│   └── reflect.spec.mjs
└── README.md
```

**不要在生产启用**。保留仅为留存实验结论。

### `retired/` 的实验结论（供后续参考）

验证过的事实（逐环读 DSH 源码，非照文档想当然）：

| 事实 | 出处 |
|---|---|
| 回合将结束时**串行等待**钩子 | `dsh-agent-loop/lib/index.js:999` `await dispatch.serial('agent/turn-stopping', …)` |
| 返回后**重新检查**，钩子可不让循环结束 | 同文件 `:1005` `if (turnEnds && this.inbox.nextStep.length === 0) break;` |
| 退出码 2 = 阻止，stderr = 理由 | `dsh-hook-protocol`：`BLOCKING_EXIT_CODE = 2` |
| `block` 归一为 `deny` | `merge.js`：`rank("block") = 3` → `decisionForRank(3) = "deny"` |
| 桥接层据此 `agent.steer()` | `dsh-hooks-claude-code/lib/index.js:298` |
| **`stop_hook_active` 恒为 `false`** | 宿主不提供防死循环，上限须自己记 |
| 桥接只支持 7 类事件 | `SessionStart`/`UserPromptSubmit`/`PreToolUse`/`PostToolUse`/`Stop`/`SubagentStart`/`SubagentStop`（**无 `SessionEnd`**） |
| `transcript_path` 恒为空字符串 | 脚本须按 `session_id` 自行定位 zstd 会话日志 |

**结论**：机制可行，但复杂度高、有死循环风险，且**与既有 `task-timing.mjs` 功能重叠**——没有理由再维护一套。故废弃。

## 测试

```bash
node --test "test/*.spec.mjs"
```

**17 例**，全部走隔离沙箱（通过 `TASKMIRROR_*` 把状态重定向到临时目录），
不会读写用户真实的 `~/.claude/memory/dsh-taskmirror/` 与 `~/.dsh/taskmirror-cooldown.json`。

覆盖：完整路径写入、subagent/fork/未知 reason 跳过、max-tokens/aborted/error 不跳过、
cooldown 命中与互不影响、中文/emoji/换行/超长截断（精确 2000）、空 content 兜底、
空 sessionId、5 路并发、多级目录创建、沙箱隔离性。

> 注：`node --test test/`（目录形式）在 Node 24 上不被接受，需用 glob 形式。

## 引用

- 知识库《耗时复盘规范》——**正式方案**，本项目已被它取代
- 知识库《全局规则触发测试协议》——怎么验证全局规则真的生效
- [PeterBon/dsh-hooks](https://github.com/PeterBon/dsh-hooks) —— 配置驱动 lifecycle hooks（实验期使用）
- [DSH hooks 桥接 Discussion #6786](https://github.com/deepseek-ai/deepseek-harness/discussions/6786)

## 协议

MIT