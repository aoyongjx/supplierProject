# LLM-Wiki / 配置

## 菜单与路由

- 路由：`/capability-center/llm-wiki/settings`

## 功能说明

Wiki 同步策略与来源配置。

## 关键接口

- GET/PUT /api/llm-wiki/settings
- GET /api/llm-wiki/sync/*
- POST /api/llm-wiki/sync/:sourceType

## 业务规则

- 配置保存后可被同步任务读取。

## 验收标准

1. 页面可正常加载，无白屏。
2. 关键操作返回成功或明确错误提示。
3. 数据变更可在页面刷新后保持一致。



