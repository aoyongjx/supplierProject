# MCP服务

## 菜单与路由

- 路由：`/capability-center/mcp-services`

## 功能说明

MCP 服务检索、安装、编辑、启停、删除。

## 关键接口

- GET /api/mcp-services
- POST /api/mcp-services/search|install
- PUT /api/mcp-services/:name
- POST /api/mcp-services/:name/toggle

## 业务规则

- 配置变更后列表状态一致。

## 验收标准

1. 页面可正常加载，无白屏。
2. 关键操作返回成功或明确错误提示。
3. 数据变更可在页面刷新后保持一致。



