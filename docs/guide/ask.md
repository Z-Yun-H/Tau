# 单轮问答（tau ask）

`tau ask` 是 Tau 的历史正门：一个意图进，一份计划、一次执行、一个结果出。适合"查一下"、"找出来"、"帮我读这个文件"这类可以一步完成或按固定步骤完成的任务。

## 基本用法

```bash
tau ask "找出超过 1MB 的日志文件"
tau ask "读一下 package.json 并总结依赖"
```

执行过程会展示：AI 的规划说明、每一个步骤（工具或 shell 命令）、安全审查结论，然后请求你的确认（低风险只读计划可用 `--yes` 跳过交互）。

## 流式思考（v0.5.0）

v0.5.0 起，规划轮可以流式透出 provider 的思考过程（reasoning delta）：DeepSeek 的 `reasoning_content`、Anthropic 的 `thinking_delta`、Gemini 的 thought parts 都以独立通道到达，与计划正文分开；组装出的计划仍要经过与缓冲模式完全一致的严格 JSON 校验与确定性审查——流式只改变"何时看到"，不改变"能否执行"。

这一能力目前在 **WebUI** 中呈现：规划进行时思考实时流入计划卡顶部的可折叠面板。CLI 尚未暴露 `--stream` 旗标——库层 API（`planIntentStream` / `onPlanStream`）已就绪，可供自建集成直接使用。

## 与 tau goal 的区别

|      | tau ask        | tau goal                     |
| ---- | -------------- | ---------------------------- |
| 轮次 | 1              | 最多 5（默认 3）             |
| 反思 | 无             | 每轮后 provider 决定是否继续 |
| 适用 | 明确的单步任务 | 需要根据执行结果调整的任务   |

`tau ask` 执行完毕就结束；如果 provider 认为还需要一轮，那不是 ask 的事——请改用 [tau goal](/guide/goal)。

## 退出码与管道

`tau ask` 遵循 Unix 约定：成功返回 0，失败返回非 0，结果文本走 stdout、日志走 stderr，可以直接接入管道与 CI 脚本。
