# OAuth2 授权码模式对接说明

## 1. 文档目的

本地联调时有一个必须满足的前置条件：

- `OAUTH_REDIRECT_URI` 必须是 `http://localhost:3000/api/auth/callback`
- 因此后端服务在本地启动时，端口务必是 `3000`
- 这里不是推荐值，也不是示例值，而是当前对接要求中的固定回调地址
- 如果服务不是启动在 `3000` 端口，将无法正确接收认证中心回调，授权码模式流程会直接失败

目标效果如下：

1. 应用访问授权地址。
2. 用户被跳转到登录页，输入用户名和密码。
3. 登录成功后，认证服务跳转回应用配置的回调地址。
4. 回调地址中会携带 `code`，如果请求时传了 `state`，也会原样带回。
5. 应用拿到 `code` 后，再调用 token 接口换取 `access_token` 等令牌信息。

---

## 2. 整体流程

OAuth2 授权码模式的完整流程可以理解为以下 6 步：

### 2.1 发起授权

浏览器访问：

```text
http://leaf-auth-server.dev.jinxin.cloud/auth2/oauth2/authorize?client_id=aitraining&response_type=code&scope=openid%20all&state=123&redirect_uri=http://localhost:3000/api/auth/callback
```

#### 2.1.1 参数说明

| 参数名          | 是否必填 | 说明                                                         |
| --------------- | -------- | ------------------------------------------------------------ |
| `client_id`     | 是       | 应用在认证中心注册后的客户端 ID，例如：`aitraining`      |
| `response_type` | 是       | 固定传 `code`，表示走授权码模式                              |
| `scope`         | 是       | 申请的授权范围，例如：`openid all`                           |
| `state`         | 否       | 应用自定义透传参数，认证成功后会原样返回，通常用于防重放、防串联请求、保持上下文 |
| `redirect_uri`  | 是       | 登录成功后的回调地址，当前对接时必须固定传 `http://localhost:3000/api/auth/callback`，因此本地服务端口也必须固定为 `3000` |

### 2.2 用户登录

认证中心展示登录页，用户输入用户名和密码。

### 2.3 登录成功回调

认证中心跳转到：

```text
http://localhost:3000/api/auth/callback?code=xxxxx&state=123
```

注意：

- 回调目标固定为 `http://localhost:3000/api/auth/callback`
- 业务服务必须实际监听本地 `3000` 端口并处理 `/api/auth/callback`
- 不要将本地服务启动在其他端口后再期望认证中心自动改写回调地址，这不会生效

### 2.4 服务端换 token

业务服务端提取 `code=xxxxx` 后，以 **POST** 方式访问：

```text
http://leaf-auth-server.dev.jinxin.cloud/auth2/oauth2/token
```

并提交以下参数：

| 参数名          | 示例值                             |
| --------------- | ---------------------------------- |
| `redirect_uri`  | `http://localhost:3000/api/auth/callback`      |
| `grant_type`    | `authorization_code`               |
| `code`          | `xxxxx`                            |
| `client_id`     | `aitraining`                    |
| `client_secret` | `29b9635df0164eb890d99a58ffa7f8f2` |

请求方式为：

- Method：`POST`
- Content-Type：`multipart/form-data`

这里要特别注意：

- 换 token 时提交的 `redirect_uri` 必须与发起授权时使用的 `redirect_uri` 完全一致
- 本项目中应固定为 `http://localhost:3000/api/auth/callback`
- 如果你把本地服务启动在非 `3000` 端口，或把这里改成其他地址，认证中心校验时通常会直接失败

### 2.5 获取 token 响应

认证中心校验通过后，返回 token 信息。典型返回内容一般会包含：

- `access_token`
- `token_type`
- `expires_in`
- `refresh_token`
- `id_token`
- `scope`

返回内容示例：

```json
{
	"access_token": "eyJraWQiOiJTRUFCT1hEQVRBIiwiYWxnIjoiUlMyNTYifQ.eyJzdWIiOiJhZG1pbiIsImF1ZCI6ImF1dGgtc2VydmVyLWRpa29uZyIsIm5iZiI6MTc2MDk0ODE0OSwic2NvcGUiOlsiYWxsIiwib3BlbmlkIl0sImlzcyI6Imh0dHA6Ly95ankuZGV2LmppbnhpbjIzNC5jbG91ZDo5MDAwL2F1dGgyIiwiZXhwIjoxNzYwOTQ5OTQ5LCJpYXQiOjE3NjA5NDgxNDksImp0aSI6IjM5Y2MyODRmLTg1OGItNGE1Mi04OWIzLTVmY2IxMjkwZWY4NSJ9.AnF98_DM143oM7UOqkEJ3LpilGrfJ6O5l7eIr0pr3KGNVU-PDBST9Dhr8lPVeL72vwOQNLXpAtIJXtWDXNjYcupDpD8H3ZIWHeUCIbmV2osaY8vmpuEK_QpfecwNv2VbvxwS2T74vIOefz6y2A6XiUxjB2ginxVhDOyPH3vOtf2ZY7QQpT6K4GBF64Z8t7A7GtbClDXHlOzM3RJDKsmx-s9NpQeSshBaRnQmnNA7TJrWMRFuXPOPKJ7BcIXqDxFM0an4-I-vGLmLEWEjF-UZDMPso_20rSki-HVEHjpXSw3_SHMEa9be5dX6Nq8HRc0LiJ4IyIhNXVgzhg6YypllYA",
	"refresh_token": "Hmdj4QDznGSufJsMiZ_2Yi8hC1Fq3vTuDplSWJ2Q34Vb-V4Ywr9y0RIYDz-wi5khPj-BsYcZ0aShNrWUYebu5fasYE5Q8nME3nOCzABB3Z-v8b9g8aC-HTKYLPR7YDoo",
	"scope": "all openid",
	"id_token": "eyJraWQiOiJTRUFCT1hEQVRBIiwiYWxnIjoiUlMyNTYifQ.eyJzdWIiOiJhZG1pbiIsImF1ZCI6ImF1dGgtc2VydmVyLWRpa29uZyIsImF6cCI6ImF1dGgtc2VydmVyLWRpa29uZyIsImlzcyI6Imh0dHA6Ly95ankuZGV2LmppbnhpbjIzNC5jbG91ZDo5MDAwL2F1dGgyIiwiZXhwIjoxNzYwOTQ5OTQ5LCJpYXQiOjE3NjA5NDgxNDksImp0aSI6ImNmYTMxYTQ2LTk1M2ItNDhiYy04YjY2LTRlZmNiNzgyNmFhYyJ9.kQ081XsoDbLxYoTHQJVaDvx2pNIVhHEbCasQ3PDXO_Wxby_v-hwsEYgyp2lK1j05XmenumVu9jSPoEExu7wtb1S459S-UmwZi81hGEOi7NK9hNNj2iGlPmYnpnM084rptIu-XoRZqlLVRvTcVXhmaYhtbXcImxjvSLPP7CyVqi3Q-1DGuGZCr4Miqd0Jw-r8LA5aluDU2ZlRypCU8oepipfixdtrRSPrnX2VCZxEUtIAVuCggucBzHr2p85Q5jWtQAoK97mjXfhogoWlIVZv8hTKpvPa750tP_Fe6dewFGxBdyG2x3AuIVDE1VwdSW5ywSfB62R29RQdDGKEDcbHfA",
	"token_type": "Bearer",
	"expires_in": 1800 //秒
}
```

### 2.6 获取 token 后的接口调用

1. 成功拿到 `access_token` 后存入`cookie`中，后续所有需要登录态的接口请求都应携带 `Authorization: Bearer {access_token}`（也可以同时补充 `seabox_acc_token` Cookie）。
2. 需要获取当前登录用户信息时，再调用 `/auth2/api/v2/user/getLoginUser`。

---

## 3. 退出登录流程

当前 `http://localhost:3000/` 的退出登录逻辑已经调整为前端直接对接认证中心，整体链路如下。

### 3.1 流程说明

1. 用户点击“退出登录”。
2. 前端先从本地 `Cookie` 中读取已保存的 `oauth_access_token`。
3. 前端以 `POST` 方式调用认证中心接口：

```text
http://leaf-auth-server.dev.jinxin.cloud/auth2/api/v2/login/logoutTicket
```

请求时会携带：

- Header：`Authorization: Bearer {oauth_access_token}`
- Credentials：`include`

4. 认证中心返回 `logoutTicket`，典型响应如下：

```json
{
  "status": 200,
  "msg": "操作成功！",
  "success": true,
  "data": "cf4671ad-5b8c-448e-98b6-ffb6bda37678"
}
```

其中 `data` 字段即为本次登出使用的 `logoutTicket`。

5. 前端在成功拿到 `logoutTicket` 后，再清理本地登录态：

- 清掉本地保存 token 的 Cookie

6. 前端使用浏览器直接跳转到认证中心登出地址：

```text
http://leaf-auth-server.dev.jinxin.cloud/auth2/oauth/logout?client_id=aitraining&post_logout_redirect_uri={你的前端项目url如http://localhost:3000}&logout_ticket={logoutTicket}&state=123
```

7. 认证中心完成登出后，浏览器回跳到：

```text
http://localhost:3000
```

### 3.2 前端实现要点

- 获取 `logoutTicket` 时必须带 `Authorization` 请求头，否则认证中心无法识别当前登录用户。
- 必须先成功获取 `logoutTicket`，再跳转 `/oauth/logout`，`logout_ticket` 不能写死。
- 本地 `oauth_access_token` 的清理时机放在拿到 `logoutTicket` 之后，避免因提前清理 token 导致无法继续完成登出链路。
- 当前前端不再调用后端 `/api/auth/logout` 参与登出流程。

### 3.3 当前使用的关键参数

| 参数名 | 当前值 |
| --- | --- |
| `client_id` | `aitraining` |
| `post_logout_redirect_uri` | `http://localhost:3000` |
| `state` | `123` |
