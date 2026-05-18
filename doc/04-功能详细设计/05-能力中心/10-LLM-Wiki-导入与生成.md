# LLM-Wiki / 导入与生成

## 菜单与路由

- 路由：`/capability-center/llm-wiki/compose`

## 功能说明

原始内容导入、预览与重同步。

## 关键接口

- POST /api/llm-wiki/raw-import
- GET /api/llm-wiki/raw-import/items
- POST /api/llm-wiki/raw-import/items/:id/resync

## 业务规则

- 导入失败项可单独重试。

## 验收标准

1. 页面可正常加载，无白屏。
2. 关键操作返回成功或明确错误提示。
3. 数据变更可在页面刷新后保持一致。



