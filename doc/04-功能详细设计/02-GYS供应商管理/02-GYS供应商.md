# GYS供应商

## 菜单与路由

- 路由：`/suppliers`

## 功能说明

GYS 供应商主数据管理。

## 关键接口

- GET/POST/PUT /api/suppliers*
- DELETE /api/suppliers/item/:id
- DELETE /api/suppliers/batch-delete
- DELETE /api/suppliers/clear-all

## 业务规则

- 支持批量删除和清空。

## 验收标准

1. 页面可正常加载，无白屏。
2. 关键操作返回成功或明确错误提示。
3. 数据变更可在页面刷新后保持一致。



