# HermesOS

通过飞书控制的 AI 项目管家 —— DeepSeek 理解语言，n8n 调度，MySQL 记忆，本地 Worker 执行 Codex/Claude/Git 操作。

## 架构

```
飞书 → 阿里云 n8n → 阿里云 MySQL → 本地 Hermes Worker poll n8n → Worker 调 Codex / Claude / Git → report 回 n8n → MySQL → 飞书汇报
```

## 初始化

```bash
# 1. 进入 worker 目录
cd worker

# 2. 安装依赖
npm install

# 3. 配置环境变量（参考 HermesOS配置记录.env 或 docs/ 内文档）
cp HermesOS配置记录.env .env
# 编辑 .env 填入你的 n8n URL、MySQL 连接、飞书密钥、DeepSeek API Key 等

# 4. 启动 Worker
npm start
```
