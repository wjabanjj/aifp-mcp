# Trae — ai-cognition 自动记忆识别配置

## 第一步：配置 MCP 服务器

打开 Trae → 设置 → MCP → 添加 MCP 服务器：

```
名称: ai-cognition
命令: npx aifp-mcp
```

## 第二步：项目规则

在项目根目录创建 `.trae/rules/` 目录，放入以下规则文件 `ai-cognition.md`：

---

> 每次回答完用户后，调用 `observe_turn` MCP 工具记录用户的最后一条消息。
> 
> 规则：
> 1. 回复完用户立即调用 `observe_turn({ user_message: "用户的最后一条消息" })`
> 2. 返回 `{ queued: true }` → 包含有价值信息，系统自动识别入库
> 3. 返回 `{ queued: false }` → 普通交流，无需处理
> 4. 不要手动调 `save_memory`，让自动识别决定
