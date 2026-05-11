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

## 11. 能力中心与知识库（2026-04-29）

- 新增一级菜单：`智能体`、`能力中心`；新增页面：`MCP服务`、`Skill管理`、`知识库管理`。
- MCP服务页：接入真实本机配置读取，支持启动/禁用、修改、卸载；并展示 Agent Reach 渠道卡片 `wechat`、`xueqiu`。
- Skill管理页：支持真实 skill 列表、启用/禁用、修改、卸载、安装路径输入、安装进度与日志提示。
- 知识库管理页：左侧树形库列表 + 右侧库内容；新增库时保存配置（嵌入模型、维度、TopK），支持文件/网页入库。
- 知识库入库流水线：`queued -> parsing -> chunking -> embedding -> success/failed`，支持失败重试。
- 知识库持久化：从本地文件迁移为数据库存储。
- 新增数据库对象：
  - `knowledge_base`
  - `knowledge_base_document`
  - `supplier_opinion_vector`（`pgvector`，`embedding vector(1536)`，`ivfflat` 索引）

## 12. 模型管理近期改动（2026-05-07）

- 新增能力中心二级页面：模型管理（供应商列表 + 右侧配置面板），并持续按参考截图做 UI/交互对齐。
- 配置保存策略调整为“显式保存”：
  - `启用`、`API 密钥`、`API 地址` 改为只更新前端表单状态。
  - 点击右上角 `保存` 按钮后统一调用 `PUT /api/model-providers/:providerName` 入库。
- 修复“检测误报缺少 API 密钥”问题：
  - `POST /api/model-providers/:providerName/test` 支持读取请求体中的 `apiKey/apiBaseUrl`，优先于库内值。
  - 前端检测按钮会将当前输入值直接传给后端，因此未保存也可先检测连接。
- 新增并落地模型明细表（启动自动建表）：
  - 表：`aoyong.model_provider_model`
  - 字段：`provider_name`、`model_id`、`group_name`、`capability_video`、`capability_reasoning`、`capability_tool`、`owned_by`、`object_type`、`source_type`、`sort_order`、时间戳。
  - 约束：`UNIQUE(provider_name, model_id)`；外键级联到 `model_provider_config(provider_name)`。
- 入库事务化：
  - 保存供应商配置与更新模型明细在同一事务中提交。
  - 获取模型列表后同步刷新 `fetched_models_json` 与 `model_provider_model` 明细。
- 前端交互补齐：
  - 模型搜索框改为点击放大镜后展开，失焦自动收起。
  - 分组删除与单模型删除图标分离，避免视觉混淆。

## 13. 精准寻源智能体流程修正（2026-05-08）

- 工具调用门控改为“先LLM路由再执行”：
  - 普通自然语言问题：直接大模型回答，不进入 Intent/Plan/ReAct。
  - LangChain工具问题：进入 Intent -> Plan -> ReAct 多步流程。
- 选中工具执行策略修正：
  - 仅当路由判定需要工具时，已选工具才作为执行约束。
  - 避免“普通问答也强制走 DB/RAG/WEB”回归。
- 新增流程可观测存储：
  - `precise_sourcing_intent_log`（意图识别）
  - `precise_sourcing_plan_log`（计划步骤）
  - 与 `precise_sourcing_run_log` 通过 `run_id` 关联，事务写入。
- 前端流程展示调整：
  - 执行过程按 Intent / Plan / ReAct 三段展示。
  - 直答场景不再展示执行流程，避免中途闪现 ReAct 面板。
- 默认模型更新：
  - 精准寻源页面默认模型改为 `gpt-5.4`，移除将 `gpt-5.4` 自动改写为 `gpt-5.5` 的兼容逻辑。

## 14. 用户偏好（稳定性约束，2026-05-11）

- 精准寻源智能体优先目标：`稳定返回` > `复杂功能`。
- 变更策略：只允许最小改动，禁止修改无关代码。
- 每次改动后必须先做本地自验证（接口可返回、耗时可接受）再交付。
- Web 检索要求：优先可用结果，不允许出现明显噪声页（如 `robots.txt`、论坛/问答页）直接进入候选展示。
- 若召回不足：先保证“有结果返回”，再逐步提升质量；禁止以“空白/无结果”交付。
