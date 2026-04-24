# Auth服务接口说明

## 1. 说明

本文档补充仓库中所有 controller 暴露接口的请求示例与响应示例。

- 示例中的 `headers`、`query`、`body`、`multipart` 仅用于表达请求结构。
- `JSONResult<T>` 的包装结构基于项目通用风格示例化为 `code/message/data`。
- `BaseResponse<T>` 结构来自源码，固定为 `code/message/data`。
- 文件下载、图片下载这类非 JSON 响应，使用 JSON 描述其响应形态。

### 接口概览与字段约定

以下内容为当前统一维护的 Auth 接口说明，便于集中查阅接口概览、字段约定与示例。

#### 文档范围

当前仓库提供 Auth 服务相关 Feign 接口定义，使用文档重点说明：

- 路由与 HTTP 方法
- 参数位置
- 返回包装结构
- 常见数据对象字段约定

#### 本地 OAuth2 回调约束

本项目在本地联调 OAuth2 授权码模式时，回调地址不是可随意变更的示例值，而是固定约束：

- `OAUTH_REDIRECT_URI` 必须配置为 `http://localhost:3000/api/auth/callback`
- 因为回调地址固定包含 `localhost:3000`，所以后端服务在本地启动联调时，服务端口务必使用 `3000`
- 如果本地服务启动在其他端口，例如 `3001`、`8080`，将无法正确接收认证中心回调，进而导致授权码登录流程失败

涉及 OAuth2 授权码登录、回调处理、`code` 换 token 等场景时，均应按上述固定配置执行。

在本文档中涉及的应用标识约定如下：

- `appCode` 为应用编号，每个应用只会有一个 `appCode`
- `moduleCode` 为应用中每个模块的编号，一个应用可能会有多个 `moduleCode`

这两个值都需要开发人员在创建项目时事先指定好，并保存到项目中。

#### 返回结构

##### `JSONResult<T>`

`/api/...`、`/api/v2/...` 等接口通常返回 `JSONResult<T>`。

使用时建议按以下约定理解：

- 顶层字段通常包含：`code`、`message`、`data`
- 业务数据优先从 `data` 字段读取
- 列表接口若返回分页对象，`data` 为分页对象，分页列表字段使用 `dataList`

##### `BaseResponse<T>`

`/external/api/...` 接口使用 `BaseResponse<T>`。

固定字段：

- `code`
- `message`
- `data`

#### 字段约定

##### 通用约定

- 长整型 ID：前端和 Node 侧建议按 `string` 处理
- 时间字段：通常使用字符串返回，常见字段名为 `createTm`、`modifyTm`
- 布尔开关：以 `true/false` 形式传递

##### 常见对象

`TokenVO`

- `accessToken`
- `refreshToken`

`UserLoginVO`

常见字段：

- `userId`
- `userLoginName`
- `cnName`
- `emailAddress`
- `phoneNumber`
- `tenant`
- `roleList`
- `organizationList`

`AuthUserInfoVO`

常见字段：

- `userId`
- `userLoginName`
- `cnName`
- `tenantId`
- `orgId`

`AuthOrganizationVO`

常见字段：

- `orgId`
- `orgName`
- `tenantId`
- `parentLvId`

`AuthRoleVO`

常见字段：

- `roleId`
- `roleName`
- `tenantId`

#### 接口概览

##### 登录与 Token

| 方法 | 路径 | 返回类型 | 参数说明 |
|---|---|---|---|
| POST | `/api/v2/login/authLoginRequest` | `JSONResult<UserLoginVO>` | body: `username`、`password` |
| GET | `/api/v2/login/getLoginTokenByUserLoginName` | `JSONResult<TokenVO>` | query: `userLoginName` |
| GET | `/api/v2/login/getLoginToken` | `JSONResult<TokenVO>` | 无参 |
| GET | `/api/v2/login/getBase64LoginToken` | `JSONResult<TokenVO>` | 无参 |
| POST | `/api/v2/login/logoutTicket` | `JSONResult<String>` | 无参，依赖当前登录态 |
| GET | `/api/v2/login/ticket` | `JSONResult<String>` | 无参 |
| GET | `/api/v2/login/ticket/userinfo` | `JSONResult<UserLoginVO>` | query: `ticket` |

##### 当前登录用户与用户查询

| 方法 | 路径 | 返回类型 | 参数说明 |
|---|---|---|---|
| GET | `/api/v2/user/getLoginUser` | `JSONResult<UserLoginVO>` | 无参 |
| GET | `/api/v2/user/getLoginUserAllInfo` | `JSONResult<UserLoginVO>` | 无参 |
| GET | `/api/v2/user/getLoginUserAllInfoWithAllTenantPerms` | `JSONResult<UserLoginVO>` | 无参 |
| POST | `/api/v2/user/getLoginUserInfo` | `JSONResult<UserLoginVO>` | body: `tenant`、`permission`、`appCodes`、`permissionCodes`、`role`、`group`、`system`、`org`、`token` |
| GET | `/api/v2/user/refreshLoginUser` | `JSONResult<UserLoginVO>` | query: `refreshToken` |
| POST | `/api/v2/user/listUserInfoByEntity` | `JSONResult<List<AuthUserInfoVO>>` | body: `ids`、`queryType`、`tenantId` |
| GET | `/api/v2/user/listUserConsecutiveSupervisors` | `JSONResult<List<AuthUserInfoVO>>` | query: `userId` |
| GET | `/api/v2/user/getUserInfoByUserIdAndTenantId` | `JSONResult<UserLoginVO>` | query: `userId`、`tenantId` |
| GET | `/api/v2/user/listOrgManagerIdByOrgIdsAndTenantId` | `JSONResult<List<Long>>` | query: `orgIdList`、`tenantId` |
| POST | `/api/v2/user/pageUserInfosByEntity` | `JSONResult<PageResult<AuthUserInfoVO>>` | body: `pageNum`、`pageSize`、`tenantId`、`keyWords`、`organizationId`、`organizationIds`、`authRoleId`、`tenantIds`、`userIds`、`launchStatusCd`、`ifAuthed`、`ifDelete` |
| GET | `/api/v2/user/listUserInfoByUserLoginNameList` | `JSONResult<List<AuthUserInfoVO>>` | query: `userLoginNameList` |

##### 组织、角色、应用权限

| 方法 | 路径 | 返回类型 | 参数说明 |
|---|---|---|---|
| GET | `/api/v2/organ/listOrganizationByTenantId` | `JSONResult<List<AuthOrganizationVO>>` | query: `tenantId` |
| POST | `/api/v2/organ/listOrganizationByEntity` | `JSONResult<List<AuthOrganizationVO>>` | body: `tenantId`、`keyword` |
| GET | `/api/v2/organ/listOrganizationAndUserIdByTenantId` | `JSONResult<List<AuthOrganizationWithUserIdVO>>` | query: `tenantId` |
| GET | `/api/v2/organ/selectOrganizationByOrgId` | `JSONResult<AuthOrganizationVO>` | query: `orgId`、`tenantId` |
| GET | `/api/v2/organ/listUserIdsByOrgId` | `JSONResult<List<Long>>` | query: `orgId` |
| POST | `/api/v2/organ/listOrganizationByOrgIds` | `JSONResult<List<AuthOrganizationVO>>` | body: `List<Long>` |
| GET | `/api/v2/role/listRoleBySystemIdAndTenantId` | `JSONResult<List<AuthRoleVO>>` | query: `systemId`、`tenantId` |
| GET | `/api/v2/system/validateApiAccessKey` | `JSONResult<SystemAuthorizationVO>` | query: `apiAccessKey` |
| GET | `/api/v2/system/getApiAuthorization` | `JSONResult<ApiAuthorizationVO>` | query: `authorizedSystemId`、`sourceSysId` |
| GET | `/api/v2/system/listInPlatformApiBySystemCode` | `JSONResult<List<PlatformApiVO>>` | query: `systemCode` |

##### 外部接口

| 方法 | 路径 | 返回类型 | 参数说明 |
|---|---|---|---|
| POST | `/external/api/user/login` | `BaseResponse<OauthUserVO>` | body: `loginParam`、`password`、`appCode`、`flag`、`clientId`、`clientSecret`、`loginEnum`、`tenantId` 等 |
| GET | `/external/api/user/getUserInfo` | `BaseResponse<OauthUserVO>` | query: `token` |
| GET | `/external/api/user/getCurrentUser` | `BaseResponse<OauthUserVO>` | query: `token` |

#### 分页与参数位置约定

##### 分页对象

若接口返回分页数据，通常关注以下字段：

- `pageNum`
- `pageSize`
- `total`
- `data`

##### 参数位置

- `GET` 接口的简单参数：通常走 query
- `POST` 接口的复杂对象：通常走 JSON body
- 数组参数：
  - `GET` 场景一般按 query/form 传递
  - `POST` 场景一般放在 JSON body 中

## 3. 通用响应包装

### 3.1 `JSONResult<T>`

```json
{
  "code": "200",
  "message": "成功",
  "data": {}
}
```

### 3.2 `BaseResponse<T>`

```json
{
  "code": "200",
  "message": "成功",
  "data": {}
}
```

### 3.3 Interface Controller 注释整理

以下说明根据 `api/src/main/java/com/seaboxdata/auth/api/controller` 下各个 interface controller 的方法注释、`@AuthDesc` 注解以及相关 DTO/VO 字段注释整理，作为后续请求/响应示例的补充说明。

#### 3.3.1 登录接口 `IAuthLoginController`

- `POST /api/v2/login/authLoginRequest`
  接口描述：用户 HTTP 登录。
  请求参数：`BaseLoginReqDTO`，`username` 为用户名，`password` 为密码，两个字段均不能为空。
  响应数据：`JSONResult<UserLoginVO>`，`data` 为登录用户信息，包含 `tenantId`、`tenant`、`groupList`、`organizationList`、`roleList`、`systemList`、`permissionList`、`accessToken`、`refreshToken`、`expiresIn` 等字段。
- `GET /api/v2/login/getLoginTokenByUserLoginName`
  接口描述：根据用户名获取登录用户的 token，注释说明跨域时可使用。
  请求参数：查询参数 `userLoginName`，含义为用户名。
  响应数据：`JSONResult<TokenVO>`，`data.accessToken` 为访问令牌，`data.refreshToken` 为刷新令牌。
- `GET /api/v2/login/getLoginToken`
  接口描述：获取当前登录用户的 token。
  请求参数：无业务入参，通常依赖当前登录态。
  响应数据：`JSONResult<TokenVO>`，返回访问令牌和刷新令牌。
- `GET /api/v2/login/getBase64LoginToken`
  接口描述：获取当前登录用户的 base64 加密 token。
  请求参数：无业务入参，通常依赖当前登录态。
  响应数据：`JSONResult<TokenVO>`，返回 base64 编码后的 `accessToken` 和 `refreshToken`。
- `POST /api/v2/login/logoutTicket`
  接口描述：获取当前登录用户的登出票据，用于后续拼接 `/oauth/logout` 地址。
  请求参数：无业务 body，通常依赖当前登录态，调用时建议带 `Authorization: Bearer {access_token}`，跨站场景可同时带认证中心 Cookie。
  响应数据：`JSONResult<String>`，`data` 为本次登出使用的一次性 `logoutTicket`。
  典型响应示例：

  ```json
  {
    "status": 200,
    "msg": "操作成功！",
    "success": true,
    "data": "cf4671ad-5b8c-448e-98b6-ffb6bda37678"
  }
  ```

  推荐使用方式：
  1. 先调用本接口获取 `logoutTicket`。
  2. 再跳转：
     `http://leaf-auth-server.dev.jinxin.cloud/auth2/oauth/logout?client_id=aitraining&post_logout_redirect_uri=http://localhost:3000&logout_ticket={logoutTicket}&state=123`
- `GET /api/v2/login/ticket`
  接口描述：获取登录用户票据。
  请求参数：无业务入参，通常依赖当前登录态。
  响应数据：`JSONResult<String>`，`data` 为一次性票据字符串。
- `GET /api/v2/login/ticket/userinfo`
  接口描述：根据票据换取用户信息；接口注释说明该接口与 `/api/v2/login/ticket` 配套，用于解决跨域获取用户信息问题。
  请求参数：查询参数 `ticket`，含义为票据。
  响应数据：`JSONResult<UserLoginVO>`，`data` 为票据对应的登录用户信息。

#### 3.3.2 用户接口 `IAuthUserInfoController`

- `GET /api/v2/user/getLoginUser`
  接口描述：获取登录用户信息，不包括 `accessToken` 和 `refreshToken`。
  请求参数：无业务入参，依赖当前登录态。
  响应数据：`JSONResult<UserLoginVO>`，返回当前用户基础信息、部门信息、角色信息等。
- `GET /api/v2/user/getLoginUserAllInfo`
  接口描述：获取登录用户全量信息。
  请求参数：无业务入参。
  响应数据：`JSONResult<UserLoginVO>`，相较基础信息会补充更多租户、角色、应用、权限和 token 相关字段。
- `GET /api/v2/user/getLoginUserAllInfoWithAllTenantPerms`
  接口描述：获取登录用户全量信息，且包含所有租户的权限信息。
  请求参数：无业务入参。
  响应数据：`JSONResult<UserLoginVO>`，重点关注 `permissionList` 中跨租户权限数据。
- `POST /api/v2/user/getLoginUserInfo`
  接口描述：按需获取登录用户部分信息。
  请求参数：`UserDetailQueryDTO`，`tenant` 是否包含租户信息，`permission` 是否包含权限信息，`appCodes` 应用编码数组，`permissionCodes` 权限编码数组，`role` 是否包含角色信息，`group` 是否包含分组信息，`system` 是否包含应用信息，`org` 是否包含组织信息，`token` 是否包含 token 信息。
  响应数据：`JSONResult<UserLoginVO>`，根据请求开关返回对应维度的用户信息。
- `GET /api/v2/user/refreshLoginUser`
  接口描述：刷新登录用户信息。
  请求参数：查询参数 `refreshToken`，含义为刷新令牌。
  响应数据：`JSONResult<UserLoginVO>`，通常会返回新的 token 与最新登录用户信息。
- `POST /api/v2/user/listUserInfoByEntity`
  接口描述：根据条件获取用户信息列表。
  请求参数：`UserInfoQueryReqDTO`，`ids` 为传入 ID 数组，`queryType` 为查询类型，`tenantId` 为租户 ID。
  响应数据：`JSONResult<List<AuthUserInfoVO>>`，返回匹配到的用户列表。
- `GET /api/v2/user/listUserConsecutiveSupervisors`
  接口描述：获取用户连续多级主管。
  请求参数：查询参数 `userId`，含义为用户标识。
  响应数据：`JSONResult<List<AuthUserInfoVO>>`，按层级返回主管用户信息列表。
- `GET /api/v2/user/getUserInfoByUserIdAndTenantId`
  接口描述：根据用户标识和租户标识获取用户信息。
  请求参数：查询参数 `userId` 为用户标识，`tenantId` 为租户标识。
  响应数据：`JSONResult<UserLoginVO>`，返回该用户在指定租户下的登录态信息。
- `GET /api/v2/user/listOrgManagerIdByOrgIdsAndTenantId`
  接口描述：获取组织管理员 ID。
  请求参数：查询参数 `orgIdList` 为组织标识数组，`tenantId` 为租户标识。
  响应数据：`JSONResult<List<Long>>`，返回组织管理员用户 ID 列表。
- `POST /api/v2/user/pageUserInfosByEntity`
  接口描述：分页查询用户信息。
  请求参数：`UserInfoQueryDTO`，除分页公共字段外，主要包括 `encryptKeyWords` 加密关键字、`launchStatusCd` 账号状态、`organizationId` 部门、`grpId` 分组、`authRoleId` 账号类型、`organizationIds` 部门 ID 数组、`ifAuthed` 授权状态、`tenantIds` 租户 ID 数组、`ifDelete` 是否删除、`userIds` 用户 ID 数组。
  响应数据：`JSONResult<PageResult<AuthUserInfoVO>>`，`data.dataList` 为用户列表，`data.total/current/size` 为分页信息。
- `GET /api/v2/user/listUserInfoByUserLoginNameList`
  接口描述：根据用户名批量查询用户信息。
  请求参数：查询参数 `userLoginNameList`，含义为用户名数组。
  响应数据：`JSONResult<List<AuthUserInfoVO>>`，返回用户名对应的用户信息列表。

#### 3.3.3 组织、角色、应用、平台接口

- `GET /api/v2/organ/listOrganizationByTenantId`
  接口描述：根据租户 ID 获取部门信息。
  请求参数：查询参数 `tenantId`，含义为租户 ID。
  响应数据：`JSONResult<List<AuthOrganizationVO>>`，返回租户下的部门树或部门列表。
- `POST /api/v2/organ/listOrganizationByEntity`
  接口描述：根据查询实体查询部门信息。
  请求参数：`OrganizationQueryDTO`，`tenantId` 为租户 ID，`keyword` 为关键字。
  响应数据：`JSONResult<List<AuthOrganizationVO>>`，返回符合条件的部门信息列表。
- `GET /api/v2/organ/listOrganizationAndUserIdByTenantId`
  接口描述：根据租户 ID 获取部门以及部门下的用户 ID。
  请求参数：查询参数 `tenantId`。
  响应数据：`JSONResult<List<AuthOrganizationWithUserIdVO>>`，返回部门与用户 ID 关联数据。
- `GET /api/v2/organ/selectOrganizationByOrgId`
  接口描述：根据租户 ID 和部门 ID 查询部门信息。
  请求参数：查询参数 `orgId` 为部门 ID，`tenantId` 为租户 ID。
  响应数据：`JSONResult<AuthOrganizationVO>`，返回单个部门详情。
- `GET /api/v2/organ/listUserIdsByOrgId`
  接口描述：根据部门 ID 获取该部门下的所有用户 ID。
  请求参数：查询参数 `orgId`，含义为部门 ID。
  响应数据：`JSONResult<List<Long>>`，返回用户 ID 列表。
- `POST /api/v2/organ/listOrganizationByOrgIds`
  接口描述：根据部门 ID 列表获取部门信息。
  请求参数：请求体为 `List<Long>`，含义为部门 ID 列表。
  响应数据：`JSONResult<List<AuthOrganizationVO>>`，返回部门信息列表。
- `GET /api/v2/role/listRoleBySystemIdAndTenantId`
  接口描述：根据应用 ID 和租户 ID 查询应用下的所有角色信息。
  请求参数：查询参数 `systemId` 为应用 ID，`tenantId` 为租户 ID。
  响应数据：`JSONResult<List<AuthRoleVO>>`，返回角色列表。
- `GET /api/v2/system/validateApiAccessKey`
  接口描述：验证 API 访问密钥。
  请求参数：查询参数 `apiAccessKey`，含义为 API 访问认证 Key。
  响应数据：`JSONResult<SystemAuthorizationVO>`，返回当前访问密钥对应的系统授权信息。
- `GET /api/v2/system/getApiAuthorization`
  接口描述：根据授权应用标识和被授权应用标识查询 API 授权信息。
  请求参数：查询参数 `authorizedSystemId` 为被授权应用标识，`sourceSysId` 为授权应用标识。
  响应数据：`JSONResult<ApiAuthorizationVO>`，通常包含授权方、被授权方和可访问 API 列表。
- `GET /api/v2/system/listInPlatformApiBySystemCode`
  接口描述：根据应用编码查询内部 API 列表。
  请求参数：查询参数 `systemCode`，含义为应用编码。
  响应数据：`JSONResult<List<PlatformApiVO>>`，返回平台内部 API 元数据列表。
- `GET /api/v2/platform/getLicenseActivate`
  接口描述：获取平台信息。
  请求参数：无业务入参。
  响应数据：`JSONResult<AuthPlatformLicenseActivateVO>`，主要字段包括 `platformLicenseActivateId`、`breadcrumbBarColor`、`footerScript`、`loginBackgroundImage`、`loginLogo`、`loginTitle`、`platformLogo`、`subjectColor`、`platformLicenseModeId`、`licenseModeName`、`maximumTenantCnt`、`maximumUserCnt`、`manageMode`、`multiTenantMode`、`platformExpireTm`、`platformAuthorizationCd`、`platformLicenseCd`、`platformTitle`、`platformName`、`websiteTabLogo`、`loginPromptMessage`。
- `GET /api/v2/platform/getPlatformLogo`
  接口描述：获取平台 logo。
  请求参数：无业务入参。
  响应数据：二进制流，`Content-Type` 为 `application/octet-stream`。
- `GET /api/v2/platform/getWebsiteTabLogoUrl`
  接口描述：获取网站页签 logo。
  请求参数：无业务入参。
  响应数据：二进制流，`Content-Type` 为 `application/octet-stream`。

#### 3.3.4 日志、邮箱、模板、消息接口

- `POST /api/v2/logRecord/pageLogRecord`
  接口描述：分页查询日志。
  请求参数：`LogQueryReqDTO`，用于传入日志分页查询条件。
  响应数据：`JSONResult<PageResult<LogRecordVO>>`，单条日志主要包含 `logRecordId`、`applId`、`operIp`、`userId`、`operNum`、`tenantName`、`tenantId`、`interfaceElapsed`、`operBrowserVersion`、`os`、`operFunc`、`operTm`、`operBrowser`、`operMethodPara`、`operMethodResult`、`operEnName`、`userName`、`operCnName`、`operMenu`、`userCnName`、`applNum`、`applName`、`logTypeCd`。
- `POST /api/v2/emailConfig/exportEmailConfig`
  接口描述：导出邮箱配置。
  请求参数：`EmailConfigExportQueryDTO`，含义为导出邮箱查询条件。
  响应数据：文件流响应，返回导出的邮箱配置文件。
- `POST /api/v2/emailConfig/importEmailConfig`
  接口描述：导入邮箱配置。
  请求参数：`multipart/form-data`，文件字段名为 `multipartFile`。
  响应数据：`JSONResult<String>`，`data` 一般为导入结果说明。
- `POST /api/v2/msgTempl/exportMsgTempl`
  接口描述：导出消息模板。
  请求参数：`MsgTemplExportQueryDTO`，含义为导出消息模板查询条件。
  响应数据：文件流响应，返回导出的消息模板文件。
- `POST /api/v2/msgTempl/importMsgTempl`
  接口描述：导入消息模板。
  请求参数：`multipart/form-data`，文件字段名为 `multipartFile`。
  响应数据：`JSONResult<String>`，`data` 一般为导入结果说明。
- `GET /api/v2/msgTempl/getMsgTemplByTemplCode`
  接口描述：根据模板编码查询消息模板信息。
  请求参数：查询参数 `templCode`，含义为模板编码。
  响应数据：`JSONResult<MsgTemplInfoVO>`，主要字段包括 `templId`、`tenantId`、`templCode`、`templName`、`templSubject`、`templContent`、`templDesc`、`appCode`、`ifEnabled`。
- `POST /api/v2/message/messageSend`
  接口描述：发送消息。
  请求参数：`MessageSendReqDTO`，含义为发送消息实体。
  响应数据：`JSONResult<Void>`，成功时 `data` 通常为空。
- `POST /api/v2/message/messageSendDirect`
  接口描述：直接发送消息，无需替换参数。
  请求参数：`MessageSendDirectReqDTO`，含义为直接发送消息实体。
  响应数据：`JSONResult<Void>`。
- `POST /api/v2/message/messageSendDirectWithAttachmentList`
  接口描述：直接发送消息，无需替换参数，支持附件。
  请求参数：`multipart/form-data`，`attachmentList` 为附件列表，`content` 为 `MessageSendDirectReqDTO` 对应 JSON 字符串。
  响应数据：`JSONResult<Void>`。
- `POST /api/v2/message/messageSendCustom`
  接口描述：发送自定义消息。
  请求参数：`MessageSendCustomReqDTO`，含义为发送自定义消息实体。
  响应数据：`JSONResult<Void>`。
- `POST /api/v2/message/messageSendCustomWithAttachmentList`
  接口描述：发送自定义消息，支持附件。
  请求参数：`multipart/form-data`，`attachmentList` 为附件列表，`content` 为 `MessageSendCustomReqDTO` 对应 JSON 字符串。
  响应数据：`JSONResult<Void>`。

## 4. `/api/v2/login`

### 4.1 `POST /api/v2/login/authLoginRequest`

接口描述：用户HTTP登录。

请求参数：请求体 `baseLoginReqDTO`，类型 `BaseLoginReqDTO`。

响应数据：`JSONResult<UserLoginVO>`。

请求示例：

```json
{
  "headers": {
    "Content-Type": "application/json"
  },
  "body": {
    "username": "alice",
    "password": "secret"
  }
}
```

响应示例：

```json
{
  "code": "200",
  "message": "成功",
  "data": {
    "userId": 10001,
    "tenantId": 20001,
    "tenantName": "研发中心",
    "userLoginName": "alice",
    "cnName": "Alice Chen",
    "phoneNumber": "13800138000",
    "emailAddress": "alice@example.com",
    "authRoleCode": "TENANT_ADMIN",
    "authRoleId": 30001,
    "tenant": {
      "tenantId": 20001,
      "tenantName": "研发中心",
      "tenantCode": "RD_CENTER",
      "tenantStatus": "0",
      "platformTitle": "Leaf Auth"
    },
    "organizationList": [
      {
        "orgId": 40001,
        "orgName": "平台研发部",
        "orgNum": "DEV001",
        "tenantId": 20001,
        "orgLevel": 2,
        "hasChild": "0"
      }
    ],
    "roleList": [
      {
        "roleId": 30001,
        "roleCd": "TENANT_ADMIN",
        "roleName": "租户管理员",
        "roleStatusCd": "ENABLE"
      }
    ],
    "systemList": [
      {
        "sysId": 50001,
        "sysCode": "leaf-admin",
        "sysDisplayName": "Leaf 管理台",
        "sysUrl": "https://leaf.example.com"
      }
    ],
    "permissionList": [
      {
        "systemCode": "leaf-admin",
        "authPermissionVos": [
          {
            "permissionId": 60001,
            "permissionCd": "user:view",
            "permissionName": "查看用户"
          },
          {
            "permissionId": 60002,
            "permissionCd": "user:edit",
            "permissionName": "编辑用户"
          }
        ],
        "permissionCodes": [
          "user:view",
          "user:edit"
        ]
      }
    ],
    "accessToken": "access-token-example",
    "refreshToken": "refresh-token-example",
    "expiresIn": 1200
  }
}
```

### 4.2 `GET /api/v2/login/getLoginTokenByUserLoginName`

接口描述：根据用户名获取登录用户的token。

请求参数：查询参数 `userLoginName`，类型 `String`，含义为用户名。

响应数据：`JSONResult<TokenVO>`。

请求示例：

```json
{
  "query": {
    "userLoginName": "alice"
  }
}
```

响应示例：

```json
{
  "code": "200",
  "message": "成功",
  "data": {
    "accessToken": "access-token-example",
    "refreshToken": "refresh-token-example"
  }
}
```

### 4.3 `GET /api/v2/login/getLoginToken`

接口描述：获取登录用户的token。

请求参数：无业务入参。

响应数据：`JSONResult<TokenVO>`。

请求示例：

```json
{
  "headers": {
    "Authorization": "Bearer access-token-example"
  }
}
```

响应示例：

```json
{
  "code": "200",
  "message": "成功",
  "data": {
    "accessToken": "access-token-example",
    "refreshToken": "refresh-token-example"
  }
}
```

### 4.4 `GET /api/v2/login/getBase64LoginToken`

接口描述：获取登录用户的token（base64加密）。

请求参数：无业务入参。

响应数据：`JSONResult<TokenVO>`。

请求示例：

```json
{
  "headers": {
    "Authorization": "Bearer access-token-example"
  }
}
```

响应示例：

```json
{
  "code": "200",
  "message": "成功",
  "data": {
    "accessToken": "YmFzZTY0LWFjY2Vzcy10b2tlbg==",
    "refreshToken": "YmFzZTY0LXJlZnJlc2gtdG9rZW4="
  }
}
```

### 4.5 `GET /api/v2/login/ticket`

接口描述：获取登录用户的票据。

请求参数：无业务入参。

响应数据：`JSONResult<String>`。

请求示例：

```json
{
  "headers": {
    "Authorization": "Bearer access-token-example"
  }
}
```

响应示例：

```json
{
  "code": "200",
  "message": "成功",
  "data": "ticket-example-uuid"
}
```

### 3.6 `GET /api/v2/login/ticket/userinfo`

接口描述：根据票据换取用户信息。

请求参数：查询参数 `ticket`，类型 `String`，含义为票据。

响应数据：`JSONResult<UserLoginVO>`。

请求示例：

```json
{
  "query": {
    "ticket": "ticket-example-uuid"
  }
}
```

响应示例：

```json
{
  "code": "200",
  "message": "成功",
  "data": {
    "userId": 10001,
    "tenantId": 20001,
    "userLoginName": "alice",
    "cnName": "Alice Chen",
    "tenant": {
      "tenantId": 20001,
      "tenantName": "研发中心"
    },
    "accessToken": "access-token-example",
    "refreshToken": "refresh-token-example",
    "expiresIn": 1200
  }
}
```

## 4. `/api/v2/user`

### 4.1 `GET /api/v2/user/getLoginUser`

接口描述：获取登录用户信息。

请求参数：无业务入参。

响应数据：`JSONResult<UserLoginVO>`。

请求示例：

```json
{
  "headers": {
    "Authorization": "Bearer access-token-example"
  }
}
```

响应示例：

```json
{
  "code": "200",
  "message": "成功",
  "data": {
    "userId": 10001,
    "tenantId": 20001,
    "userLoginName": "alice",
    "cnName": "Alice Chen",
    "phoneNumber": "13800138000",
    "emailAddress": "alice@example.com",
    "organizationList": [
      {
        "orgId": 40001,
        "orgName": "平台研发部"
      }
    ],
    "roleList": [
      {
        "roleId": 30001,
        "roleName": "租户管理员"
      }
    ]
  }
}
```

#### 字段补充说明

| 字段 | 说明 |
|---|---|
| `userProfilePhoto` | 用户头像。若值以 `http` 开头，可直接作为图片地址使用；否则为文件名，需拼接文件下载地址，例如：`http://leaf-base-server.dev.jinxin.cloud/file/fileName/download?fileName={userProfilePhoto}&show=true` |

### 4.2 `GET /api/v2/user/getLoginUserAllInfo`

接口描述：获取登录用户全量信息。

请求参数：无业务入参。

响应数据：`JSONResult<UserLoginVO>`。

请求示例：

```json
{
  "headers": {
    "Authorization": "Bearer access-token-example"
  }
}
```

响应示例：

```json
{
  "code": "200",
  "message": "成功",
  "data": {
    "userId": 10001,
    "tenantId": 20001,
    "userLoginName": "alice",
    "cnName": "Alice Chen",
    "phoneNumber": "13800138000",
    "emailAddress": "alice@example.com",
    "tenant": {
      "tenantId": 20001,
      "tenantName": "研发中心",
      "tenantCode": "RD_CENTER"
    },
    "organizationList": [
      {
        "orgId": 40001,
        "orgName": "平台研发部",
        "orgNamePath": "/研发中心/平台研发部"
      }
    ],
    "roleList": [
      {
        "roleId": 30001,
        "roleCd": "TENANT_ADMIN",
        "roleName": "租户管理员"
      }
    ],
    "systemList": [
      {
        "sysId": 50001,
        "sysCode": "leaf-admin",
        "sysDisplayName": "Leaf 管理台",
        "sysUrl": "https://leaf.example.com"
      }
    ],
    "permissionList": [
      {
        "systemCode": "leaf-admin",
        "permissionCodes": [
          "user:view",
          "user:edit"
        ]
      }
    ],
    "accessToken": "access-token-example",
    "refreshToken": "refresh-token-example",
    "expiresIn": 1200
  }
}
```

### 4.3 `GET /api/v2/user/getLoginUserAllInfoWithAllTenantPerms`

接口描述：获取登录用户信息(全量信息，包含所有租户的权限信息)。

请求参数：无业务入参。

响应数据：`JSONResult<UserLoginVO>`。

请求示例：

```json
{
  "headers": {
    "Authorization": "Bearer access-token-example"
  }
}
```

响应示例：

```json
{
  "code": "200",
  "message": "成功",
  "data": {
    "userId": 10001,
    "userLoginName": "alice",
    "cnName": "Alice Chen",
    "tenants": [
      {
        "tenantId": 20001,
        "tenantName": "研发中心"
      },
      {
        "tenantId": 20002,
        "tenantName": "销售中心"
      }
    ],
    "permissionList": [
      {
        "systemCode": "leaf-admin",
        "permissionCodes": [
          "user:view",
          "user:edit",
          "role:view"
        ]
      },
      {
        "systemCode": "crm",
        "permissionCodes": [
          "customer:view"
        ]
      }
    ]
  }
}
```

### 4.4 `POST /api/v2/user/getLoginUserInfo`

接口描述：获取登录用户部分信息。

请求参数：请求体 `userDetailQueryDTO`，类型 `UserDetailQueryDTO`。

响应数据：`JSONResult<UserLoginVO>`。

请求示例：

```json
{
  "headers": {
    "Content-Type": "application/json",
    "Authorization": "Bearer access-token-example"
  },
  "body": {
    "tenant": true,
    "permission": true,
    "appCodes": [
      "leaf-admin"
    ],
    "permissionCodes": [
      "user:view"
    ],
    "role": true,
    "group": false,
    "system": true,
    "org": true,
    "token": false
  }
}
```

响应示例：

```json
{
  "code": "200",
  "message": "成功",
  "data": {
    "userId": 10001,
    "userLoginName": "alice",
    "cnName": "Alice Chen",
    "tenant": {
      "tenantId": 20001,
      "tenantName": "研发中心"
    },
    "organizationList": [
      {
        "orgId": 40001,
        "orgName": "平台研发部"
      }
    ],
    "roleList": [
      {
        "roleId": 30001,
        "roleName": "租户管理员"
      }
    ],
    "systemList": [
      {
        "sysId": 50001,
        "sysCode": "leaf-admin"
      }
    ],
    "permissionList": [
      {
        "systemCode": "leaf-admin",
        "permissionCodes": [
          "user:view"
        ]
      }
    ]
  }
}
```

### 4.5 `GET /api/v2/user/refreshLoginUser`

接口描述：刷新登录用户信息。

请求参数：查询参数 `refreshToken`，类型 `String`，含义为刷新令牌。

响应数据：`JSONResult<UserLoginVO>`。

请求示例：

```json
{
  "query": {
    "refreshToken": "refresh-token-example"
  }
}
```

响应示例：

```json
{
  "code": "200",
  "message": "成功",
  "data": {
    "userId": 10001,
    "userLoginName": "alice",
    "accessToken": "new-access-token-example",
    "refreshToken": "new-refresh-token-example",
    "expiresIn": 1200
  }
}
```

### 4.6 `POST /api/v2/user/listUserInfoByEntity`

接口描述：根据条件获取用户信息列表。

请求参数：请求体 `userInfoQueryReqDTO`，类型 `UserInfoQueryReqDTO`。

响应数据：`JSONResult<List<AuthUserInfoVO>>`。

请求示例：

```json
{
  "body": {
    "ids": [
      10001,
      10002
    ],
    "queryType": "USER_ID",
    "tenantId": 20001
  }
}
```

响应示例：

```json
{
  "code": "200",
  "message": "成功",
  "data": [
    {
      "userId": 10001,
      "tenantId": 20001,
      "userLoginName": "alice",
      "cnName": "Alice Chen",
      "phoneNumber": "13800138000",
      "emailAddress": "alice@example.com"
    },
    {
      "userId": 10002,
      "tenantId": 20001,
      "userLoginName": "bob",
      "cnName": "Bob Wang",
      "phoneNumber": "13800138001",
      "emailAddress": "bob@example.com"
    }
  ]
}
```

### 4.7 `GET /api/v2/user/listUserConsecutiveSupervisors`

接口描述：获取用户连续多级主管。

请求参数：查询参数 `userId`，类型 `Long`，含义为用户标识。

响应数据：`JSONResult<List<AuthUserInfoVO>>`。

请求示例：

```json
{
  "query": {
    "userId": 10001
  }
}
```

响应示例：

```json
{
  "code": "200",
  "message": "成功",
  "data": [
    {
      "userId": 10010,
      "userLoginName": "leader1",
      "cnName": "一线主管"
    },
    {
      "userId": 10020,
      "userLoginName": "leader2",
      "cnName": "二线主管"
    }
  ]
}
```

### 4.8 `GET /api/v2/user/getUserInfoByUserIdAndTenantId`

接口描述：获取用户信息。

请求参数：查询参数 `userId`，类型 `Long`，含义为用户标识；查询参数 `tenantId`，类型 `Long`，含义为租户标识。

响应数据：`JSONResult<UserLoginVO>`。

请求示例：

```json
{
  "query": {
    "userId": 10001,
    "tenantId": 20001
  }
}
```

响应示例：

```json
{
  "code": "200",
  "message": "成功",
  "data": {
    "userId": 10001,
    "tenantId": 20001,
    "userLoginName": "alice",
    "cnName": "Alice Chen",
    "tenant": {
      "tenantId": 20001,
      "tenantName": "研发中心"
    }
  }
}
```

### 4.9 `GET /api/v2/user/listOrgManagerIdByOrgIdsAndTenantId`

接口描述：获取组织管理员ID。

请求参数：查询参数 `orgIdList`，类型 `List<Long>`，含义为组织标识数组；查询参数 `tenantId`，类型 `Long`，含义为租户标识。

响应数据：`JSONResult<List<Long>>`。

请求示例：

```json
{
  "query": {
    "orgIdList": [
      40001,
      40002
    ],
    "tenantId": 20001
  }
}
```

响应示例：

```json
{
  "code": "200",
  "message": "成功",
  "data": [
    10010,
    10011
  ]
}
```

### 4.10 `POST /api/v2/user/pageUserInfosByEntity`

接口描述：分页查询用户信息。

请求参数：请求体 `userInfoQueryDTO`，类型 `UserInfoQueryDTO`，含义为查询条件。

响应数据：`JSONResult<PageResult<AuthUserInfoVO>>`。

请求示例：

```json
{
  "body": {
    "pageNum": 1,
    "pageSize": 20,
    "tenantId": 20001,
    "keyWords": "alice",
    "organizationId": 40001,
    "organizationIds": [
      40001,
      40002
    ],
    "authRoleId": 30001,
    "tenantIds": [
      20001
    ],
    "userIds": [
      10001,
      10002
    ],
    "launchStatusCd": "ENABLE",
    "ifAuthed": 1,
    "ifDelete": "0"
  }
}
```

响应示例：

```json
{
  "code": "200",
  "message": "成功",
  "data": {
    "dataList": [
      {
        "userId": 10001,
        "tenantId": 20001,
        "userLoginName": "alice",
        "cnName": "Alice Chen"
      },
      {
        "userId": 10002,
        "tenantId": 20001,
        "userLoginName": "bob",
        "cnName": "Bob Wang"
      }
    ],
    "total": 2,
    "size": 20,
    "current": 1
  }
}
```

### 4.11 `GET /api/v2/user/listUserInfoByUserLoginNameList`

接口描述：根据用户名批量查询用户信息。

请求参数：查询参数 `userLoginNameList`，类型 `List<String>`，含义为用户名数组。

响应数据：`JSONResult<List<AuthUserInfoVO>>`。

请求示例：

```json
{
  "query": {
    "userLoginNameList": [
      "alice",
      "bob"
    ]
  }
}
```

响应示例：

```json
{
  "code": "200",
  "message": "成功",
  "data": [
    {
      "userId": 10001,
      "userLoginName": "alice",
      "cnName": "Alice Chen"
    },
    {
      "userId": 10002,
      "userLoginName": "bob",
      "cnName": "Bob Wang"
    }
  ]
}
```

## 5. `/api/v2/organ`

### 5.1 `GET /api/v2/organ/listOrganizationByTenantId`

接口描述：根据租户ID获取部门信息。

请求参数：查询参数 `tenantId`，类型 `Long`，含义为租户ID。

响应数据：`JSONResult<List<AuthOrganizationVO>>`。

请求示例：

```json
{
  "query": {
    "tenantId": 20001
  }
}
```

响应示例：

```json
{
  "code": "200",
  "message": "成功",
  "data": [
    {
      "orgId": 40000,
      "orgName": "研发中心",
      "tenantId": 20001,
      "child": [
        {
          "orgId": 40001,
          "orgName": "平台研发部",
          "tenantId": 20001
        }
      ]
    }
  ]
}
```

### 5.2 `POST /api/v2/organ/listOrganizationByEntity`

接口描述：根据查询实体查询部门信息。

请求参数：请求体 `queryDTO`，类型 `OrganizationQueryDTO`。

响应数据：`JSONResult<List<AuthOrganizationVO>>`。

请求示例：

```json
{
  "body": {
    "tenantId": 20001,
    "keyword": "研发"
  }
}
```

响应示例：

```json
{
  "code": "200",
  "message": "成功",
  "data": [
    {
      "orgId": 40001,
      "orgName": "平台研发部",
      "orgNum": "DEV001",
      "tenantId": 20001
    }
  ]
}
```

### 5.3 `GET /api/v2/organ/listOrganizationAndUserIdByTenantId`

接口描述：根据租户ID获取部门ID以及下面的用户Id。

请求参数：查询参数 `tenantId`，类型 `Long`，含义为租户ID。

响应数据：`JSONResult<List<AuthOrganizationWithUserIdVO>>`。

请求示例：

```json
{
  "query": {
    "tenantId": 20001
  }
}
```

响应示例：

```json
{
  "code": "200",
  "message": "成功",
  "data": [
    {
      "orgId": 40001,
      "userIds": [
        10001,
        10002
      ]
    }
  ]
}
```

### 5.4 `GET /api/v2/organ/selectOrganizationByOrgId`

接口描述：根据租户ID和部门ID查询部门信息。

请求参数：查询参数 `orgId`，类型 `Long`，含义为部门ID；查询参数 `tenantId`，类型 `Long`，含义为租户ID。

响应数据：`JSONResult<AuthOrganizationVO>`。

请求示例：

```json
{
  "query": {
    "orgId": 40001,
    "tenantId": 20001
  }
}
```

响应示例：

```json
{
  "code": "200",
  "message": "成功",
  "data": {
    "orgId": 40001,
    "orgName": "平台研发部",
    "orgNum": "DEV001",
    "orgStatus": "ENABLE",
    "tenantId": 20001,
    "orgAdminId": 10010,
    "orgAdminName": "部门负责人"
  }
}
```

### 5.5 `GET /api/v2/organ/listUserIdsByOrgId`

接口描述：根据部门ID获取该部门下的所有用户ID。

请求参数：查询参数 `orgId`，类型 `Long`，含义为部门ID。

响应数据：`JSONResult<List<Long>>`。

请求示例：

```json
{
  "query": {
    "orgId": 40001
  }
}
```

响应示例：

```json
{
  "code": "200",
  "message": "成功",
  "data": [
    10001,
    10002,
    10003
  ]
}
```

### 5.6 `POST /api/v2/organ/listOrganizationByOrgIds`

接口描述：根据部门ID列表获取部门信息。

请求参数：请求体 `orgIds`，类型 `List<Long>`，含义为部门ID列表。

响应数据：`JSONResult<List<AuthOrganizationVO>>`。

请求示例：

```json
{
  "body": [
    40001,
    40002
  ]
}
```

响应示例：

```json
{
  "code": "200",
  "message": "成功",
  "data": [
    {
      "orgId": 40001,
      "orgName": "平台研发部"
    },
    {
      "orgId": 40002,
      "orgName": "质量保障部"
    }
  ]
}
```

## 6. `/api/v2/role`

### 6.1 `GET /api/v2/role/listRoleBySystemIdAndTenantId`

接口描述：根据应用ID和租户ID查询应用下的所有角色信息。

请求参数：查询参数 `systemId`，类型 `Long`，含义为应用ID；查询参数 `tenantId`，类型 `Long`，含义为租户ID。

响应数据：`JSONResult<List<AuthRoleVO>>`。

请求示例：

```json
{
  "query": {
    "systemId": 50001,
    "tenantId": 20001
  }
}
```

响应示例：

```json
{
  "code": "200",
  "message": "成功",
  "data": [
    {
      "roleId": 30001,
      "roleCd": "TENANT_ADMIN",
      "roleName": "租户管理员",
      "tenantId": 20001
    },
    {
      "roleId": 30002,
      "roleCd": "USER",
      "roleName": "普通用户",
      "tenantId": 20001
    }
  ]
}
```

## 7. `/api/v2/system`

### 7.1 `GET /api/v2/system/validateApiAccessKey`

接口描述：验证API访问密钥。

请求参数：查询参数 `apiAccessKey`，类型 `String`，含义为API访问认证Key。

响应数据：`JSONResult<SystemAuthorizationVO>`。

请求示例：

```json
{
  "query": {
    "apiAccessKey": "app-key-example"
  }
}
```

响应示例：

```json
{
  "code": "200",
  "message": "成功",
  "data": {
    "systemAuthorizationId": 70001,
    "authorizedSysId": 50002,
    "sourceSysId": 50001,
    "appKey": "app-key-example",
    "appSecret": "app-secret-example"
  }
}
```

### 7.2 `GET /api/v2/system/getApiAuthorization`

接口描述：根据授权应用标识和被授权应用标识查询API授权信息。

请求参数：查询参数 `authorizedSystemId`，类型 `Long`，含义为被授权应用标识；查询参数 `sourceSysId`，类型 `Long`，含义为授权应用标识。

响应数据：`JSONResult<ApiAuthorizationVO>`。

请求示例：

```json
{
  "query": {
    "authorizedSystemId": 50002,
    "sourceSysId": 50001
  }
}
```

响应示例：

```json
{
  "code": "200",
  "message": "成功",
  "data": {
    "sourceSystem": {
      "sysId": 50001,
      "sysCode": "leaf-admin",
      "sysDisplayName": "Leaf 管理台"
    },
    "authorizedSystem": {
      "sysId": 50002,
      "sysCode": "crm",
      "sysDisplayName": "CRM"
    },
    "authorizedApi": [
      {
        "platformApiId": 80001,
        "apiName": "查询客户列表",
        "urlPath": "/api/customer/list",
        "requestMode": "GET",
        "sysCode": "crm"
      }
    ]
  }
}
```

### 7.3 `GET /api/v2/system/listInPlatformApiBySystemCode`

接口描述：根据应用编码查询内部API列表。

请求参数：查询参数 `systemCode`，类型 `String`，含义为应用编码。

响应数据：`JSONResult<List<PlatformApiVO>>`。

请求示例：

```json
{
  "query": {
    "systemCode": "leaf-admin"
  }
}
```

响应示例：

```json
{
  "code": "200",
  "message": "成功",
  "data": [
    {
      "platformApiId": 80001,
      "apiName": "查询用户",
      "urlPath": "/api/v2/user/pageUserInfosByEntity",
      "requestMode": "POST",
      "ifOpenInterface": "0",
      "ifLoginCanVisit": "1",
      "ifInsideInterface": "1",
      "sysId": 50001,
      "sysCode": "leaf-admin"
    }
  ]
}
```

## 8. `/api/v2/platform`

### 8.1 `GET /api/v2/platform/getLicenseActivate`

接口描述：获取平台信息。

请求参数：无业务入参。

响应数据：`JSONResult<AuthPlatformLicenseActivateVO>`。

请求示例：

```json
{
  "headers": {
    "Authorization": "Bearer access-token-example"
  }
}
```

响应示例：

```json
{
  "code": "200",
  "message": "成功",
  "data": {
    "platformLicenseActivateId": 90001,
    "breadcrumbBarColor": "#1F3A5F",
    "footerScript": "© 2026 Seabox",
    "loginBackgroundImage": "/files/login-bg.png",
    "loginLogo": "/files/login-logo.png",
    "loginTitle": "Leaf Auth",
    "platformLogo": "/files/platform-logo.png",
    "subjectColor": "#2C7BE5",
    "platformLicenseModeId": 1,
    "licenseModeName": "正式版",
    "maximumTenantCnt": 100,
    "maximumUserCnt": 50000,
    "manageMode": "SAAS",
    "multiTenantMode": "ENABLE",
    "platformExpireTm": "2026-12-31T23:59:59",
    "platformAuthorizationCd": "AUTH-CODE-EXAMPLE",
    "platformLicenseCd": "LICENSE-CODE-EXAMPLE",
    "platformTitle": "Leaf 平台",
    "platformName": "Leaf Platform",
    "websiteTabLogo": "/files/favicon.ico",
    "loginPromptMessage": "欢迎登录"
  }
}
```

### 8.2 `GET /api/v2/platform/getPlatformLogo`

接口描述：获取平台logo。

请求参数：无业务入参。

响应数据：返回 `未知` 类型数据。

请求示例：

```json
{
  "headers": {
    "Authorization": "Bearer access-token-example"
  }
}
```

响应示例：

```json
{
  "contentType": "application/octet-stream",
  "fileName": "platform-logo.png",
  "body": "<binary>"
}
```

### 8.3 `GET /api/v2/platform/getWebsiteTabLogoUrl`

接口描述：获取网站页签logo。

请求参数：无业务入参。

响应数据：返回二进制文件流，`Content-Type` 为 `application/octet-stream`。

请求示例：

```json
{
  "headers": {
    "Authorization": "Bearer access-token-example"
  }
}
```

响应示例：

```json
{
  "contentType": "application/octet-stream",
  "fileName": "favicon.ico",
  "body": "<binary>"
}
```

## 9. `/api/v2/logRecord`

### 9.1 `POST /api/v2/logRecord/pageLogRecord`

接口描述：分页查询日志。

请求参数：请求体 `logQueryReqDTO`，类型 `LogQueryReqDTO`。

响应数据：`JSONResult<PageResult<LogRecordVO>>`。

请求示例：

```json
{
  "body": {
    "pageNum": 1,
    "pageSize": 20,
    "userId": 10001,
    "tenantId": 20001,
    "appNumList": [
      "leaf-admin"
    ],
    "startTime": "2026-04-01T00:00:00",
    "endTime": "2026-04-03T23:59:59"
  }
}
```

响应示例：

```json
{
  "code": "200",
  "message": "成功",
  "data": {
    "dataList": [
      {
        "logRecordId": 1,
        "applId": 50001,
        "operIp": "127.0.0.1",
        "userId": 10001,
        "operNum": "USER_QUERY",
        "tenantName": "研发中心",
        "tenantId": 20001,
        "interfaceElapsed": "25ms",
        "operBrowserVersion": "123.0",
        "os": "macOS",
        "operFunc": "用户查询",
        "operTm": "2026-04-03T10:00:00",
        "operBrowser": "Chrome",
        "operMethodPara": "{\"pageNum\":1}",
        "operMethodResult": "{\"code\":\"200\"}",
        "operEnName": "user_query",
        "userName": "alice",
        "operCnName": "查询用户列表",
        "operMenu": "用户管理",
        "userCnName": "Alice Chen",
        "applNum": "leaf-admin",
        "applName": "Leaf 管理台",
        "logTypeCd": "AUDIT"
      }
    ],
    "total": 1,
    "size": 20,
    "current": 1
  }
}
```

## 10. `/api/v2/emailConfig`

### 10.1 `POST /api/v2/emailConfig/exportEmailConfig`

接口描述：导出邮箱配置。

请求参数：请求体 `emailConfigExportQueryDTO`，类型 `EmailConfigExportQueryDTO`，含义为导出邮箱查询条件。

响应数据：返回 `ResponseEntity<Resource>` 类型数据。

请求示例：

```json
{
  "body": {
    "appCode": "leaf-admin",
    "emailConfigIdList": [
      1,
      2
    ]
  }
}
```

响应示例：

```json
{
  "contentType": "application/octet-stream",
  "fileName": "email-config.xlsx",
  "body": "<binary>"
}
```

### 10.2 `POST /api/v2/emailConfig/importEmailConfig`

接口描述：导入邮箱配置。

请求参数：表单字段 `multipartFile`，类型 `MultipartFile`，含义为文件信息。

响应数据：`JSONResult<String>`。

请求示例：

```json
{
  "multipart": {
    "multipartFile": "<file: email-config.xlsx>"
  }
}
```

响应示例：

```json
{
  "code": "200",
  "message": "成功",
  "data": "导入成功"
}
```

## 11. `/api/v2/msgTempl`

### 11.1 `POST /api/v2/msgTempl/exportMsgTempl`

接口描述：导出消息模板。

请求参数：请求体 `msgTemplExportQueryDTO`，类型 `MsgTemplExportQueryDTO`。

响应数据：返回 `ResponseEntity<Resource>` 类型数据。

请求示例：

```json
{
  "body": {
    "appCode": "leaf-admin",
    "msgTemplIdList": [
      1001,
      1002
    ]
  }
}
```

响应示例：

```json
{
  "contentType": "application/octet-stream",
  "fileName": "message-template.xlsx",
  "body": "<binary>"
}
```

### 11.2 `POST /api/v2/msgTempl/importMsgTempl`

接口描述：导入消息模板。

请求参数：表单字段 `multipartFile`，类型 `MultipartFile`，含义为文件信息。

响应数据：`JSONResult<String>`。

请求示例：

```json
{
  "multipart": {
    "multipartFile": "<file: message-template.xlsx>"
  }
}
```

响应示例：

```json
{
  "code": "200",
  "message": "成功",
  "data": "导入成功"
}
```

### 11.3 `GET /api/v2/msgTempl/getMsgTemplByTemplCode`

接口描述：根据模板编码查询消息模板信息。

请求参数：查询参数 `templCode`，类型 `String`，含义为模板编码。

响应数据：`JSONResult<MsgTemplInfoVO>`。

请求示例：

```json
{
  "query": {
    "templCode": "SYS_AUTH_CREATE_USER"
  }
}
```

响应示例：

```json
{
  "code": "200",
  "message": "成功",
  "data": {
    "templId": 1001,
    "tenantId": 20001,
    "templCode": "SYS_AUTH_CREATE_USER",
    "templName": "创建用户通知",
    "templSubject": "欢迎加入 ${tenant}",
    "templContent": "您好 ${name}，请访问 ${url} 设置密码。",
    "templDesc": "创建用户时发送的邮件模板",
    "appCode": "leaf-admin",
    "ifEnabled": "1"
  }
}
```

## 12. `/api/v2/message`

### 12.1 `POST /api/v2/message/messageSend`

接口描述：发送消息。

请求参数：请求体 `messageSendReqDTO`，类型 `MessageSendReqDTO`。

响应数据：`JSONResult<Void>`。

请求示例：

```json
{
  "body": {
    "messageId": 11001,
    "titleArgs": {
      "tenant": "研发中心"
    },
    "templateArgs": {
      "name": "Alice Chen",
      "url": "https://leaf.example.com/reset"
    }
  }
}
```

响应示例：

```json
{
  "code": "200",
  "message": "成功",
  "data": null
}
```

### 12.2 `POST /api/v2/message/messageSendDirect`

接口描述：直接发送消息，无需替换参数。

请求参数：请求体 `messageSendDirectReqDTO`，类型 `MessageSendDirectReqDTO`。

响应数据：`JSONResult<Void>`。

请求示例：

```json
{
  "body": {
    "title": "系统通知",
    "content": "今晚 22:00 将进行系统维护。",
    "recipientList": [
      "alice@example.com"
    ],
    "sendFlag": "EMAIL",
    "serverCode": "mail-default",
    "ccList": [
      "ops@example.com"
    ],
    "bccList": []
  }
}
```

响应示例：

```json
{
  "code": "200",
  "message": "成功",
  "data": null
}
```

### 12.3 `POST /api/v2/message/messageSendDirectWithAttachmentList`

接口描述：直接发送消息，无需替换参数（带附件）。

请求参数：表单字段 `attachmentList`，类型 `List<MultipartFile>`，含义为附件列表；查询参数 `content`，类型 `("直接发送消息实体JSON (MessageSendDirectReqDTO)") String`。

响应数据：`JSONResult<Void>`。

请求示例：

```json
{
  "multipart": {
    "attachmentList": [
      "<file: report.pdf>"
    ],
    "content": "{\"title\":\"系统通知\",\"content\":\"见附件\",\"recipientList\":[\"alice@example.com\"],\"sendFlag\":\"EMAIL\",\"serverCode\":\"mail-default\",\"ccList\":[],\"bccList\":[]}"
  }
}
```

响应示例：

```json
{
  "code": "200",
  "message": "成功",
  "data": null
}
```

### 12.4 `POST /api/v2/message/messageSendCustom`

接口描述：发送自定义消息。

请求参数：请求体 `messageSendCustomReqDTO`，类型 `MessageSendCustomReqDTO`，含义为发送自定义消息实体。

响应数据：`JSONResult<Void>`。

请求示例：

```json
{
  "body": {
    "templateCode": "SYS_AUTH_CREATE_USER",
    "titleArgs": {
      "tenant": "研发中心"
    },
    "templateArgs": {
      "name": "Alice Chen",
      "resetUrl": "https://leaf.example.com/reset"
    },
    "recipientList": [
      "alice@example.com"
    ],
    "sendFlag": "EMAIL",
    "serverCode": "mail-default",
    "ccList": [],
    "bccList": []
  }
}
```

响应示例：

```json
{
  "code": "200",
  "message": "成功",
  "data": null
}
```

### 12.5 `POST /api/v2/message/messageSendCustomWithAttachmentList`

接口描述：发送自定义消息（带附件）。

请求参数：表单字段 `attachmentList`，类型 `List<MultipartFile>`，含义为附件列表；查询参数 `content`，类型 `("发送自定义消息实体JSON (MessageSendCustomReqDTO)") String`。

响应数据：`JSONResult<Void>`。

请求示例：

```json
{
  "multipart": {
    "attachmentList": [
      "<file: onboarding.pdf>"
    ],
    "content": "{\"templateCode\":\"SYS_AUTH_CREATE_USER\",\"titleArgs\":{\"tenant\":\"研发中心\"},\"templateArgs\":{\"name\":\"Alice Chen\",\"resetUrl\":\"https://leaf.example.com/reset\"},\"recipientList\":[\"alice@example.com\"],\"sendFlag\":\"EMAIL\",\"serverCode\":\"mail-default\",\"ccList\":[],\"bccList\":[]}"
  }
}
```

响应示例：

```json
{
  "code": "200",
  "message": "成功",
  "data": null
}
```

## 13. `/external/api`

### 13.1 `POST /external/api/user/login`

接口描述：见接口实现。

请求参数：请求体 `loginUserDTO`，类型 `LoginUserDTO`。

响应数据：`BaseResponse<OauthUserVO>`。

请求示例：

```json
{
  "body": {
    "loginParam": "alice",
    "password": "secret",
    "appCode": "leaf-admin",
    "flag": false,
    "clientId": "client-id",
    "clientSecret": "client-secret",
    "loginEnum": "USERNAME",
    "tenantId": 20001,
    "imagesId": "img-123",
    "offsetX": "12",
    "offsetY": "0",
    "ipAddr": "127.0.0.1"
  }
}
```

响应示例：

```json
{
  "code": "200",
  "message": "成功",
  "data": {
    "id": 10001,
    "tenantId": 20001,
    "username": "alice",
    "phoneNumber": "13800138000",
    "email": "alice@example.com",
    "workNumber": "A001",
    "identityNumber": "330***********1234",
    "modifier": 10001,
    "delStatus": false,
    "userStatus": "ENABLE",
    "accessToken": "access-token-example",
    "refreshToken": "refresh-token-example",
    "resetUrl": "https://leaf.example.com/reset"
  }
}
```

### 13.2 `GET /external/api/user/logout`

接口描述：见接口实现。

请求参数：查询参数 `"appCode"`，类型 `(value =`；参数 `appCode`，类型 `required = false) String`；请求体 `userIds`，类型 `List<Long>`。

响应数据：`BaseResponse<Boolean>`。

请求示例：

```json
{
  "query": {
    "appCode": "leaf-admin"
  },
  "body": [
    10001,
    10002
  ]
}
```

响应示例：

```json
{
  "code": "200",
  "message": "成功",
  "data": true
}
```

### 13.3 `GET /external/api/user/get/login`

接口描述：见接口实现。

请求参数：无业务入参。

响应数据：`BaseResponse<OauthUserInfoVO>`。

请求示例：

```json
{
  "headers": {
    "Authorization": "Bearer access-token-example"
  }
}
```

响应示例：

```json
{
  "code": "200",
  "message": "成功",
  "data": {
    "id": 10001,
    "tenantId": 20001,
    "username": "alice",
    "name": "Alice Chen",
    "phoneNumber": "13800138000",
    "email": "alice@example.com",
    "roles": [
      {
        "id": 30001,
        "roleName": "租户管理员",
        "roleCode": "TENANT_ADMIN"
      }
    ],
    "organizations": [
      {
        "id": 40001,
        "organizationName": "平台研发部"
      }
    ],
    "permissionCodes": [
      "user:view",
      "user:edit"
    ]
  }
}
```

### 13.4 `POST /external/api/tenant/list`

接口描述：根据条件查询 租户信息。

请求参数：请求体 `keyWordsParamDTO`，类型 `KeyWordsParamDTO`。

响应数据：`BaseResponse<List<OauthTenantVO>>`。

请求示例：

```json
{
  "body": {
    "limit": 20,
    "offset": 0,
    "tenantId": 20001,
    "keyWords": "研发",
    "updateTime": "2026-04-03T10:00:00"
  }
}
```

响应示例：

```json
{
  "code": "200",
  "message": "成功",
  "data": [
    {
      "id": 20001,
      "tenantName": "研发中心",
      "tenantCode": "RD_CENTER",
      "tenantDesc": "研发租户",
      "orderNumber": 1,
      "tenantStatus": true,
      "tenantAbbreviation": "研发",
      "isFolder": false,
      "platformTitle": "Leaf 平台",
      "platformLogo": "/files/platform-logo.png",
      "tenantType": "ORG",
      "tenantAddress": "Shanghai",
      "parentId": 0,
      "navigationBarColor": "#1F3A5F",
      "themeColor": "#2C7BE5",
      "isOpenPermissionScope": true
    }
  ]
}
```

### 13.5 `POST /external/api/tenant/user/list`

接口描述：根据 tenantId、startTime、endTime 获取所有用户。

请求参数：请求体 `userInfosQueryDTO`，类型 `UserInfosQueryDTO`。

响应数据：`BaseResponse<List<OauthUserInfoVO>>`。

请求示例：

```json
{
  "body": {
    "tenantId": 20001,
    "startTime": "2026-04-01T00:00:00",
    "endTime": "2026-04-03T23:59:59"
  }
}
```

响应示例：

```json
{
  "code": "200",
  "message": "成功",
  "data": [
    {
      "id": 10001,
      "tenantId": 20001,
      "username": "alice",
      "name": "Alice Chen",
      "phoneNumber": "13800138000",
      "email": "alice@example.com",
      "workNumber": "A001",
      "userStatus": "ENABLE",
      "organizations": [
        {
          "id": 40001,
          "organizationName": "平台研发部"
        }
      ]
    }
  ]
}
```

## 14. `/api/user` V1 用户相关

### 14.1 `POST /api/user/info/page/all/tenant`

接口描述：全租户范围内分页查询用户基本信息（AuthUserInfo表数据）。

请求参数：请求体 `pageDTO`，类型 `OauthDataInAllTenantPageDTO`。

响应数据：`PaginationResult<OauthUserInfoVO>`，包含分页结果列表与分页信息。

请求示例：

```json
{
  "body": {
    "limit": 20,
    "offset": 0,
    "keyword": "alice",
    "tenantName": "研发中心",
    "tenantIds": [
      20001
    ],
    "delStatus": false
  }
}
```

响应示例：

```json
{
  "total": 1,
  "offset": 0,
  "limit": 20,
  "data": [
    {
      "id": 10001,
      "tenantId": 20001,
      "username": "alice",
      "name": "Alice Chen",
      "phoneNumber": "13800138000",
      "email": "alice@example.com"
    }
  ]
}
```

### 14.2 `POST /api/user/info/select/ids`

接口描述：根据用户Ids 查询用户常用信息。

请求参数：请求体 `userIds`，类型 `List<Long>`。

响应数据：返回 `List<OauthUserInfoVO>` 列表数据。

请求示例：

```json
{
  "body": [
    10001,
    10002
  ]
}
```

响应示例：

```json
[
  {
    "id": 10001,
    "username": "alice",
    "name": "Alice Chen"
  },
  {
    "id": 10002,
    "username": "bob",
    "name": "Bob Wang"
  }
]
```

### 14.3 `POST /api/user/info/select/user/ids`

接口描述：根据用户Ids 获取用户信息。

请求参数：请求体 `userIds`，类型 `List<Long>`。

响应数据：返回 `List<OauthUserInfoVO>` 列表数据。

请求示例：

```json
{
  "body": [
    10001,
    10002
  ]
}
```

响应示例：

```json
[
  {
    "id": 10001,
    "username": "alice",
    "name": "Alice Chen",
    "roles": [
      {
        "id": 30001,
        "roleName": "租户管理员"
      }
    ]
  }
]
```

### 14.4 `POST /api/user/ogrp/ids`

接口描述：根据用户Ids 查询用户常用信息。

请求参数：请求体 `userIds`，类型 `List<Long>`。

响应数据：返回 `List<OauthUserInfoVO>` 列表数据。

请求示例：

```json
{
  "body": [
    10001
  ]
}
```

响应示例：

```json
[
  {
    "id": 10001,
    "username": "alice",
    "organizations": [
      {
        "id": 40001,
        "organizationName": "平台研发部"
      }
    ],
    "groups": [
      {
        "id": 45001,
        "groupName": "核心成员"
      }
    ],
    "roles": [
      {
        "id": 30001,
        "roleName": "租户管理员"
      }
    ]
  }
]
```

### 14.5 `GET /api/user/info/tenant`

接口描述：获取租户下的所有用户。

请求参数：查询参数 `tenantId`，类型 `Long`。

响应数据：返回 `List<OauthUserInfoVO>` 列表数据。

请求示例：

```json
{
  "query": {
    "tenantId": 20001
  }
}
```

响应示例：

```json
[
  {
    "id": 10001,
    "tenantId": 20001,
    "username": "alice",
    "name": "Alice Chen"
  }
]
```

### 14.6 `POST /api/user/selectdata/haida`

接口描述：简化查询数据-海搭。

请求参数：请求体 `dto`，类型 `HaidaBaseDataReqDTO`。

响应数据：返回 `HaidaResultVO` 类型数据。

请求示例：

```json
{
  "body": {
    "tenantId": 20001,
    "type": "USER",
    "ids": [
      10001
    ],
    "keyWord": "alice",
    "limit": 20,
    "offset": 0
  }
}
```

响应示例：

```json
{
  "code": "200",
  "msg": "成功",
  "data": [
    {
      "id": 10001,
      "name": "Alice Chen",
      "desc": "研发用户",
      "tenantId": 20001,
      "parentId": 0,
      "ifFolder": "0"
    }
  ],
  "total": 1,
  "limit": 20,
  "offset": 0,
  "type": "USER"
}
```

### 14.7 `GET /api/user/info/get/token`

接口描述：根据token获取用户信息。

请求参数：查询参数 `token`，类型 `String`。

响应数据：返回 `OauthUserInfoVO` 类型数据。

请求示例：

```json
{
  "query": {
    "token": "access-token-example"
  }
}
```

响应示例：

```json
{
  "id": 10001,
  "tenantId": 20001,
  "username": "alice",
  "name": "Alice Chen"
}
```

### 14.8 `GET /api/user/info/redis`

接口描述：从redis中获取全部用户基本信息。

请求参数：无业务入参。

响应数据：返回 `List<OauthUserInfoVO>` 列表数据。

请求示例：

```json
{}
```

响应示例：

```json
[
  {
    "id": 10001,
    "tenantId": 20001,
    "username": "alice",
    "name": "Alice Chen"
  }
]
```

### 14.9 `POST /api/user/info/select/all`

接口描述：根据条件 获取所有用户信息。

请求参数：请求体 `oauthUserNamePageDTO`，类型 `OauthUserNamePageDTO`。

响应数据：`PaginationResult<OauthUserInfoVO>`，包含分页结果列表与分页信息。

请求示例：

```json
{
  "body": {
    "limit": 20,
    "offset": 0,
    "keyWords": "alice"
  }
}
```

响应示例：

```json
{
  "total": 1,
  "offset": 0,
  "limit": 20,
  "data": [
    {
      "id": 10001,
      "username": "alice",
      "name": "Alice Chen"
    }
  ]
}
```

### 14.10 `GET /api/user/get/token`

接口描述：获取当前登录用户的token。

请求参数：无业务入参。

响应数据：返回 `String` 字符串结果。

请求示例：

```json
{
  "headers": {
    "Authorization": "Bearer access-token-example"
  }
}
```

响应示例：

```json
"access-token-example"
```

### 14.11 `GET /api/user/select/id`

接口描述：根据用户标识获取用户信息。

请求参数：查询参数 `userId`，类型 `Long`。

响应数据：返回 `OauthUserVO` 类型数据。

请求示例：

```json
{
  "query": {
    "userId": 10001
  }
}
```

响应示例：

```json
{
  "id": 10001,
  "tenantId": 20001,
  "username": "alice",
  "phoneNumber": "13800138000",
  "email": "alice@example.com",
  "accessToken": "access-token-example",
  "refreshToken": "refresh-token-example"
}
```

### 14.12 `GET /api/user/info/get/login`

接口描述：获取当前登录用户信息。

请求参数：无业务入参。

响应数据：返回 `OauthUserInfoVO` 类型数据。

请求示例：

```json
{
  "headers": {
    "Authorization": "Bearer access-token-example"
  }
}
```

响应示例：

```json
{
  "id": 10001,
  "tenantId": 20001,
  "username": "alice",
  "name": "Alice Chen",
  "permissionCodes": [
    "user:view"
  ]
}
```

### 14.13 `GET /api/user/info/all/tenant`

接口描述：获取所有租户下的用户信息。

请求参数：无业务入参。

响应数据：返回 `List<OauthUserInfoVO>` 列表数据。

请求示例：

```json
{}
```

响应示例：

```json
[
  {
    "id": 10001,
    "tenantId": 20001,
    "username": "alice",
    "name": "Alice Chen"
  },
  {
    "id": 10002,
    "tenantId": 20002,
    "username": "bob",
    "name": "Bob Wang"
  }
]
```

## 15. `/api/tenant` V1 租户相关

### 15.1 `POST /api/tenant/select`

接口描述：根据条件查询 租户信息。

请求参数：请求体 `keyWordsParamDTO`，类型 `KeyWordsParamDTO`。

响应数据：返回 `List<OauthTenantVO>` 列表数据。

请求示例：

```json
{
  "body": {
    "limit": 20,
    "offset": 0,
    "tenantId": 20001,
    "keyWords": "研发"
  }
}
```

响应示例：

```json
[
  {
    "id": 20001,
    "tenantName": "研发中心",
    "tenantCode": "RD_CENTER"
  }
]
```

### 15.2 `POST /api/tenant/system/save/update`

接口描述：保存/修改租户--应用关联。

请求参数：请求体 `systemIds`，类型 `List<Long>`；查询参数 `tenantId`，类型 `Long`。

响应数据：返回 `Boolean` 布尔值结果。

请求示例：

```json
{
  "query": {
    "tenantId": 20001
  },
  "body": [
    50001,
    50002
  ]
}
```

响应示例：

```json
true
```

### 15.3 `POST /external/api/tenant/list`

接口描述：根据条件查询 租户信息。

请求参数：请求体 `keyWordsParamDTO`，类型 `KeyWordsParamDTO`。

响应数据：`BaseResponse<List<OauthTenantVO>>`。

请求示例：

```json
{
  "body": {
    "limit": 20,
    "offset": 0,
    "tenantId": 20001,
    "keyWords": "研发"
  }
}
```

响应示例：

```json
{
  "code": "200",
  "message": "成功",
  "data": [
    {
      "id": 20001,
      "tenantName": "研发中心",
      "tenantCode": "RD_CENTER"
    }
  ]
}
```

### 15.4 `POST /external/api/tenant/user/list`

接口描述：根据 tenantId、startTime、endTime 获取所有用户。

请求参数：请求体 `userInfosQueryDTO`，类型 `UserInfosQueryDTO`。

响应数据：`BaseResponse<List<OauthUserInfoVO>>`。

请求示例：

```json
{
  "body": {
    "tenantId": 20001,
    "startTime": "2026-04-01T00:00:00",
    "endTime": "2026-04-03T23:59:59"
  }
}
```

响应示例：

```json
{
  "code": "200",
  "message": "成功",
  "data": [
    {
      "id": 10001,
      "tenantId": 20001,
      "username": "alice",
      "name": "Alice Chen"
    }
  ]
}
```

## 16. `/api/organization` V1 组织相关

### 16.1 `POST /api/organization/full/path`

接口描述：查询机构的全路径。

请求参数：请求体 `organizationIds`，类型 `List<Long>`。

响应数据：返回 `List<String>` 列表数据。

请求示例：

```json
{
  "body": [
    40001,
    40002
  ]
}
```

响应示例：

```json
[
  "/研发中心/平台研发部",
  "/研发中心/质量保障部"
]
```

### 16.2 `POST /api/organization/list/select/user/id`

接口描述：根据用户ID 查询用户所属机构信息。

请求参数：查询参数 `userId`，类型 `Long`；查询参数 `"tenantId"`，类型 `(value =`；参数 `tenantId`，类型 `required = false) Long`。

响应数据：返回 `List<OauthOrganizationVO>` 列表数据。

请求示例：

```json
{
  "query": {
    "userId": 10001,
    "tenantId": 20001
  }
}
```

响应示例：

```json
[
  {
    "id": 40001,
    "tenantId": 20001,
    "organizationName": "平台研发部",
    "organizationCode": "DEV001"
  }
]
```

### 16.3 `POST /api/organization/page/all/tenant`

接口描述：分页获取全租户下的机构列表。

请求参数：请求体 `pageDTO`，类型 `OauthDataInAllTenantPageDTO`。

响应数据：`PaginationResult<OauthOrganizationVO>`，包含分页结果列表与分页信息。

请求示例：

```json
{
  "body": {
    "limit": 20,
    "offset": 0,
    "keyword": "研发",
    "tenantIds": [
      20001
    ],
    "delStatus": false
  }
}
```

响应示例：

```json
{
  "total": 1,
  "offset": 0,
  "limit": 20,
  "data": [
    {
      "id": 40001,
      "organizationName": "平台研发部",
      "tenantId": 20001
    }
  ]
}
```

### 16.4 `GET /api/organization/all/tenant`

接口描述：获取所有租户下所有机构。

请求参数：无业务入参。

响应数据：返回 `List<OauthOrganizationVO>` 列表数据。

请求示例：

```json
{}
```

响应示例：

```json
[
  {
    "id": 40001,
    "organizationName": "平台研发部",
    "tenantId": 20001
  }
]
```

## 17. `/api/group` V1 分组相关

### 17.1 `POST /api/group/page/all/tenant`

接口描述：分页查询全租户下的分组。

请求参数：请求体 `pageDTO`，类型 `OauthDataInAllTenantPageDTO`。

响应数据：`PaginationResult<OauthGroupVO>`，包含分页结果列表与分页信息。

请求示例：

```json
{
  "body": {
    "limit": 20,
    "offset": 0,
    "keyword": "核心",
    "tenantIds": [
      20001
    ],
    "delStatus": false
  }
}
```

响应示例：

```json
{
  "total": 1,
  "offset": 0,
  "limit": 20,
  "data": [
    {
      "id": 45001,
      "tenantId": 20001,
      "groupName": "核心成员",
      "groupDesc": "核心项目组"
    }
  ]
}
```

### 17.2 `GET /api/group/all/tenant`

接口描述：获取所有租户下所有分组。

请求参数：无业务入参。

响应数据：返回 `List<OauthGroupVO>` 列表数据。

请求示例：

```json
{}
```

响应示例：

```json
[
  {
    "id": 45001,
    "tenantId": 20001,
    "groupName": "核心成员"
  }
]
```

## 18. `/api/system` V1 应用相关

### 18.1 `GET /api/system/select/platform/system`

接口描述：查询全部平台应用信息。

请求参数：无业务入参。

响应数据：返回 `List<OauthSystemVO>` 列表数据。

请求示例：

```json
{}
```

响应示例：

```json
[
  {
    "id": 50001,
    "systemCode": "leaf-admin",
    "systemName": "Leaf 管理台",
    "systemUrl": "https://leaf.example.com",
    "systemEnable": true
  }
]
```

### 18.2 `POST /api/system/delete/ids`

接口描述：删除应用。

请求参数：请求体 `systemIds`，类型 `List<Long>`。

响应数据：返回 `Boolean` 布尔值结果。

请求示例：

```json
{
  "body": [
    50003,
    50004
  ]
}
```

响应示例：

```json
true
```

### 18.3 `GET /api/system/select/code`

接口描述：根据系统编码获取系统信息。

请求参数：查询参数 `systemCode`，类型 `String`。

响应数据：返回 `OauthSystemVO` 类型数据。

请求示例：

```json
{
  "query": {
    "systemCode": "leaf-admin"
  }
}
```

响应示例：

```json
{
  "id": 50001,
  "systemCode": "leaf-admin",
  "systemName": "Leaf 管理台",
  "systemUrl": "https://leaf.example.com",
  "systemEnable": true
}
```

### 18.4 `POST /api/system/save`

接口描述：新增应用。

请求参数：请求体 `oauthSaveSystemDTO`，类型 `OauthSaveSystemDTO`。

响应数据：返回 `Long` 类型数据。

请求示例：

```json
{
  "body": {
    "id": 50001,
    "appDataType": "BUSINESS",
    "systemUrl": "https://leaf.example.com",
    "jumpMode": "OPEN_INNER",
    "parentId": 0,
    "level": 1,
    "orderNumber": 1,
    "systemDesc": "Leaf 管理台",
    "systemCode": "leaf-admin",
    "knowledgeId": 0,
    "systemEnable": true,
    "systemLogo": "/files/logo.png",
    "systemName": "Leaf 管理台",
    "topBar": true,
    "creator": 10001,
    "isFolder": "0"
  }
}
```

响应示例：

```json
50001
```

### 18.5 `GET /api/system/tenant/id`

接口描述：查询全部平台应用信息(根据租户Id判断该租户是否开启应用权限)。

请求参数：查询参数 `tenantId`，类型 `Long`。

响应数据：返回 `List<OauthTenantSystemVO>` 列表数据。

请求示例：

```json
{
  "query": {
    "tenantId": 20001
  }
}
```

响应示例：

```json
[
  {
    "system": {
      "id": 50001,
      "systemCode": "leaf-admin",
      "systemName": "Leaf 管理台"
    },
    "enable": true
  }
]
```

## 19. `/api/system/role` 与 `/api/role` V1 角色相关

### 19.1 `GET /api/system/role/select/all`

接口描述：获取所有应用角色。

请求参数：无业务入参。

响应数据：返回 `List<OauthSystemRoleVO>` 列表数据。

请求示例：

```json
{}
```

响应示例：

```json
[
  {
    "id": 30001,
    "roleName": "租户管理员",
    "roleCode": "TENANT_ADMIN",
    "systemId": 50001,
    "systemName": "Leaf 管理台",
    "systemCode": "leaf-admin"
  }
]
```

### 19.2 `POST /api/system/role/delete/ids`

接口描述：删除应用角色。

请求参数：请求体 `roleIds`，类型 `List<Long>`；查询参数 `"userId"`，类型 `(value =`；参数 `userId`，类型 `required = false) Long`。

响应数据：返回 `Boolean` 布尔值结果。

请求示例：

```json
{
  "query": {
    "userId": 10001
  },
  "body": [
    30005,
    30006
  ]
}
```

响应示例：

```json
true
```

### 19.3 `POST /api/system/role/save/update`

接口描述：新增/修改应用角色。

请求参数：请求体 `oauthSaveRoleDTO`，类型 `OauthSaveRoleDTO`；查询参数 `systemId`，类型 `Long`。

响应数据：返回 `Long` 类型数据。

请求示例：

```json
{
  "query": {
    "systemId": 50001
  },
  "body": {
    "systemCode": "leaf-admin",
    "id": 30001,
    "roleName": "租户管理员",
    "roleCode": "TENANT_ADMIN",
    "status": true,
    "parentId": 0,
    "roleDescription": "租户级管理员角色",
    "orderNumber": 1,
    "tenantId": 20001,
    "creator": 10001
  }
}
```

响应示例：

```json
30001
```

### 19.4 `POST /api/role/page/all/tenant`

接口描述：全租户范围分页查询角色列表。

请求参数：请求体 `oauthDataInAllTenantPageDTO`，类型 `OauthDataInAllTenantPageDTO`。

响应数据：`PaginationResult<OauthRoleVO>`，包含分页结果列表与分页信息。

请求示例：

```json
{
  "body": {
    "limit": 20,
    "offset": 0,
    "keyword": "管理员",
    "tenantIds": [
      20001
    ],
    "delStatus": false
  }
}
```

响应示例：

```json
{
  "total": 1,
  "offset": 0,
  "limit": 20,
  "data": [
    {
      "id": 30001,
      "roleName": "租户管理员",
      "roleCode": "TENANT_ADMIN",
      "tenantId": 20001
    }
  ]
}
```

### 19.5 `GET /api/role/select/child/code`

接口描述：根据角色编码获取本身及子集角色。

请求参数：查询参数 `roleCode`，类型 `String`。

响应数据：返回 `List<OauthRoleVO>` 列表数据。

请求示例：

```json
{
  "query": {
    "roleCode": "TENANT_ADMIN"
  }
}
```

响应示例：

```json
[
  {
    "id": 30001,
    "roleCode": "TENANT_ADMIN",
    "roleName": "租户管理员"
  },
  {
    "id": 30002,
    "roleCode": "USER",
    "roleName": "普通用户"
  }
]
```

### 19.6 `GET /api/platform/role/select/child/code`

接口描述：根据平台角色编码获取本身及子集角色。

请求参数：查询参数 `roleCode`，类型 `String`。

响应数据：返回 `List<OauthRoleVO>` 列表数据。

请求示例：

```json
{
  "query": {
    "roleCode": "PLATFORM_ADMIN"
  }
}
```

响应示例：

```json
[
  {
    "id": 31001,
    "roleCode": "PLATFORM_ADMIN",
    "roleName": "平台管理员"
  }
]
```

### 19.7 `GET /api/role/select/all/tenant`

接口描述：获取所有租户下的所有角色。

请求参数：无业务入参。

响应数据：返回 `List<OauthRoleVO>` 列表数据。

请求示例：

```json
{}
```

响应示例：

```json
[
  {
    "id": 30001,
    "roleName": "租户管理员",
    "tenantId": 20001
  }
]
```

### 19.8 `POST /api/role/save`

接口描述：保存角色。

请求参数：请求体 `oauthSaveRoleDTO`，类型 `OauthSaveRoleDTO`。

响应数据：返回 `Long` 类型数据。

请求示例：

```json
{
  "body": {
    "systemCode": "leaf-admin",
    "id": 30002,
    "roleName": "普通用户",
    "roleCode": "USER",
    "status": true,
    "parentId": 30001,
    "roleDescription": "普通业务用户",
    "orderNumber": 2,
    "tenantId": 20001,
    "creator": 10001
  }
}
```

响应示例：

```json
30002
```

### 19.9 `POST /api/system/role/page`

接口描述：分页获取应用角色列表。

请求参数：请求体 `oauthSystemRolePageDTO`，类型 `OauthSystemRolePageDTO`。

响应数据：`PaginationResult<OauthSystemRoleVO>`，包含分页结果列表与分页信息。

请求示例：

```json
{
  "body": {
    "limit": 20,
    "offset": 0,
    "keyword": "管理员",
    "systemIds": [
      50001
    ]
  }
}
```

响应示例：

```json
{
  "total": 1,
  "offset": 0,
  "limit": 20,
  "data": [
    {
      "id": 30001,
      "roleName": "租户管理员",
      "systemId": 50001,
      "systemName": "Leaf 管理台",
      "systemCode": "leaf-admin"
    }
  ]
}
```

## 20. `/api/permission` V1 权限相关

### 20.1 `POST /api/permission/delete/system`

接口描述：删除应用所有权限码。

请求参数：查询参数 `systemId`，类型 `Long`。

响应数据：返回 `Boolean` 布尔值结果。

请求示例：

```json
{
  "query": {
    "systemId": 50001
  }
}
```

响应示例：

```json
true
```

### 20.2 `POST /api/permission/save/tenant/user`

接口描述：保存权限码。

请求参数：请求体 `oauthSavePermissions`，类型 `List<OauthSavePermissionDTO>`；查询参数 `tenantId`，类型 `Long`；查询参数 `userId`，类型 `Long`。

响应数据：返回 `List<OauthPermissionVO>` 列表数据。

请求示例：

```json
{
  "query": {
    "tenantId": 20001,
    "userId": 10001
  },
  "body": [
    {
      "systemId": 50001,
      "id": 60001,
      "permissionName": "查看用户",
      "permissionCode": "user:view",
      "permissionParentCode": "user",
      "parentId": 0,
      "permissionDescription": "允许查看用户列表"
    }
  ]
}
```

响应示例：

```json
[
  {
    "id": 60001,
    "permissionName": "查看用户",
    "permissionCode": "user:view",
    "orderNumber": 1,
    "parentId": 0,
    "permissionDescription": "允许查看用户列表",
    "delStatus": false,
    "enable": true
  }
]
```

### 20.3 `POST /api/permission/delete/ids`

接口描述：删除权限码。

请求参数：请求体 `permissionIds`，类型 `List<Long>`；查询参数 `systemId`，类型 `Long`。

响应数据：返回 `Boolean` 布尔值结果。

请求示例：

```json
{
  "query": {
    "systemId": 50001
  },
  "body": [
    60001,
    60002
  ]
}
```

响应示例：

```json
true
```

### 20.4 `GET /api/permission/select/id`

接口描述：根据角色标识和应用标识查询权限码。

请求参数：查询参数 `roleId`，类型 `Long`；查询参数 `systemCode`，类型 `String`。

响应数据：返回 `List<OauthPermissionVO>` 列表数据。

请求示例：

```json
{
  "query": {
    "roleId": 30001,
    "systemCode": "leaf-admin"
  }
}
```

响应示例：

```json
[
  {
    "id": 60001,
    "permissionName": "查看用户",
    "permissionCode": "user:view"
  }
]
```

### 20.5 `GET /external/api/user/permission/select/id`

接口描述：见接口实现。

请求参数：查询参数 `roleId`，类型 `Long`；查询参数 `systemCode`，类型 `String`。

响应数据：返回 `List<OauthPermissionVO>` 列表数据。

请求示例：

```json
{
  "query": {
    "roleId": 30001,
    "systemCode": "leaf-admin"
  }
}
```

响应示例：

```json
[
  {
    "id": 60001,
    "permissionName": "查看用户",
    "permissionCode": "user:view"
  }
]
```

## 21. 用户角色、组织、分组管理员接口

### 21.1 `GET /api/user/role/select/role/id`

接口描述：根据用户Id查询对应角色Ids。

请求参数：查询参数 `userId`，类型 `Long`；查询参数 `tenantId`，类型 `Long`。

响应数据：返回 `Set<Long>` 类型数据。

请求示例：

```json
{
  "query": {
    "userId": 10001,
    "tenantId": 20001
  }
}
```

响应示例：

```json
[
  30001,
  30002
]
```

### 21.2 `POST /api/user/roles/remove`

接口描述：移除角色对应用户。

请求参数：查询参数 `userId`，类型 `Long`；请求体 `roleIds`，类型 `List<Long>`。

响应数据：返回 `Boolean` 布尔值结果。

请求示例：

```json
{
  "query": {
    "userId": 10001
  },
  "body": [
    30002,
    30003
  ]
}
```

响应示例：

```json
true
```

### 21.3 `POST /api/save/sadp/user/role/ids`

接口描述：保存 一个用户-->多个角色 sadp。

请求参数：查询参数 `userId`，类型 `Long`；请求体 `roleIds`，类型 `List<Long>`。

响应数据：返回 `Boolean` 布尔值结果。

请求示例：

```json
{
  "query": {
    "userId": 10001
  },
  "body": [
    30001,
    30002
  ]
}
```

响应示例：

```json
true
```

### 21.4 `GET /api/select/manager/user/organization/id`

接口描述：根据机构Id 获取机构管理员。

请求参数：查询参数 `organizationId`，类型 `Long`。

响应数据：返回 `OauthUserInfoVO` 类型数据。

请求示例：

```json
{
  "query": {
    "organizationId": 40001
  }
}
```

响应示例：

```json
{
  "id": 10010,
  "username": "org_manager",
  "name": "组织管理员"
}
```

### 21.5 `GET /api/select/manager/user/group/id`

接口描述：根据分组Id 获取分组管理员。

请求参数：查询参数 `groupId`，类型 `Long`。

响应数据：返回 `OauthUserInfoVO` 类型数据。

请求示例：

```json
{
  "query": {
    "groupId": 45001
  }
}
```

响应示例：

```json
{
  "id": 10011,
  "username": "group_manager",
  "name": "分组管理员"
}
```

## 22. 角色权限关联接口

### 22.1 `POST /api/role/permission/delete`

接口描述：删除角色权限码关系。

请求参数：请求体 `roleIds`，类型 `List<Long>`。

响应数据：返回 `Boolean` 布尔值结果。

请求示例：

```json
{
  "body": [
    30001,
    30002
  ]
}
```

响应示例：

```json
true
```

### 22.2 `POST /api/system/role/permission/save/update`

接口描述：保存/修改角色权限关联。

请求参数：请求体 `oauthSaveRolePermissionDTO`，类型 `OauthSaveRolePermissionDTO`。

响应数据：返回 `Boolean` 布尔值结果。

请求示例：

```json
{
  "body": {
    "roleId": 30001,
    "permissionIds": [
      60001,
      60002
    ],
    "systemId": 50001
  }
}
```

响应示例：

```json
true
```

## 23. LDAP 接口

### 23.1 `GET /api/ldap/data/sync`

接口描述：同步Ldap数据。

请求参数：查询参数 `customParameters`，类型 `Long`，含义为策略/配置ID。

响应数据：返回 `Boolean` 布尔值结果。

请求示例：

```json
{
  "query": {
    "customParameters": 1
  }
}
```

响应示例：

```json
true
```

### 23.2 `GET /api/ldap/system/sync`

接口描述：第三方数据同步到ldap。

请求参数：参数 `ldapSystemId`，类型 `Long`，含义为策略ID。

响应数据：返回 `Boolean` 布尔值结果。

请求示例：

```json
{
  "query": {
    "ldapSystemId": 1
  }
}
```

响应示例：

```json
true
```

## 24. UCard 支撑接口

### 24.1 `GET /api/v2/user/listUserOrganizationByUserIds`

接口描述：根据用户 ID 返回用户部门信息。

请求参数：查询参数 `userIds` 为用户 ID 数组，`tenantId` 为租户 ID。

响应数据：`JSONResult<List<AuthUserOrganizationInfoVO>>`，每个用户对象主要包含 `userId`、`tenantId`、`userLoginName`、`cnName`、`organizations`，其中 `organizations` 为用户部门列表。

请求示例：

```json
{
  "query": {
    "userIds": [
      10001,
      10002
    ],
    "tenantId": 20001
  }
}
```

响应示例：

```json
{
  "code": "200",
  "message": "成功",
  "data": [
    {
      "userId": 10001,
      "tenantId": 20001,
      "userLoginName": "alice",
      "cnName": "Alice Chen",
      "organizations": [
        {
          "orgId": 40001,
          "orgName": "平台研发部"
        }
      ]
    }
  ]
}
```

### 24.2 `GET /api/v2/user/listUserByTenantId`

接口描述：根据租户 ID 返回用户信息。

请求参数：查询参数 `tenantId`，含义为租户 ID。

响应数据：`JSONResult<List<AuthUserInfoVO>>`，每个用户对象主要包含 `userId`、`tenantId`、`tenantName`、`userLoginName`、`accountOrigin`、`cnName`、`phoneNumber`、`emailAddress`、`userGender`、`userStatus`、`launchStatusCd`、`authRoleCode`、`authRoleId`、`ifDelete`、`createTm`、`updateTm` 等字段，实际返回字段以服务端实现为准。

请求示例：

```json
{
  "query": {
    "tenantId": 20001
  }
}
```

响应示例：

```json
{
  "code": "200",
  "message": "成功",
  "data": [
    {
      "userId": 10001,
      "tenantId": 20001,
      "userLoginName": "alice",
      "cnName": "Alice Chen"
    }
  ]
}
```
