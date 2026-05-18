# GYS供应链

## 菜单与路由

- 路由：`/supply-chain`

## 功能说明

GYS 供应链记录与树结构维护。

## 关键接口

- GET /api/supply-chain/tree
- GET/POST/PUT /api/supply-chain/records*
- DELETE /api/supply-chain/records/item/:id
- DELETE /api/supply-chain/records/batch-delete

## 业务规则

- 支持树查询与记录编辑。

## 验收标准

1. 页面可正常加载，无白屏。
2. 关键操作返回成功或明确错误提示。
3. 数据变更可在页面刷新后保持一致。



