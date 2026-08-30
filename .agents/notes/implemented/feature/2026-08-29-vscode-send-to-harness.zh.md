# Agent Note：VS Code 右键菜单发送到 Harness

Status: implemented

[English](2026-08-29-vscode-send-to-harness.md) | 中文

## 问题

在 VS Code 中使用内嵌 DeepSeek Harness 侧边栏时，用户必须手动把文件路径或选区引用复制到输入框。缺少一个编辑器集成的操作，能把文件路径或行号范围引用直接发送到 Harness 输入框光标处。

## 决定

扩展新增两个命令和两个右键菜单项：

- `dsh.sendSelection` 出现在 `editor/context` 中，条件是存在文件选区；它把当前文件的绝对路径和基于 0 的选区格式化为基于 1 的引用（单行输出 `path:line`，多行输出 `path:start-end`），并发送到输入框光标处。
- `dsh.sendFile` 出现在 `editor/title/context` 中，作用于文件标签页；它发送标签页的绝对路径。

投递采用三段消息路径：扩展向自己的 webview frame 发送一条带类型消息；frame 脚本从 iframe URL 读取 launch token 后转发给 Harness iframe，并在 iframe 未加载完成前排队；Web 客户端的 `ui-conversation` 插件持有 `message` 监听器，校验嵌入模式、token 一致性和当前会话后，调用会话既有的 `SessionInputShell.paste()` 在输入框光标处插入。Web 客户端把 `ok`/错误结果经 frame 回传给扩展，扩展据此结束发送命令（超时 5 秒）。frame 还会发送 `ready` 消息，避免扩展在桥接脚本生效前过早投递。

选区格式化和消息校验是纯函数（`apps/vscode/src/format.ts`、`packages/client/ui-conversation/src/client/embed-input.ts`），因此行号区间和 token 规则可以单元测试。

## 曾考虑的替代方案

**从扩展宿主直接操作 iframe DOM。**否决：webview frame 与 Harness iframe 跨源，扩展宿主无法触及 iframe DOM；绕开 webview API 也会越过 VS Code 的消息边界。

**通过 Host RPC/会话 API 驱动输入框。**否决：目前没有公开传输可修改尚未发送的客户端输入草稿；草稿保存在浏览器的 Lexical 编辑器中，不在 Host 会话状态里。postMessage 路径让编辑像粘贴一样保持在 UI 本地。

**只发不收、不等待确认。**否决：没有确认时，扩展无法告诉用户当前未选择会话或侧边栏尚未就绪。带回执与超时让命令行为可预期。

**发送原始选中文本而不是路径/行号引用。**否决：需求格式是稳定的编辑器引用；把可能很大的文件内容粘贴进 prompt 是另一个功能。

## 后果

必须已选择 Harness 会话，且嵌入页面必须携带 launch token，发送才能成功；扩展会自动打开/等待侧边栏就绪。否则用户只会看到通用警告。webview frame 现在允许内联脚本（`script-src 'unsafe-inline'`），该脚本只存在于受信任的扩展生成 frame 内。内部消息协议未做版本化，仅由这两端共享；未来重写时接收端仍应保留 token 校验。
