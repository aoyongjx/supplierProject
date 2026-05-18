# GAS供应链

## 菜单与路由

- 路由：`/gas-supply-chain`

## 功能说明

GAS 供应链记录管理与同步任务导入。

## 关键接口

- GET /api/gas-supply-chain/tree
- GET/POST/PUT /api/gas-supply-chain/records*
- POST /api/gas-supply-chain/sync-tasks
- POST /api/gas-supply-chain/sync-tasks/:taskId/import

## 业务规则

- 同步任务可取消与导入。

## 验收标准

1. 页面可正常加载，无白屏。
2. 关键操作返回成功或明确错误提示。
3. 数据变更可在页面刷新后保持一致。



