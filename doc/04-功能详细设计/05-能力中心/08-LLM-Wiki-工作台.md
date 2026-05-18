# LLM-Wiki / Wiki工作台

## 菜单与路由

- 路由：`/capability-center/llm-wiki/workbench`

## 功能说明

Wiki 条目浏览与工作台管理。

## 关键接口

- GET /api/llm-wiki/entries
- GET /api/llm-wiki/section-counts

## 业务规则

- 条目筛选与分页应稳定。

## 验收标准

1. 页面可正常加载，无白屏。
2. 关键操作返回成功或明确错误提示。
3. 数据变更可在页面刷新后保持一致。



