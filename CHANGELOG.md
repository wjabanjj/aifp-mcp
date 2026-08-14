# Changelog

All notable changes to **aifp-mcp** (AiFP 记忆感知系统).

## [1.5.4] — 2026-08-14

### 🛡️ 管理面板 & 服务器安全（已部署）
- 后台路径 `/admin` → `/mm`（隐蔽，旧路径失效）
- 登录失败 **2 次第 3 次锁 IP**（锁定期页面都打不开，日志记录，提示不暴露时间）
- 修改管理密码（≥6 位，scrypt 加盐存储到 admin.json，重启不丢）
- 完整 key 弹卡片 + 复制；续期；改配额；搜索；最新 key 排最上
- 默认每日配额 2000 → 3000

### 🚀 服务器部署
- 服务器独立构建（tsconfig.server.json → dist-server，不进 npm 包）
- `COGNITION_SKIP_VECTOR=1`：服务器纯算法不加载向量模型
- nginx 反代 + 根路径重定向；管理面板路径可配置
- 密钥管理：keys.json 多用户 + 有效期 + 配额 + 热吊销
- 实际部署：生产服务器，PM2 守护，端到端验证通过

### 🐛 修复
- dsh 配置硬编码 `COGNITION_MODE: local` 覆盖 --connect remote（已修）
- admin 面板 JS 模板字符串 `\n` 转义导致整页脚本失效（已修）
- 登录锁定计数被误删（已修）

## [1.5.3] — 2026-08-14

### 🐛 修复（实测发现）
- **启动自动导入污染**：无 `COGNITION_SOURCES` 配置时不再保底扫描 cwd，避免把 MCP 包自身文件（README/package.json/tsconfig）自动导入用户记忆库
- **感知链从不建边**：`autoLinkNewMemory` 语义召回不足时（如"乌龙茶"vs"咖啡"召回为 0），新增关键词交集 LIKE 召回兜底，保证相关记忆能生成感知链边
- **关联查询永远为空**：`get_related_memories` 在 Hebbian 共现无数据时回退查询感知链相邻节点

### ✨ 新增
- **DeepSeek Harness (dsh) 一键配置**：postinstall 自动写入 `~/.dsh/cordis.patch.yml`（MCP 工具 `mcp__ai-cognition__*` 开箱即用）
- **`--check` 健康自检**：`aifp-mcp --check` 输出数据目录/数据库/模型缓存/平台检测报告，退出码 0/1
- **全工具描述重写**：31 个工具统一"作用 → 何时用 → 本地/云端能力"格式；感知链 5 件套明确标注「需要连接服务器，本地模式不可用」

### 📝 文档
- 英文 README（npm 出海主文档）+ 中文 README.zh.md
- 本地模式 vs 服务器增强能力矩阵
- LICENSE（商业闭源授权，个人/非商业免费）

## [1.5.2] — 2026-08-14

- 元数据补全：license 字段、英文描述、keywords
- npm 包内容审查（不含服务器端代码）

## [1.5.1] — 2026-07-14

- 既有历史版本（29 个历史版本已发布）

> 完整历史版本见 [npm](https://www.npmjs.com/package/aifp-mcp)。
