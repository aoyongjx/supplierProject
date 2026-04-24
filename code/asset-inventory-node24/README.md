# 资产盘点系统（Node + React + Ant Design）

用于公司内部员工提交资产盘点，包含：

- 首页
- 资产盘点列表
- 资产盘点填报

## 技术栈

- Node.js 24
- React + Vite
- Ant Design
- Express
- SeaboxSQL（PostgreSQL 兼容访问）

## 启动前配置

1. 复制环境变量文件：

```bash
cp .env.example .env
```

2. 默认已按《01-开发环境配置》填入 SeaboxSQL 参数（可按需改）：

- `DB_HOST=10.1.1.113`
- `DB_PORT=7300`
- `DB_NAME=training_exercises`
- `DB_SCHEMA=aoyong`
- `DB_USER=aoyong`
- `DB_PASSWORD=aoyong`
- `DB_CONNECT_TIMEOUT_MS=4000`

3. 接入东方金信 Auth（本项目默认要求认证）：

- `AUTH_ENABLED=true`
- `AUTH_BASE_URL=http://leaf-auth-server.dev.jinxin.cloud`

本地 OAuth2 回调固定：`http://localhost:3000/api/auth/callback`（见文档约束），因此后端端口必须是 `3000`。
前端回调页默认：`http://localhost:5173/auth/callback`。

## 运行

```bash
npm install
npm run dev
```

- 前端：Vite 默认端口 `5173`
- 后端：Node 默认端口 `3000`

## API

- `GET /api/health`：健康检查（含 DB 状态）
- `GET /api/inventories`：分页查询资产（支持 `page`、`pageSize`、`keyword`、`status`）
- `GET /api/inventories/:id`：查询单条资产盘点
- `POST /api/inventories`：新增资产盘点
- `GET /api/auth/me`：当前登录用户信息（启用 Auth 后生效）
- `GET /api/auth/login-url`：生成认证中心登录地址
- `GET /api/auth/callback`：OAuth2 回调、换取 token 并重定向到前端
- `GET /api/auth/logout-url`：获取认证中心登出地址
- `GET /api/stocks/overview`：股票概览（来自 `demo_stock.all_stocks_5yr`）
- `GET /api/stocks/kline`：股票 K 线聚合（`cycle=1d/1w/30d`，使用 `time_bucket + first/last/max/min/sum`）

返回结构统一为：

```json
{
  "code": 200,
  "message": "success",
  "data": {}
}
```

## 数据库建表

服务启动时会自动建表，也可手动执行：

- `server/sql/001_create_asset_inventory.sql`
