# 会话中断继续 · dsh-session-continue

一个独立的 DeepSeek-Harness 插件：**会话非正常结束时，在输入框上方显示提示条与「继续」按钮**。

插件只有一个包，自带 Host 半边与浏览器半边，没有子包、没有运行时依赖，也不
依赖任何其他插件。

| 项 | 值 |
| --- | --- |
| 包名 | `dsh-session-continue` |
| 插件名（诊断用） | `dsh-session-continue` |
| 投影键 | `sessionContinueInterruption` |
| 版本 | `0.1.0` |
| 依赖 | 无 |

## 解决什么问题

Agent 的一轮对话可能并不是「正常结束」的：

- 进程被杀 / 崩溃，日志尾部那一轮永远没有 `turn/end`；
- 重启、刷新页面、断线，正在跑的一轮被中途掐断；
- 任务本身出错、被阻止，或输出撞到长度上限；
- 你自己按了停止，但活还没干完。

这些情况下工作都停在了半路上。插件把「这一轮是怎么结束的」「停在那一轮」「当时
的任务清单」折叠成一小份状态，在输入框上方显示一条提示，并提供「继续」按钮：
点一下就把接续指令填进输入框并提交，模型于是知道上次没跑完、应该接着做。

## 装上之后长什么样

**提示条**在 `conversation.input.dock` 槽位，位于输入框正上方（排在自带的待办
dock 之上）。收起时只有一行：状态点、标题「会话未正常结束」、以及一句话的原因。
展开「详情」后多三行：中断轮次、错误代码、错误信息——展开区**没有分割线**，它就在卡片
自己那块表面上往下长。右侧三个按钮：详情 / 继续 / 忽略。

- 只在会话**没有正常结束**且 **agent 当前不在运行**时出现；
- 「忽略」只对这一次中断生效，下一条中断会重新出现；
- 任务清单**不**在提示条里重复（自带的待办面板就在正上方），而是随「继续」
  指令一起发给模型。

**插件卡片**在「插件」页显示为「会话中断继续」，图标是蓝底播放三角。

**两个开关**在「插件」页本插件自己的详情页里（`plugins.bundle.config`）。插件名、图标、
包名与版本号都由插件页自己绘制，这里只放开关：

| 开关 | 默认 | 作用 |
| --- | --- | --- |
| 恢复进度与任务清单 | 开 | 「继续」时附带未完成的任务清单与中断轮次 |
| 提示手动停止的会话 | 开 | 关掉后只提示非你主动结束的会话 |

插件本身的启用/禁用由「插件」页那张卡片上的开关控制，详情页只放这两个偏好，不重复一个总开关。
侧边栏里不会多出一个「会话中断继续」的设置项——两个开关不值得占一格导航。

## 安装

### 从 npm 安装

在 DSH 的「插件」页选择「添加插件」，填入包名 `dsh-session-continue`，装好后在
bundle 列表里确认 `dsh-session-continue` 已启用。

命令行等价写法：

```bash
npm install dsh-session-continue
```

### 从 Git 仓库安装

同样在「插件」页选择安装，填入本仓库的地址（`<主机>/<账号>/dsh-session-continue`）。
仓库地址不写进包内文本：一个包不该带着某个账号名四处走。

### 本地开发安装

把源码目录 link 进 profile，并把**包本身**加入 bundle 列表：

```jsonc
// <profile>/package.json
{
  "dependencies": {
    "dsh-session-continue": "link:<本仓库的绝对路径>"
  },
  "dsh": {
    "profile": {
      "bundles": [
        // ...
        "dsh-session-continue"
      ]
    }
  }
}
```

包内的 `cordis.patch.yml` 会插入唯一的一行，把包挂进配置树；浏览器半边由
`package.json` 的 `dsh.client` 声明发现，不需要第二行。

## 实现要点

Host 半边（`index.js`）向 `ctx.sessionProjections` 注册一个名为 `sessionContinueInterruption`
的投影单元，把整条会话日志折叠成浏览器需要的少量状态。放在投影里而不是浏览器里，
是因为浏览器只持有一个分页的事件窗口，而投影折叠永远看到完整日志。

投影声明了 `wire` 视图，所以值在 Host 侧算好、由框架缓存后推给客户端。**wire 视图
必须保持引用稳定**：注册表用 `Object.is` 比较相邻两次 `view` 的结果，只要变了就发布，
而一次发布要花掉一个控制流帧、一次客户端 store 写入、一次整份会话列表快照重建和一次
对话区重渲染。一轮里每个工具调用都会产生一个 `step/start` 和一个 `step/end`，它们不
改变任何客户端渲染的东西，所以折叠把它们记在**只属于 Host** 的字段里（`openStep`、
`hasTurns`），wire 视图不包含这两个字段——于是它们永远不触发发布。

浏览器半边（`client.js`）只从 wire 视图读八个字段：`status`、`turn`、`reason`、
`abortCause`、`errorCode`、`errorMessage`、`partialMessage`、`todos`。

### 判定的难点：主动停止 vs 被动中断

两种情况的日志**一模一样**：`turn/end { kind: 'aborted', reason: { kind: 'user' } }`。
你自己按停止会写它，Workspace 停会话（归档工作区、退出应用）也会调
`agent.cancel({ kind: 'user' })`，注释里明说是「照用户自己停的样子来」。

能区分的只有 `partialMessage`：按停止时模型正在流式输出，harness 会把已经吐出来的
那段以 `interrupted: true` 的消息落盘；而在一轮之间被杀掉（刷新、重启、重连）没有
流在飞，也就不会有这条消息。

没有这条消息时默认判为**中断**而不是「用户主动停止」：多显示一条不需要的提示是无害的，
漏显示一条崩溃后的提示会丢工作。

详细的设计推演、边界与实测数据见 [`docs/design.md`](<docs/design.md>)。

## 目录结构

```
dsh-session-continue/
├── index.js            Host 半边：interruption 投影（键 `sessionContinueInterruption`）
├── client.js           浏览器半边：提示条与设置页
├── cordis.patch.yml    挂载本插件的一行 patch
├── package.json
├── icon.svg            Plugins 页面的图标（36×36 画布）
├── locale/             Plugins 列表的标题与描述
│   ├── zh.json
│   └── en.json
├── docs/
│   └── design.md       设计推演：判定规则、wire 契约、代价
└── test/               离线验证脚本
```

## 验证

`test/` 下的脚本全部离线运行，不需要启动 DSH、不需要安装依赖、不联网。它们加载
**实际发布的文件**（用 `window.__ModuleLoader__` 的 shim 捕获浏览器半边入口）来校验，
而不是校验一份副本。

只读会话日志的那几个脚本需要 Node ≥ 22.15：它们用 `node:zlib` 的 zstd 解压，
更早的版本没有这个 API。插件本身对 Node 没有要求——Host 半边一个 import 都没有，
浏览器半边只从模块表取 `react`。

```bash
cd test

# 一次跑完所有强制校验
node run.mjs

# 或逐个跑
node verify-manifest.mjs       # 清单、exports、patch、locales、图标、身份卫生
node verify-resolve.mjs        # Host 会为这个包解析的每一个资源
node verify-metadata.mjs       # 插件管理器的显示元数据读取（exports 语义）
node verify-client.mjs         # 槽位注册、词典、提示条渲染决策
node verify-layout.mjs         # 提示条两态对齐的静态审计
node verify-continue.mjs       # 「继续」动作与两个开关
node verify-icons.mjs          # 图标：结构、自洽、调色板、几何、渲染
node audit-perf.mjs            # 用真实会话日志量一次折叠与发布次数
```

会话日志相关的诊断脚本需要一个**真实会话目录**作参数（默认读
`$DSH_HOME/sessions`，再退回 `~/.dsh/sessions`），它们只读不写：

```bash
node dump-session.mjs    <sessionDirOrId>   # 逐事件打印一轮的结构
node explain-session.mjs <sessionDirOrId>   # 这个会话为什么显示／不显示「继续」
node explain-aborts.mjs  <sessionDirOrId>   # 主动停止与刷新／重启中断的区分
node scan-signals.mjs                       # 扫描全部会话的判别信号
node verify-fold.mjs     <sessionDir> ...   # 用真实日志跑一遍折叠
```

没有会话目录时这些脚本会明确说明「没有语料」并跳过，不会假装通过——一个没有语料
的机器是「没测」，不是「通过」，把两者混为一谈正是绿灯最容易骗人的地方。

会话根目录按 `$DSH_HOME/sessions` → `~/.dsh/sessions` 的顺序解析，也可以用参数
直接给一个目录；所有脚本只读。

## 许可

[MIT](LICENSE)