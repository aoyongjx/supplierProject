# LLM-Wiki / 关系图谱

## 菜单与路由

- 路由：`/capability-center/llm-wiki/graph`

## 功能说明

Wiki 知识图谱展示与重建同步。

## 关键接口

- GET /api/llm-wiki/graph
- POST /api/llm-wiki/graph/sync

## 业务规则

- 图谱同步后可立即查询节点边。

## 验收标准

1. 页面可正常加载，无白屏。
2. 关键操作返回成功或明确错误提示。
3. 数据变更可在页面刷新后保持一致。



