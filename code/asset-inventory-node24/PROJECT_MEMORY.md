# PROJECT MEMORY - asset-inventory-node24

## 1. 项目目标

- 面向公司内部员工的资产盘点系统
- 核心页面：
  - 首页 `/`
  - 资产盘点列表 `/inventories`
  - 资产盘点填报 `/inventories/new`

## 2. 当前技术栈

- Node.js `24`（`.nvmrc` + `package.json engines`）
- 前端：React + Vite + Ant Design
- 后端：Express
- 数据库：SeaboxSQL（PostgreSQL 兼容，使用 `pg` 驱动）
- 配置：`.env` / `.env.example`（`dotenv`）

## 3. 当前代码结构

- 前端入口：[src/main.jsx](E:\workspaceCodeing\code\asset-inventory-node24\src\main.jsx)
- 路由与布局：[src/App.jsx](E:\workspaceCodeing\code\asset-inventory-node24\src\App.jsx)
- 页面：
  - [src/pages/HomePage.jsx](E:\workspaceCodeing\code\asset-inventory-node24\src\pages\HomePage.jsx)
  - [src/pages/InventoryListPage.jsx](E:\workspaceCodeing\code\asset-inventory-node24\src\pages\InventoryListPage.jsx)
  - [src/pages/InventoryFormPage.jsx](E:\workspaceCodeing\code\asset-inventory-node24\src\pages\InventoryFormPage.jsx)
- API 封装：[src/api/inventoryApi.js](E:\workspaceCodeing\code\asset-inventory-node24\src\api\inventoryApi.js)
- 后端服务：[server/index.js](E:\workspaceCodeing\code\asset-inventory-node24\server\index.js)
- 建表 SQL：[server/sql/001_create_asset_inventory.sql](E:\workspaceCodeing\code\asset-inventory-node24\server\sql\001_create_asset_inventory.sql)

## 4. 已实现后端能力

- `GET /api/health`
- `GET /api/inventories`
- `GET /api/inventories/:id`
- `POST /api/inventories`
- `GET /api/auth/me`
- `GET /api/auth/login-url`
- `GET /api/auth/callback`

统一响应结构：`{ code, message, data }`

## 5. 数据库与降级策略

- 目标连接参数来自文档 `doc/06-开发参考/01-开发环境配置.md`
- 当前配置默认：
  - `DB_HOST=10.1.1.113`
  - `DB_PORT=7300`
  - `DB_NAME=training_exercises`
  - `DB_SCHEMA=aoyong`
  - `DB_USER=aoyong`
  - `DB_PASSWORD=aoyong`
- 启动时会尝试建表 `schema.asset_inventory`
- 当数据库不可用时，若 `DB_FALLBACK_TO_MEMORY=true`，后端自动切换为内存模式以保证新增/列表可用

## 6. 已知问题（高优先）

- 实测 SeaboxSQL 返回：`role "aoyong" does not exist`
- 因此当前无法以文档账号连通真实数据库，系统会进入 `memory-fallback`
- 需要用户提供可用数据库账号（通常用户名=密码=schema）后再切回真实库

## 7. Auth 对接约束

- OAuth2 回调地址固定：`http://localhost:3000/api/auth/callback`
- 本地联调时后端必须运行在 `3000` 端口
- 可通过 `AUTH_ENABLED=true` 开启鉴权中间件

## 8. 最近关键决策

- 页面风格保留 Ant Design 原生组件风格
- 优先保证业务可用：数据库不可达时不阻塞接口，自动降级内存模式
- 前端 API 支持自动附带 Bearer Token（本地存储或 `VITE_AUTH_TOKEN`）

## 9. 下一个执行步骤（待办）

1. 获取有效 SeaboxSQL 用户名/密码/schema
2. 在 `.env` 更新真实连接参数并验证 `/api/health` 为 `connected`
3. 在真实库执行一次写入与列表读取验收
4. （可选）补充编辑、删除接口与前端操作入口

## 10. 供应链树能力（2026-04-20）

- 新增两张核心表（`server/index.js` 启动自动建表）：
  - `aoyong.crawl_info`：爬取原始事实表，含自增 `id`、`business_entity/source_url/page_url/page_title/text_sample`、`level1/2/3_url`、`supplier_url`、`level1/2/3_title`、`supply_chain_info` 等字段。
  - `aoyong.supply_chain_node`：供应链树节点表，含自增 `id` 与 `parent_id` 自关联（`parent_id -> id`），通过 `node_level(1-3)` 管理层级。

- 新增后端接口：
  - `POST /api/supply-chain/import-csv`：导入 CSV 到 `crawl_info` 并构建 `supply_chain_node`。
  - `POST /api/supply-chain/rebuild-csv`：按 `source_file` 清空旧数据后重建导入。
  - `GET /api/supply-chain/records`：查询供应链明细记录。
  - `GET /api/supply-chain/tree`：查询树结构（`id/parent_id`）。

- 新增前端页面与菜单：
  - 页面：`/supply-chain`（树 + 表）
  - 菜单名：`供应链信息`
  - 功能：导入 CSV、清空并重建、刷新、树筛选明细
  - 相关文件：`src/pages/SupplyChainPage.jsx`、`src/api/supplyChainApi.js`、`src/App.jsx`

- 已验证导入：
  - 文件：`crawl_result_1776697261816.csv`
  - 导入结果：`importedRows=263`
  - 重建结果：`deletedInfoRows=263` 后重新导入 `263`
  - 树节点：`totalNodes=323`，根节点 `11`

- 采集逻辑增强：
  - 支持自然语言识别 `全量/增量`、`业务实体`、`URL`，不强制固定模板。
  - 针对站点反爬增加 cookie 二次请求机制。
  - 可从首页“全部产品分类”抽取一级/二级/三级标题并形成 `supply_chain_info`。
