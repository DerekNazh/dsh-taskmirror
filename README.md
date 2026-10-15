# dsh-taskmirror

> **Post-task 9-dimension retrospective for DeepSeek Harness (DSH)**
> 
> 每当一次大任务完成，自动触发 9 维自检 + 沉淀到 `~/.claude/memory/dsh-taskmirror/`。

## 工作原理

1. 借助 [`@PeterBon/dsh-hooks`](https://github.com/PeterBon/dsh-hooks)（DSH 官方 hooks 桥接）
2. 在 `turn/end` 事件时自动调用本项目的 `scripts/taskmirror.mjs`
3. 跳过 subagent / fork 任务
4. 检查 5min cooldown（同 session 不重复触发）
5. 写 9 维自检 reminder 到 `~/.claude/memory/dsh-taskmirror/<sid>.md`

## 9 维自检内容

参照 [拾光客户端 architecture-review-scorecard.md](D:\setup_temp\product-marketing_new\memory\architecture-review-scorecard.md)：

- **A** 职责单一性
- **B** 依赖健康度
- **C** 测试完备性
- **D** 改动安全性
- **E** 体积（800行上限）
- **F** 债台账完整度
- **G** 过程规范度
- **H** 可推广性
- **I** 品牌一致性

## 安装

### 1. 装 dsh-hooks（社区 hook 引擎）

```bash
dsh plugin --profile web add dsh-hooks
# 或从源码：
dsh plugin --profile web add github:PeterBon/dsh-hooks
```

### 2. 装本插件

```bash
dsh plugin --profile web add github:你的用户名/dsh-taskmirror
# 或本地 path：
dsh plugin --profile web add "file:C:\Users\Administrator\.agents\skills\dsh-taskmirror"
```

### 3. 在 profile 的 cordis.patch.yml 加 hook 配置

```yaml
- id: dsh-hooks
  name: dsh-hooks
  config:
    hooks:
      - on: 'turn/end'
        when: 'completed'
        run: 'node C:\Users\Administrator\.agents\skills\dsh-taskmirror\scripts\taskmirror.mjs'
        timeoutMs: 10000
```

## 用法

每完成一个 DSH 任务（turn/end），脚本自动跑：
- 跳过 subagent / fork / 非 completed 任务
- 5min cooldown（同 session 不重复）
- 写入 `<USERPROFILE>\.claude\memory\dsh-taskmirror\<sid>.md`
- 输出 `written: <path>` 到 stdout（dsh-hooks 捕获）

写入文件结构示例：
```markdown
# TaskMirror 复盘

**生成时间**：2026-10-15T...
**session**：My Project
**turn**：5
**reason**：completed
**cwd**：D:\setup_temp\product-marketing_new
**duration**：12000ms

## 9 维自检

9 维自检：
- A 职责单一性
- ...

## 本轮摘要

[user 消息 + assistant 回答的摘要]
```

## 文件清单

```
C:\Users\Administrator\.agents\skills\dsh-taskmirror\
├── package.json              (2.4KB) — 极简，仅描述 + bin
├── cordis.patch.yml          (240B) — 仅注册 name
├── README.md                 (本文档)
├── scripts/
│   └── taskmirror.mjs        (4.5KB) — 9 维自检 + 写文件 + cooldown
└── test/
    └── plugin.spec.mjs       (4KB) — 4 个 node --test
```

## 与拾光客户端的集成

拾光客户端（[D:\setup_temp\product-marketing_new](D:\setup_temp\product-marketing_new)）也用了相似的 9 维自检机制：
- `D:\claude-code\hooks\taskmirror.js` v5（settings.json 钩子路径）
- `shiguang-ai/.claude/hooks/dsh-hooks.json`（dsh-hooks 配置）

本插件是**用户级 DSH 钩子**，跟项目级 taskmirror.js v5 是**两个独立但同思路的方案**：
- 用户级 DSH 钩子：所有 DSH session 都用
- 项目级 settings.json 钩子：仅在拾光客户端项目里用

## 引用

- [PeterBon/dsh-hooks](https://github.com/PeterBon/dsh-hooks) — 114 commits / 22 tags / 17 种事件
- [DSH hooks 桥接 Discussion #6786](https://github.com/deepseek-ai/deepseek-harness/discussions/6786) — 已知桥接 bug
- [Discussion #506 agent/turn-starting/aborting](https://github.com/deepseek-ai/deepseek-harness/discussions/506) — turn 边界事件

## 协议

MIT
