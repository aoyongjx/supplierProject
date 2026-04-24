# Base服务接口说明

本文档为 Node 服务调用 Java base server 的示例版，每个接口都给出完整请求示例和完整响应示例。

## 接口概览与字段约定

以下内容为当前统一维护的 BASE 接口说明，便于集中查阅接口概览、字段约定与示例。

### 文档范围

当前仓库提供 BASE 服务相关接口定义，使用文档重点说明：

- 路由与 HTTP 方法
- 参数位置
- 返回包装结构
- 常见对象字段约定

在本文档中涉及的应用标识约定如下：

- `appCode` 为应用编号，每个应用只会有一个 `appCode`
- `moduleCode` 为应用中每个模块的编号，一个应用可能会有多个 `moduleCode`

这两个值都需要开发人员在创建项目时事先指定好，并保存到项目中。

### 返回结构

#### `JSONResult<T>`

BASE 大部分非分页接口返回 `JSONResult<T>`。

使用时建议按以下约定理解：

- 顶层字段通常包含：`success`、`msg`、`data`
- 业务数据优先从 `data` 字段读取

#### `PageResult<T>`

分页接口通常返回 `PageResult<T>`。

常用字段：

- `pageNum`
- `pageSize`
- `total`
- `dataList`

分页列表数据统一放在 `dataList` 字段中，不使用 `data` 字段承载列表内容。

#### 二进制响应

下载类接口返回二进制流，不返回 JSON。

### 字段约定

#### 通用约定

- 长整型 ID：前端和 Node 侧建议按 `string` 处理
- 时间字段：通常使用字符串返回，常见字段名为 `createTm`、`modifyTm`、`taskStartTm`、`taskEndTm`
- 布尔结果：通常位于 `JSONResult<Boolean>.data`

#### 常见对象

`DataSourceApiVo` / `DataSourceVo`

常见字段：

- `dataSourceId`
- `dataSourceName`
- `appCode`
- `moduleCode`
- `dbType`
- `dbConnType`
- `host` / `dataSourceHost`
- `port` / `dataSourcePort`
- `userName` / `dataSourceUsername`
- `dbName` / `defaultDb`
- `templateName`
- `connectTestStatus`

`OSFileApiVo` / `FileApiVo`

常见字段：

- `fileId`
- `fileName`
- `filePath`
- `fileSize`

`WfInstanceApiVO`

常见字段：

- `wfInstanceId`
- `approvalObjectId`
- `approvalObjectTitle`
- `approvalObjectType`
- `approveStatus`
- `currNode`
- `currNodeName`
- `taskStartTm`
- `taskEndTm`

`WfInstanceNodeApiVO`

常见字段：

- `wfInstanceNodeId`
- `wfInstanceId`
- `nodeName`
- `approveType`
- `approveStatus`
- `commitPersonCnName`
- `nodeStartTm`
- `nodeEndTm`

`JobGroupApiVO` / `JobInfoApiVO`

常见字段：

- `grpId` / `jobId`
- `grpName` / `jobName`
- `status`
- `createTm`
- `modifyTm`

### 参数位置约定

- `GET` 接口的简单参数：通常走 query
- `POST` 接口的复杂对象：通常走 JSON body
- 文件上传接口：使用 `multipart/form-data`
- 数组参数：
  - `GET` 场景一般按 query/form 传递
  - `POST` 场景一般放在 JSON body 中

### 接口概览

#### APISIX 网关

| 方法 | 路径 | 返回类型 | 参数说明 |
|---|---|---|---|
| GET | `/apisix/gw/host` | `JSONResult<String>` | 无参 |
| GET | `/apisix/gw/existsRouteByName` | `JSONResult<Boolean>` | query: `routeId`、`routeName` |

#### 数据源

| 方法 | 路径 | 返回类型 | 参数说明 |
|---|---|---|---|
| GET | `/ds/selectDataSourceInfo` | `JSONResult<DataSourceApiVo>` | query: `dataSourceId` |
| POST | `/ds/selectDataSourceList` | `JSONResult<List<DataSourceApiVo>>` | body: `DataSourceInput` |
| GET | `/ds/selectDataSourceTemplateList` | `JSONResult<List<DataSourceTemplateApiVo>>` | 无参 |
| GET | `/ds/selectDataSourceTemplate` | `JSONResult<DataSourceTemplateApiVo>` | query: `dataSourceTemplateId` |
| POST | `/rest/dataSourceTemplate/page` | `PageResult<DataSourceTemplateVo>` | body: `PageDataSourceTemplateInput` |
| POST | `/rest/datasource/page` | `PageResult<DataSourceVo>` | body: `PageDataSourceInput` |
| POST | `/rest/datasource/add` | `JSONResult<Boolean>` | body: `AddDataSourceInput` |
| POST | `/rest/datasource/batch/delete` | `JSONResult<Boolean>` | body: `IdListInput` |
| POST | `/rest/datasource/create` | `JSONResult<Long>` | body: `AddDataSourceInput` |
| POST | `/rest/datasource/delete` | `JSONResult<Boolean>` | body: `IdInput` |
| POST | `/rest/datasource/edit` | `JSONResult<Boolean>` | body: `EditDataSourceInput` |
| POST | `/rest/datasource/edit/select` | `JSONResult<Boolean>` | body: `EditDataSourceInput` |
| GET | `/rest/datasource/info` | `JSONResult<DataSourceVo>` | query: `dataSourceId` |
| GET | `/rest/datasource/connect/testByDataSourceId` | `JSONResult<Boolean>` | query: `dataSourceId` |
| POST | `/rest/datasource/connect/test` | `JSONResult<Boolean>` | body: `TestConnectDataSourceInput` |
| GET | `/rest/dbType/list` | `JSONResult<List<EnumItemVo>>` | 无参 |
| GET | `/rest/dbType/version/list` | `JSONResult<List<SingleValueVo<String>>>` | query: `dbType` |
| POST | `/rest/datasourceTemplate/add` | `JSONResult<Boolean>` | body: `AddDataSourceTemplateInput` |
| POST | `/rest/datasourceTemplate/edit` | `JSONResult<Boolean>` | body: `EditDataSourceTemplateInput` |
| GET | `/rest/dataSourceTemplate/info` | `JSONResult<DataSourceTemplateVo>` | query: `dataSourceTemplateId` |
| POST | `/rest/datasourceTemplate/delete` | `JSONResult<Boolean>` | body: `IdInput` |
| POST | `/rest/datasourceTemplate/batch/delete` | `JSONResult<Boolean>` | body: `IdListInput` |

#### 文件

| 方法 | 路径 | 返回类型 | 参数说明 |
|---|---|---|---|
| GET | `/file/download` | `Response` | query: `fileId` |
| POST | `/file/upload` | `JSONResult<OSFileApiVo>` | part: `file`; query/form: `ifTmp`、`appCode` |
| POST | `/file/public/upload` | `JSONResult<OSFileApiVo>` | part: `file`; query/form: `ifTmp`、`appCode` |
| POST | `/file/reUpload` | `JSONResult<Boolean>` | part: `file`; query/form: `fileId` |
| POST | `/file/biteArray/upload` | `JSONResult<OSFileApiVo>` | body: `file`; query/form: `ifTmp`、`appCode`、`fileName` |
| GET | `/file/template/export` | `Response` | 无参 |
| POST | `/file/template/import` | `JSONResult<Boolean>` | part/form: `file` |
| POST | `/file/template/import/init` | `JSONResult<Boolean>` | part/form: `file` |
| GET | `/file/template/export/init` | `Response` | 无参 |
| GET | `/file/thumbnail/download` | `Response` | query: `fileId` |
| GET | `/file/downloadHistory` | `Response` | query: `fileVersionId` |
| GET | `/file/download/list` | `Response` | query: `fileIdList` |
| GET | `/file/fileName/download` | `Response` | query: `fileName` |
| GET | `/file/fileName/public/download` | `Response` | query: `fileName` |
| POST | `/file/upload/thumbnail` | `JSONResult<Boolean>` | part/form: `file`; query/form: `fileId` |
| GET | `/file/delete` | `JSONResult<Boolean>` | query: `fileId` |
| GET | `/file/clear` | `JSONResult<Boolean>` | query: `startDateTime`、`endDateTime` |
| GET | `/file/info` | `JSONResult<FileApiVo>` | query: `fileId` |
| GET | `/file/copy` | `JSONResult<Long>` | query: `fileId` |
| POST | `/file/batch/upload` | `JSONResult<List<OSFileApiVo>>` | part/form: `files`; query/form: `appCode` |
| GET | `/file/custom/thumbnail/download` | `Response` | query: `fileId`、`width` |
| POST | `/file/export` | `Response` | body: `FileExportInput` |
| POST | `/file/part/lighting` | `JSONResult<Long>` | body: `FileUploadInitCheckInput` |
| POST | `/file/part/init` | `JSONResult<FileUploadInitCheckVo>` | body: `FileUploadInitCheckInput` |
| POST | `/file/part/upload` | `JSONResult<Boolean>` | part: `file`; query/form: `fileId`、`partNumber` |
| GET | `/file/part/thumbnail/download` | `Response` | query: `fileId`、`width`、`height` |
| POST | `/file/part/upload/record` | `JSONResult<Boolean>` | body: `FilePartUploadRecordFinishedInput` |
| GET | `/file/ocr/{fileMd5}/download` | `Response` | path: `fileMd5`; query: `fileName` |
| POST | `/ambry/to/minio` | `Response` | part/form: `file` |

#### 调度任务组

| 方法 | 路径 | 返回类型 | 参数说明 |
|---|---|---|---|
| GET | `/job/group/pageJobGroup` | `PageResult<JobGroupApiVO>` | body/query: `PageJobGroupInput` |
| POST | `/job/group/add` | `JSONResult<Boolean>` | body: `JobGroupInput` |
| POST | `/job/group/edit` | `JSONResult<Boolean>` | body: `JobGroupInput` |
| POST | `/job/group/delete` | `JSONResult<Boolean>` | query: `grpId` |
| GET | `/job/group/getGroupById/{grpId}` | `JSONResult<JobGroupApiVO>` | path: `grpId` |
| POST | `/job/group/start` | `JSONResult<Boolean>` | query: `grpId` |
| POST | `/job/group/stop` | `JSONResult<Boolean>` | query: `grpId` |
| POST | `/job/group/addSimpleJobGroup` | `JSONResult<Long>` | body: `JobSimpleGroupApiInput` |
| POST | `/job/group/stopAndDelete` | `JSONResult<Boolean>` | query: `grpId` |
| POST | `/job/group/stopAndDeleteGroupJobList` | `JSONResult<Boolean>` | query: `grpId` |
| GET | `/job/group/getGroupJobList` | `JSONResult<List<JobInfoVO>>` | query: `grpId` |
| GET | `/job/group/exportJobGroup` | `Response` | query: `appCode`、`moduleCode`、`tenantId` |
| POST | `/job/group/importJobGroup` | `JSONResult<Boolean>` | query/form: `appCode`、`moduleCode`; part: `file` |
| POST | `/job/group/copyJobGroup` | `JSONResult<Map<Long, Long>>` | query/form: `appCode`、`moduleCode`、`newModuleCode`、`tenantId`、`tarTenantId`、`relationShips` |
| POST | `/job/group/startSchJobGroup` | `JSONResult<Boolean>` | query: `jobGroupId` |
| POST | `/job/group/freeze` | `JSONResult<Boolean>` | body: `JobInfoFreezeApiInput` |
| POST | `/job/group/unfreeze` | `JSONResult<Boolean>` | body: `JobInfoFreezeApiInput` |
| POST | `/job/group/skip` | `JSONResult<Boolean>` | query: `jobGroupId`、`jobId` |
| POST | `/job/group/deleteJobGroupByAppCodeAndModuleCode` | `JSONResult<String>` | query: `appCode`、`moduleCode` |
| POST | `/job/group/batchStartJobGroupByAppCodeAndModuleCode` | `JSONResult<String>` | query: `appCode`、`moduleCode` |
| POST | `/job/group/batchStopJobGroupByAppCodeAndModuleCode` | `JSONResult<String>` | query: `appCode`、`moduleCode` |
| POST | `/job/group/getJobGroupListByGroupBusinessType` | `JSONResult<List<JobGroupApiVO>>` | body: `JobGroupBizTypeQueryInput` |
| POST | `/job/group/getJobGroupRelaListByGroupBusinessType` | `JSONResult<List<JobGroupRelaApiVO>>` | body: `JobGroupBizTypeQueryInput` |

#### 调度任务

| 方法 | 路径 | 返回类型 | 参数说明 |
|---|---|---|---|
| GET | `/job/info/pageJobInfo` | `PageResult<JobInfoApiVO>` | body/query: `PageJobInfoInput` |
| POST | `/job/info/add` | `JSONResult<Boolean>` | body: `JobInfoInput` |
| POST | `/job/info/edit` | `JSONResult<Boolean>` | body: `JobInfoInput` |
| POST | `/job/info/delete` | `JSONResult<Boolean>` | query: `jobId` |
| GET | `/job/info/getJobInfoById/{jobId}` | `JSONResult<JobInfoApiVO>` | path: `jobId` |
| POST | `/job/info/start` | `JSONResult<Boolean>` | query: `jobId` |
| POST | `/job/info/stop` | `JSONResult<Boolean>` | query: `jobId` |
| POST | `/job/info/exec` | `JSONResult<Boolean>` | query: `jobId` |
| POST | `/job/info/export` | `Response` | body: `ExportJobInfoInput` |

## 1. BASE 服务说明

BASE 服务提供文件管理、工作流等基础能力。

调用 AUTH / BASE 相关能力时，需要使用项目预先指定好的 `appCode`。文档中的示例值建议使用占位符表示，例如：

```text
{APP_CODE}
```

对 BASE API 的调用方式，可直接参考本文档。

### 1.1 鉴权说明

调用 BASE API 时，请求中同样需要添加 `access_token`。

如服务端通过请求头透传，建议同时携带：

```http
Authorization: Bearer {access_token}
Cookie: seabox_acc_token={access_token}; access_token={access_token}
```

## 统一响应示例

```json
{
  "success": true,
  "msg": "success",
  "data": {}
}
```

分页返回示例：

```json
{
  "pageNum": 1,
  "pageSize": 10,
  "total": 1,
  "dataList": []
}
```

## APISIX 网关

### GET /apisix/gw/host

接口描述：

获取APISIX网关路由访问入口

请求入参：

- 无请求体，参数见请求 URL。

响应出参：

- 返回类型: `JSONResult<String>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `String`。


请求示例：

```http
GET /apisix/gw/host HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": "sample"
}
```

### GET /apisix/gw/existsRouteByName

接口描述：

获取APISIX网关路由访问入口

请求入参：

- `routeId` (String，query 参数): 见接口定义
- `routeName` (String，query 参数): 见接口定义

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
GET /apisix/gw/existsRouteByName?routeId=sample&routeName=sample HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```


## 基础与系统

### GET /rest/selectEnumItems

接口描述：

获取枚举项

请求入参：

- `enumName` (String，query 参数): 枚举名称

响应出参：

- 返回类型: `JSONResult<List<EnumItemVo>>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `EnumItemVo` 列表。


请求示例：

```http
GET /rest/selectEnumItems?enumName=DB_TYPE HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": [
    {
      "key": "MYSQL",
      "value": "MySQL"
    }
  ]
}
```

### GET /selectAllConfig

接口描述：

获取配置信息

请求入参：

- 无请求体，参数见请求 URL。

响应出参：

- 返回类型: `JSONResult<String>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `String`。


请求示例：

```http
GET /selectAllConfig HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": "sample"
}
```

### POST /login/error

接口描述：

收集登录错误日志

请求入参：

- 请求体: `LoginErrorInfo`
  - `msg` (String): 错误信息
  - `appCode` (String): 应用编码
  - `json` (Object): 附加错误体

响应出参：

- 返回类型: `void`
- 通常无响应体。


请求示例：

```http
POST /login/error HTTP/1.1
Content-Type: application/json

{
  "msg": "sample",
  "appCode": "sample",
  "json": {
    "code": "401"
  }
}
```

响应示例：

```json
{}
```

### GET /getUsersa

接口描述：

测试接口，返回用户数据源对象

请求入参：

- 无请求体，参数见请求 URL。

响应出参：

- 返回类型: `DsDataSource`


请求示例：

```http
GET /getUsersa HTTP/1.1
```

响应示例：

```json
{
  "tenantId": 10,
  "principalName": "10"
}
```

### POST /ftp/file/list

接口描述：

查询指定目录ftp文件列表

请求入参：

- 请求体: `FtpFileQueryInput`
  - `host` (String): ftp主机
  - `port` (Integer): ftp端口
  - `path` (String): 目录路径

响应出参：

- 返回类型: `JSONResult<List<FtpFileVO>>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `FtpFileVO` 列表。


请求示例：

```http
POST /ftp/file/list HTTP/1.1
Content-Type: application/json

{
  "host": "sample",
  "port": 21,
  "path": "/tmp"
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": [
    {
      "fileName": "a.txt"
    }
  ]
}
```

### POST /ftp/file/delete

接口描述：

删除ftp文件

请求入参：

- 请求体: `FtpFileCommonInput`
  - `host` (String): ftp主机
  - `port` (Integer): ftp端口
  - `path` (String): 文件路径

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /ftp/file/delete HTTP/1.1
Content-Type: application/json

{
  "host": "sample",
  "port": 21,
  "path": "/tmp/a.txt"
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /ftp/file/move

接口描述：

移动ftp文件

请求入参：

- 请求体: `FtpFileMoveInput`
  - `sourcePath` (String): 原路径
  - `targetPath` (String): 目标路径

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /ftp/file/move HTTP/1.1
Content-Type: application/json

{
  "sourcePath": "/tmp/a.txt",
  "targetPath": "/bak/a.txt"
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /ftp/testFtpConnect

接口描述：

测试链接ftp服务器

请求入参：

- 请求体: `FtpFileCommonInput`
  - `host` (String): ftp主机
  - `port` (Integer): ftp端口
  - `userName` (String): 用户名

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /ftp/testFtpConnect HTTP/1.1
Content-Type: application/json

{
  "host": "sample",
  "port": 21,
  "userName": "sample"
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /onlyoffice/saveCallback/{fileId}

接口描述：

处理 OnlyOffice 保存回调

请求入参：

- `fileId` (Long，path 参数): 文件标识
- `fileName` (String，query 参数): 文件名
- `appCode` (String，query 参数): 应用编码
- 请求体: `OnlyOfficeInput`
  - `status` (Integer): 回调状态
  - `url` (String): 文件下载地址

响应出参：

- 返回类型: `ResponseEntity<String>`
- 返回内容为 OnlyOffice 约定 JSON 字符串。


请求示例：

```http
POST /onlyoffice/saveCallback/1?fileName=test.docx&appCode=sample HTTP/1.1
Content-Type: application/json

{
  "status": 2,
  "url": "https://example.com/file.docx"
}
```

响应示例：

```json
{
  "error": 0
}
```


## 数据源

### GET /ds/selectDataSourceInfo

接口描述：

查询数据源实体详情

请求入参：

- `dataSourceId` (Long，query 参数): 数据源id

响应出参：

- 返回类型: `JSONResult<DataSourceApiVo>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `DataSourceApiVo`。
  - `dataSourceId` (Long): 数据库id
  - `dataSourceName` (String): 数据元名称
  - `appCode` (String): capCode
  - `moduleCode` (String): 模块编码
  - `dbType` (String): 数据库类型枚举
  - `dbVersion` (String): 数据库版本
  - `caModeCd` (String): 认证方式代码
  - `host` (String): IP地址
  - `port` (String): 端口
  - `userName` (String): 用户名
  - `password` (String): 密码
  - `kerberosFileId` (Long): kerberos文件
  - `driverPackFileId` (Long): 驱动包文件
  - `templateName` (String): 模板名
  - `caPrincipalName` (String): Kerberos认证主体名称
  - `dbName` (String): 默认数据库(获取数据库时可不传pg类除外)
  - `schemaName` (String): schema 名
  - `param` (String): 参数
  - `urlFormat` (String): url格式
  - `driverClass` (String): 驱动类
  - `serviceSidValue` (String): sid或者serviceName
  - `templateId` (Long): 模板id
  - `serviceSidType` (String): 服务sid类型
  - `connectTestStatus` (String): 连接测试状态


请求示例：

```http
GET /ds/selectDataSourceInfo?dataSourceId=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": {
    "dataSourceId": 1,
    "dataSourceName": "sample",
    "appCode": "sample",
    "moduleCode": "sample",
    "dbType": "sample",
    "dbVersion": "sample",
    "caModeCd": "sample",
    "host": "sample",
    "port": "sample",
    "userName": "sample",
    "password": "sample",
    "kerberosFileId": 1,
    "driverPackFileId": 1,
    "templateName": "sample",
    "caPrincipalName": "sample",
    "dbName": "sample",
    "schemaName": "sample",
    "param": "sample",
    "urlFormat": "sample",
    "driverClass": "sample",
    "serviceSidValue": "sample",
    "templateId": 1,
    "serviceSidType": "sample",
    "connectTestStatus": "sample"
  }
}
```

### POST /ds/selectDataSourceList

接口描述：

查询数据源实体详情

请求入参：

- 请求体: `DataSourceInput`
  - `appCode` (String): appCode
  - `moduleCode` (String): 项目code
  - `dsDataSourceIdList` (List<Long>): 数据源IDList
  - `templateId` (Long): 模板id
  - `tenantId` (Long): 租户id

响应出参：

- 返回类型: `JSONResult<List<DataSourceApiVo>>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `List<DataSourceApiVo>`。


请求示例：

```http
POST /ds/selectDataSourceList HTTP/1.1
Content-Type: application/json

{
  "appCode": "sample",
  "moduleCode": "sample",
  "dsDataSourceIdList": [
    1
  ],
  "templateId": 1,
  "tenantId": 1
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": [
    {
      "dataSourceId": 1,
      "dataSourceName": "sample",
      "appCode": "sample",
      "moduleCode": "sample",
      "dbType": "sample",
      "dbVersion": "sample",
      "caModeCd": "sample",
      "host": "sample",
      "port": "sample",
      "userName": "sample",
      "password": "sample",
      "kerberosFileId": 1,
      "driverPackFileId": 1,
      "templateName": "sample",
      "caPrincipalName": "sample",
      "dbName": "sample",
      "schemaName": "sample",
      "param": "sample",
      "urlFormat": "sample",
      "driverClass": "sample",
      "serviceSidValue": "sample",
      "templateId": 1,
      "serviceSidType": "sample",
      "connectTestStatus": "sample"
    }
  ]
}
```

### GET /ds/selectDataSourceTemplateList

接口描述：

获取所有数据源模板

请求入参：

- 无请求体，参数见请求 URL。

响应出参：

- 返回类型: `JSONResult<List<DataSourceTemplateApiVo>>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `List<DataSourceTemplateApiVo>`。


请求示例：

```http
GET /ds/selectDataSourceTemplateList HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": [
    {
      "templateId": 1,
      "templateName": "sample",
      "dbVersion": "sample",
      "dbType": "sample",
      "driverPackFileId": 1,
      "urlFormat": "sample",
      "driverClass": "sample"
    }
  ]
}
```

### GET /ds/selectDataSourceTemplate

接口描述：

获取数据源模板

请求入参：

- `dataSourceTemplateId` (Long，query 参数): 数据源模板id

响应出参：

- 返回类型: `JSONResult<DataSourceTemplateApiVo>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `DataSourceTemplateApiVo`。
  - `templateId` (Long): 数据库id
  - `templateName` (String): 模板名
  - `dbVersion` (String): 数据源版本
  - `dbType` (String): 数据库类型枚举
  - `driverPackFileId` (Long): 驱动包文件
  - `urlFormat` (String): url格式
  - `driverClass` (String): 驱动类


请求示例：

```http
GET /ds/selectDataSourceTemplate?dataSourceTemplateId=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": {
    "templateId": 1,
    "templateName": "sample",
    "dbVersion": "sample",
    "dbType": "sample",
    "driverPackFileId": 1,
    "urlFormat": "sample",
    "driverClass": "sample"
  }
}
```

### POST /rest/dataSourceTemplate/page

接口描述：

分页查询数据源模板列表

请求入参：

- 请求体: `PageDataSourceTemplateInput`
  - `tenantId` (Long): 租户id
  - `tenantIdList` (List<Long>): 租户id
  - `keyword` (String): 模糊搜索
  - `dbTypeList` (List<String>): 数据源名称
  - `createTmOrder` (Integer): createTmOrder
  - `modifyTmOrder` (Integer): 创建时间排序
  - `pageNum` (Long): 分页参数
  - `pageSize` (Long): 分页参数

响应出参：

- 返回类型: `PageResult<DataSourceTemplateVo>`
- 顶层字段: `pageNum`、`pageSize`、`total`、`dataList`。
- `dataList`: `DataSourceTemplateVo` 列表。
  - `serialVersionUID` (static final long): 见示例
  - `templateId` (Long): 模板标识
  - `templateName` (String): 模板名称
  - `dbVendor` (String): 数据库厂商
  - `dbVersion` (String): 数据库版本
  - `dbType` (String): 数据库类型
  - `driverPackFileId` (Long): 驱动包文件
  - `urlTemplate` (String): url模板
  - `driverClass` (String): 驱动类
  - `iconFileId` (Long): 图标文件
  - `seqNum` (Long): 排序字段
  - `creator` (Long): 记录创建人
  - `tenantId` (Long): 记录创建人
  - `creatorName` (String): 创建人
  - `templateDescribe` (String): 描述
  - `modifyTm` (LocalDateTime): 记录修改时间
  - `modifyName` (String): 记录修改时间
  - `modifier` (Long): 编辑人id
  - `createTm` (LocalDateTime): 记录创建时间


请求示例：

```http
POST /rest/dataSourceTemplate/page HTTP/1.1
Content-Type: application/json

{
  "tenantId": 1,
  "tenantIdList": [
    1
  ],
  "keyword": "sample",
  "dbTypeList": [
    "sample"
  ],
  "createTmOrder": 1,
  "modifyTmOrder": 1,
  "pageNum": 1,
  "pageSize": 1
}
```

响应示例：

```json
{
  "pageNum": 1,
  "pageSize": 10,
  "total": 1,
  "dataList": [
    {
      "templateId": 1,
      "templateName": "sample",
      "dbVendor": "sample",
      "dbVersion": "sample",
      "dbType": "sample",
      "driverPackFileId": 1,
      "urlTemplate": "sample",
      "driverClass": "sample",
      "iconFileId": 1,
      "seqNum": 1,
      "creator": 1,
      "tenantId": 1,
      "creatorName": "sample",
      "templateDescribe": "sample",
      "modifyTm": "2026-04-03 12:00:00",
      "modifyName": "sample",
      "modifier": 1,
      "createTm": "2026-04-03 12:00:00"
    }
  ]
}
```

### POST /rest/datasource/page

接口描述：

分页查询数据源列表

请求入参：

- 请求体: `PageDataSourceInput`
  - `keyword` (String): 数据源名称
  - `appCodeList` (List<String>): 对接系统
  - `appCode` (String): 单个应用的查询
  - `moduleCode` (String): 模块编码
  - `dbConnType` (String): 认证方式
  - `dbType` (String): 数据库类型
  - `dbTypeList` (List<String>): 数据库类型
  - `excludeDbTypeList` (List<String>): 排除的数据库类型
  - `connectTestStatus` (String): 连接测试状态
  - `templateIdList` (List<Long>): 模板选择
  - `dbVendor` (String): 数据库厂商
  - `createTmOrder` (Integer): createTmOrder
  - `modifyTmOrder` (Integer): 创建时间排序
  - `pageNum` (Long): 分页参数
  - `pageSize` (Long): 分页参数

响应出参：

- 返回类型: `PageResult<DataSourceVo>`
- 顶层字段: `pageNum`、`pageSize`、`total`、`dataList`。
- `dataList`: `DataSourceVo` 列表。
  - `dataSourceId` (Long): 数据源标识
  - `dataSourceName` (String): 数据源标识
  - `dataSourceHost` (String): host地址
  - `dataSourcePort` (Integer): port端口
  - `dataSourceUsername` (String): 用户名
  - `dataSourcePwd` (String): 密码
  - `kerberosFileId` (Long): kerberos文件
  - `principalName` (String): 认证principal名称
  - `dataSourceLinkUrl` (String): 链接url
  - `defaultDb` (String): 缺省数据库
  - `dataSourcePara` (Object): 参数
  - `templateId` (Long): 数据源模板文件
  - `appJson` (Object): 可用应用
  - `appCode` (String): 可用应用
  - `moduleCode` (String): 模块编码
  - `dbConnType` (String): 数据源链接方式
  - `dbType` (String): 数据库类型
  - `connectTestStatus` (String): 连接测试状态
  - `permAdmin` (Object): 管理权限
  - `orderNo` (Long): 排序字段
  - `tenantId` (Long): 租户标识
  - `creator` (Long): 记录创建人
  - `creatorName` (String): 记录创建人
  - `dbVendor` (String): 数据库厂商
  - `templateName` (String): 数据库模板名称
  - `createTm` (LocalDateTime): 记录创建时间
  - `modifyTm` (LocalDateTime): 记录修改时间
  - `modifyName` (String): 记录修改时间
  - `modifier` (Long): 编辑人
  - `serviceSidValue` (String): 服务sid类型
  - `serviceSidType` (String): 服务sid类型


请求示例：

```http
POST /rest/datasource/page HTTP/1.1
Content-Type: application/json

{
  "keyword": "sample",
  "appCodeList": [
    "sample"
  ],
  "appCode": "sample",
  "moduleCode": "sample",
  "dbConnType": "sample",
  "dbType": "sample",
  "dbTypeList": [
    "sample"
  ],
  "excludeDbTypeList": [
    "sample"
  ],
  "connectTestStatus": "sample",
  "templateIdList": [
    1
  ],
  "dbVendor": "sample",
  "createTmOrder": 1,
  "modifyTmOrder": 1,
  "pageNum": 1,
  "pageSize": 1
}
```

响应示例：

```json
{
  "pageNum": 1,
  "pageSize": 10,
  "total": 1,
  "dataList": [
    {
      "dataSourceId": 1,
      "dataSourceName": "sample",
      "dataSourceHost": "sample",
      "dataSourcePort": 1,
      "dataSourceUsername": "sample",
      "dataSourcePwd": "sample",
      "kerberosFileId": 1,
      "principalName": "sample",
      "dataSourceLinkUrl": "sample",
      "defaultDb": "sample",
      "dataSourcePara": "sample",
      "templateId": 1,
      "appJson": "sample",
      "appCode": "sample",
      "moduleCode": "sample",
      "dbConnType": "sample",
      "dbType": "sample",
      "connectTestStatus": "sample",
      "permAdmin": "sample",
      "orderNo": 1,
      "tenantId": 1,
      "creator": 1,
      "creatorName": "sample",
      "dbVendor": "sample",
      "templateName": "sample",
      "createTm": "2026-04-03 12:00:00",
      "modifyTm": "2026-04-03 12:00:00",
      "modifyName": "sample",
      "modifier": 1,
      "serviceSidValue": "sample",
      "serviceSidType": "sample"
    }
  ]
}
```

### POST /rest/datasource/batch/delete

接口描述：

批量删除数据源

请求入参：

- 请求体: `IdListInput`
  - `idList` (List<Long>): 见示例

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /rest/datasource/batch/delete HTTP/1.1
Content-Type: application/json

{
  "idList": [
    1
  ]
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /rest/datasource/create

接口描述：

新增数据源

请求入参：

- 请求体: `AddDataSourceInput`
  - `dataSourceName` (String): 数据源名称
  - `dataSourceHost` (String): host地址
  - `dataSourcePort` (Integer): port端口
  - `dataSourceUsername` (String): 数据源用户名
  - `dataSourcePwd` (String): 数据源密码
  - `dbConnType` (String): 数据库连接方式
  - `appCode` (String): 可用应用
  - `moduleCode` (String): 模块编码
  - `kerberosFileId` (Long): kerberos文件
  - `principalName` (String): 认证principal名称
  - `dataSourceLinkUrl` (String): 链接url
  - `defaultDb` (String): 缺省数据库
  - `dataSourcePara` (Object): 数据源参数
  - `appJson` (Object): 可用应用
  - `permAdmin` (Object): 管理权限
  - `permEdit` (Object): 编辑权限
  - `permRead` (Object): 查看权限
  - `permList` (Object): 列表权限
  - `permNone` (Object): 无权限
  - `orderNo` (Long): 排序字段
  - `serviceSidValue` (String): 服务sid类型
  - `serviceSidType` (String): 服务sid类型
  - `templateId` (Long): 模板标识

响应出参：

- 返回类型: `JSONResult<Long>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Long`。


请求示例：

```http
POST /rest/datasource/create HTTP/1.1
Content-Type: application/json

{
  "dataSourceName": "sample",
  "dataSourceHost": "sample",
  "dataSourcePort": 1,
  "dataSourceUsername": "sample",
  "dataSourcePwd": "sample",
  "dbConnType": "sample",
  "appCode": "sample",
  "moduleCode": "sample",
  "kerberosFileId": 1,
  "principalName": "sample",
  "dataSourceLinkUrl": "sample",
  "defaultDb": "sample",
  "dataSourcePara": "sample",
  "appJson": "sample",
  "permAdmin": "sample",
  "permEdit": "sample",
  "permRead": "sample",
  "permList": "sample",
  "permNone": "sample",
  "orderNo": 1,
  "serviceSidValue": "sample",
  "serviceSidType": "sample",
  "templateId": 1
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": 1
}
```

### POST /rest/datasource/edit

接口描述：

编辑数据源

请求入参：

- 请求体: `EditDataSourceInput`
  - `dataSourceId` (Long): 数据源标识
  - `dataSourceName` (String): 数据源名称
  - `dataSourceHost` (String): host地址
  - `dataSourcePort` (Integer): port端口
  - `dataSourceUsername` (String): 数据源用户名
  - `dataSourcePwd` (String): 数据源密码
  - `dbConnType` (String): 数据库连接方式
  - `kerberosFileId` (Long): kerberos文件
  - `principalName` (String): 认证principal名称
  - `dataSourceLinkUrl` (String): 链接url
  - `defaultDb` (String): 缺省数据库
  - `dataSourcePara` (Object): 数据源参数
  - `appJson` (Object): 可用应用
  - `permAdmin` (Object): 管理权限
  - `permEdit` (Object): 编辑权限
  - `permRead` (Object): 查看权限
  - `permList` (Object): 列表权限
  - `permNone` (Object): 无权限
  - `orderNo` (Long): 排序字段
  - `templateId` (Long): 模板标识
  - `serviceSidValue` (String): 服务sid类型
  - `serviceSidType` (String): 服务sid类型

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /rest/datasource/edit HTTP/1.1
Content-Type: application/json

{
  "dataSourceId": 1,
  "dataSourceName": "sample",
  "dataSourceHost": "sample",
  "dataSourcePort": 1,
  "dataSourceUsername": "sample",
  "dataSourcePwd": "sample",
  "dbConnType": "sample",
  "kerberosFileId": 1,
  "principalName": "sample",
  "dataSourceLinkUrl": "sample",
  "defaultDb": "sample",
  "dataSourcePara": "sample",
  "appJson": "sample",
  "permAdmin": "sample",
  "permEdit": "sample",
  "permRead": "sample",
  "permList": "sample",
  "permNone": "sample",
  "orderNo": 1,
  "templateId": 1,
  "serviceSidValue": "sample",
  "serviceSidType": "sample"
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /rest/datasource/edit/select

接口描述：

选择性编辑数据源

请求入参：

- 请求体: `EditDataSourceInput`
  - `dataSourceId` (Long): 数据源标识
  - `dataSourceName` (String): 数据源名称
  - `dataSourceHost` (String): host地址
  - `dataSourcePort` (Integer): port端口
  - `dataSourceUsername` (String): 数据源用户名
  - `dataSourcePwd` (String): 数据源密码
  - `dbConnType` (String): 数据库连接方式
  - `kerberosFileId` (Long): kerberos文件
  - `principalName` (String): 认证principal名称
  - `dataSourceLinkUrl` (String): 链接url
  - `defaultDb` (String): 缺省数据库
  - `dataSourcePara` (Object): 数据源参数
  - `appJson` (Object): 可用应用
  - `permAdmin` (Object): 管理权限
  - `permEdit` (Object): 编辑权限
  - `permRead` (Object): 查看权限
  - `permList` (Object): 列表权限
  - `permNone` (Object): 无权限
  - `orderNo` (Long): 排序字段
  - `templateId` (Long): 模板标识
  - `serviceSidValue` (String): 服务sid类型
  - `serviceSidType` (String): 服务sid类型

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /rest/datasource/edit/select HTTP/1.1
Content-Type: application/json

{
  "dataSourceId": 1,
  "dataSourceName": "sample",
  "dataSourceHost": "sample",
  "dataSourcePort": 1,
  "dataSourceUsername": "sample",
  "dataSourcePwd": "sample",
  "dbConnType": "sample",
  "kerberosFileId": 1,
  "principalName": "sample",
  "dataSourceLinkUrl": "sample",
  "defaultDb": "sample",
  "dataSourcePara": "sample",
  "appJson": "sample",
  "permAdmin": "sample",
  "permEdit": "sample",
  "permRead": "sample",
  "permList": "sample",
  "permNone": "sample",
  "orderNo": 1,
  "templateId": 1,
  "serviceSidValue": "sample",
  "serviceSidType": "sample"
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### GET /rest/datasource/info

接口描述：

查询数据源实体详情

请求入参：

- `dataSourceId` (Long，query 参数): 数据源id

响应出参：

- 返回类型: `JSONResult<DataSourceVo>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `DataSourceVo`。
  - `dataSourceId` (Long): 数据源标识
  - `dataSourceName` (String): 数据源标识
  - `dataSourceHost` (String): host地址
  - `dataSourcePort` (Integer): port端口
  - `dataSourceUsername` (String): 用户名
  - `dataSourcePwd` (String): 密码
  - `kerberosFileId` (Long): kerberos文件
  - `principalName` (String): 认证principal名称
  - `dataSourceLinkUrl` (String): 链接url
  - `defaultDb` (String): 缺省数据库
  - `dataSourcePara` (Object): 参数
  - `templateId` (Long): 数据源模板文件
  - `appJson` (Object): 可用应用
  - `appCode` (String): 可用应用
  - `moduleCode` (String): 模块编码
  - `dbConnType` (String): 数据源链接方式
  - `dbType` (String): 数据库类型
  - `connectTestStatus` (String): 连接测试状态
  - `permAdmin` (Object): 管理权限
  - `orderNo` (Long): 排序字段
  - `tenantId` (Long): 租户标识
  - `creator` (Long): 记录创建人
  - `creatorName` (String): 记录创建人
  - `dbVendor` (String): 数据库厂商
  - `templateName` (String): 数据库模板名称
  - `createTm` (LocalDateTime): 记录创建时间
  - `modifyTm` (LocalDateTime): 记录修改时间
  - `modifyName` (String): 记录修改时间
  - `modifier` (Long): 编辑人
  - `serviceSidValue` (String): 服务sid类型
  - `serviceSidType` (String): 服务sid类型


请求示例：

```http
GET /rest/datasource/info?dataSourceId=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": {
    "dataSourceId": 1,
    "dataSourceName": "sample",
    "dataSourceHost": "sample",
    "dataSourcePort": 1,
    "dataSourceUsername": "sample",
    "dataSourcePwd": "sample",
    "kerberosFileId": 1,
    "principalName": "sample",
    "dataSourceLinkUrl": "sample",
    "defaultDb": "sample",
    "dataSourcePara": "sample",
    "templateId": 1,
    "appJson": "sample",
    "appCode": "sample",
    "moduleCode": "sample",
    "dbConnType": "sample",
    "dbType": "sample",
    "connectTestStatus": "sample",
    "permAdmin": "sample",
    "orderNo": 1,
    "tenantId": 1,
    "creator": 1,
    "creatorName": "sample",
    "dbVendor": "sample",
    "templateName": "sample",
    "createTm": "2026-04-03 12:00:00",
    "modifyTm": "2026-04-03 12:00:00",
    "modifyName": "sample",
    "modifier": 1,
    "serviceSidValue": "sample",
    "serviceSidType": "sample"
  }
}
```

### GET /rest/datasource/connect/testByDataSourceId

接口描述：

测试数据源的链接可行

请求入参：

- `dataSourceId` (Long，query 参数): 数据源id

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
GET /rest/datasource/connect/testByDataSourceId?dataSourceId=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /rest/datasource/connect/test

接口描述：

数据源链接测试

请求入参：

- 请求体: `TestConnectDataSourceInput`
  - `dataSourceId` (Long): 数据源id
  - `dataSourceHost` (String): host地址
  - `dataSourcePort` (Integer): port端口
  - `dataSourceUsername` (String): 数据源用户名
  - `dataSourcePwd` (String): 数据源密码
  - `dbConnType` (String): 数据库连接方式
  - `kerberosFileId` (Long): kerberos文件
  - `principalName` (String): 认证principal名称
  - `dataSourceLinkUrl` (String): 链接url
  - `defaultDb` (String): 缺省数据库
  - `dataSourcePara` (Object): 数据源参数
  - `templateId` (Long): 模板标识
  - `serviceSidValue` (String): 服务sid类型
  - `serviceSidType` (String): 服务sid类型

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /rest/datasource/connect/test HTTP/1.1
Content-Type: application/json

{
  "dataSourceId": 1,
  "dataSourceHost": "sample",
  "dataSourcePort": 1,
  "dataSourceUsername": "sample",
  "dataSourcePwd": "sample",
  "dbConnType": "sample",
  "kerberosFileId": 1,
  "principalName": "sample",
  "dataSourceLinkUrl": "sample",
  "defaultDb": "sample",
  "dataSourcePara": "sample",
  "templateId": 1,
  "serviceSidValue": "sample",
  "serviceSidType": "sample"
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /rest/datasource/add

接口描述：

新增数据源

请求入参：

- 请求体: `AddDataSourceInput`
  - `dataSourceName` (String): 数据源名称
  - `dbType` (String): 数据源类型

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /rest/datasource/add HTTP/1.1
Content-Type: application/json

{
  "dataSourceName": "sample",
  "dbType": "MYSQL"
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /rest/datasource/delete

接口描述：

删除数据源

请求入参：

- 请求体: `IdInput`
  - `id` (Long): 数据源标识

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /rest/datasource/delete HTTP/1.1
Content-Type: application/json

{
  "id": 1
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### GET /rest/dbType/list

接口描述：

获取数据源类型列表

请求入参：

- 无请求体，参数见请求 URL。

响应出参：

- 返回类型: `JSONResult<List<EnumItemVo>>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `EnumItemVo` 列表。


请求示例：

```http
GET /rest/dbType/list HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": [
    {
      "key": "MYSQL",
      "value": "MySQL"
    }
  ]
}
```

### GET /rest/dbType/version/list

接口描述：

获取数据源版本列表

请求入参：

- `dbType` (String，query 参数): 数据源类型

响应出参：

- 返回类型: `JSONResult<List<SingleValueVo<String>>>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: 单值列表。


请求示例：

```http
GET /rest/dbType/version/list?dbType=MYSQL HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": [
    {
      "value": "8.0"
    }
  ]
}
```

### POST /rest/datasourceTemplate/add

接口描述：

新增数据源模板

请求入参：

- 请求体: `AddDataSourceTemplateInput`
  - `templateName` (String): 模板名称
  - `dbType` (String): 数据源类型

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /rest/datasourceTemplate/add HTTP/1.1
Content-Type: application/json

{
  "templateName": "sample",
  "dbType": "MYSQL"
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /rest/datasourceTemplate/edit

接口描述：

更新数据源模板

请求入参：

- 请求体: `EditDataSourceTemplateInput`
  - `dataSourceTemplateId` (Long): 模板标识
  - `templateName` (String): 模板名称

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /rest/datasourceTemplate/edit HTTP/1.1
Content-Type: application/json

{
  "dataSourceTemplateId": 1,
  "templateName": "sample"
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### GET /rest/dataSourceTemplate/info

接口描述：

查询数据源模板详情

请求入参：

- `dataSourceTemplateId` (Long，query 参数): 模板标识

响应出参：

- 返回类型: `JSONResult<DataSourceTemplateVo>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `DataSourceTemplateVo`。


请求示例：

```http
GET /rest/dataSourceTemplate/info?dataSourceTemplateId=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": {
    "dataSourceTemplateId": 1,
    "templateName": "sample"
  }
}
```

### POST /rest/datasourceTemplate/delete

接口描述：

删除数据源模板

请求入参：

- 请求体: `IdInput`
  - `id` (Long): 模板标识

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /rest/datasourceTemplate/delete HTTP/1.1
Content-Type: application/json

{
  "id": 1
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /rest/datasourceTemplate/batch/delete

接口描述：

批量删除数据源模板

请求入参：

- 请求体: `IdListInput`
  - `idList` (List<Long>): 模板标识列表

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /rest/datasourceTemplate/batch/delete HTTP/1.1
Content-Type: application/json

{
  "idList": [
    1,
    2
  ]
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```


## 文件

### GET /file/download

接口描述：

文件下载

请求入参：

- `fileId` (Long，query 参数): 文件id

响应出参：

- 返回类型: `Response`
- 返回二进制流，响应头通常包含 `Content-Type` 和 `Content-Disposition`。


请求示例：

```http
GET /file/download?fileId=1 HTTP/1.1
```

响应示例：

```text
HTTP/1.1 200 OK
Content-Type: application/octet-stream
Content-Disposition: attachment; filename="export.bin"

<binary-stream>
```

### POST /file/upload

接口描述：

文件upload

请求入参：

- `file` (MultipartFile，multipart): 文件id
- `ifTmp` (boolean，query 参数): 是否是临时文件
- `appCode` (String，query 参数): 所属应用的code

响应出参：

- 返回类型: `JSONResult<OSFileApiVo>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `OSFileApiVo`。
  - `fileId` (Long): 文件id
  - `fileName` (String): 文件名称
  - `contentType` (String): 文件的contentType
  - `length` (Long): 文件的长度大小
  - `md5` (String): 文件md5


请求示例：

```http
POST /file/upload?ifTmp=True&appCode=sample HTTP/1.1
Content-Type: multipart/form-data

file: <binary>
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": {
    "fileId": 1,
    "fileName": "sample",
    "contentType": "sample",
    "length": 1,
    "md5": "sample"
  }
}
```

### POST /file/public/upload

接口描述：

上传公开文件

请求入参：

- `file` (MultipartFile，multipart): 文件id
- `ifTmp` (boolean，query 参数): 是否是临时文件
- `appCode` (String，query 参数): 所属应用的code

响应出参：

- 返回类型: `JSONResult<OSFileApiVo>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `OSFileApiVo`。
  - `fileId` (Long): 文件id
  - `fileName` (String): 文件名称
  - `contentType` (String): 文件的contentType
  - `length` (Long): 文件的长度大小
  - `md5` (String): 文件md5


请求示例：

```http
POST /file/public/upload?ifTmp=True&appCode=sample HTTP/1.1
Content-Type: multipart/form-data

file: <binary>
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": {
    "fileId": 1,
    "fileName": "sample",
    "contentType": "sample",
    "length": 1,
    "md5": "sample"
  }
}
```

### POST /file/reUpload

接口描述：

文件upload

请求入参：

- `file` (MultipartFile，multipart): 文件
- `fileId` (Long，query 参数): 文件id

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /file/reUpload?fileId=1 HTTP/1.1
Content-Type: multipart/form-data

file: <binary>
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /file/biteArray/upload

接口描述：

文件upload

请求入参：

- 请求体: `byte[]`
- `ifTmp` (boolean，query 参数): 是否是临时文件
- `fileName` (String，query 参数): 文件名

响应出参：

- 返回类型: `JSONResult<OSFileApiVo>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `OSFileApiVo`。
  - `fileId` (Long): 文件id
  - `fileName` (String): 文件名称
  - `contentType` (String): 文件的contentType
  - `length` (Long): 文件的长度大小
  - `md5` (String): 文件md5


请求示例：

```http
POST /file/biteArray/upload?ifTmp=True&appCode=sample&fileName=sample HTTP/1.1
Content-Type: application/json

"SGVsbG8="
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": {
    "fileId": 1,
    "fileName": "sample",
    "contentType": "sample",
    "length": 1,
    "md5": "sample"
  }
}
```

### GET /file/delete

接口描述：

文件删除

请求入参：

- `fileId` (Long，query 参数): 文件数据

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
GET /file/delete?fileId=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### GET /file/info

接口描述：

获取文件的摘要

请求入参：

- `fileId` (Long，query 参数): 文件id

响应出参：

- 返回类型: `JSONResult<FileApiVo>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `FileApiVo`。
  - `fileId` (Long): 文件id
  - `fileName` (String): 文件名称
  - `appCode` (String): 所属应用
  - `fileSize` (Long): 文件大小
  - `fileThumbnailName` (String): 缩略图
  - `fileContentType` (String): 文件内容类型
  - `fileType` (String): 文件类型
  - `sourceFileName` (String): 源文件名
  - `fileDescribe` (String): 文件描述
  - `ifTmp` (String): 是否临时文件
  - `tenantId` (Long): 租户标识
  - `creator` (Long): 记录创建人
  - `modifier` (Long): 记录修改人
  - `createTm` (LocalDateTime): 记录创建时间
  - `modifyTm` (LocalDateTime): 记录修改时间


请求示例：

```http
GET /file/info?fileId=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": {
    "fileId": 1,
    "fileName": "sample",
    "appCode": "sample",
    "fileSize": 1,
    "fileThumbnailName": "sample",
    "fileContentType": "sample",
    "fileType": "sample",
    "sourceFileName": "sample",
    "fileDescribe": "sample",
    "ifTmp": "sample",
    "tenantId": 1,
    "creator": 1,
    "modifier": 1,
    "createTm": "2026-04-03 12:00:00",
    "modifyTm": "2026-04-03 12:00:00"
  }
}
```

### GET /file/copy

接口描述：

获取文件的摘要

请求入参：

- `fileId` (Long，query 参数): 文件id

响应出参：

- 返回类型: `JSONResult<Long>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Long`。


请求示例：

```http
GET /file/copy?fileId=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": 1
}
```

### GET /file/template/export

接口描述：

模板的下载导出

请求入参：

- 无请求体，参数见请求 URL。

响应出参：

- 返回类型: `ResponseEntity<InputStreamResource>`
- 返回二进制文件流。


请求示例：

```http
GET /file/template/export HTTP/1.1
```

响应示例：

```json
{
  "contentType": "application/octet-stream",
  "body": "binary"
}
```

### POST /file/template/import

接口描述：

迁移导入文件

请求入参：

- `file` (MultipartFile，form-data): zip文件

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /file/template/import HTTP/1.1
Content-Type: multipart/form-data

file=@template.zip
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /file/template/import/init

接口描述：

上线时导入模板

请求入参：

- `file` (MultipartFile，form-data): zip文件

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /file/template/import/init HTTP/1.1
Content-Type: multipart/form-data

file=@template.zip
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### GET /file/template/export/init

接口描述：

模板的下载导出

请求入参：

- 无请求体，参数见请求 URL。

响应出参：

- 返回类型: `ResponseEntity<InputStreamResource>`
- 返回二进制文件流。


请求示例：

```http
GET /file/template/export/init HTTP/1.1
```

响应示例：

```json
{
  "contentType": "application/octet-stream",
  "body": "binary"
}
```

### GET /file/thumbnail/download

接口描述：

文件缩略图下载

请求入参：

- `fileId` (Long，query 参数): 文件标识

响应出参：

- 返回类型: `ResponseEntity<InputStreamResource>`
- 返回二进制文件流。


请求示例：

```http
GET /file/thumbnail/download?fileId=1 HTTP/1.1
```

响应示例：

```json
{
  "contentType": "application/octet-stream",
  "body": "binary"
}
```

### GET /file/downloadHistory

接口描述：

文件历史下载

请求入参：

- `fileVersionId` (Long，query 参数): 文件版本标识

响应出参：

- 返回类型: `ResponseEntity<InputStreamResource>`
- 返回二进制文件流。


请求示例：

```http
GET /file/downloadHistory?fileVersionId=1 HTTP/1.1
```

响应示例：

```json
{
  "contentType": "application/octet-stream",
  "body": "binary"
}
```

### GET /file/download/list

接口描述：

文件批量下载

请求入参：

- `fileIdList` (List<Long>，query 参数): 文件标识列表

响应出参：

- 返回类型: `ResponseEntity<InputStreamResource>`
- 返回二进制文件流。


请求示例：

```http
GET /file/download/list?fileIdList=1&fileIdList=2 HTTP/1.1
```

响应示例：

```json
{
  "contentType": "application/octet-stream",
  "body": "binary"
}
```

### GET /file/fileName/download

接口描述：

根据文件名下载

请求入参：

- `fileName` (String，query 参数): 文件名

响应出参：

- 返回类型: `ResponseEntity<InputStreamResource>`
- 返回二进制文件流。


请求示例：

```http
GET /file/fileName/download?fileName=sample.txt HTTP/1.1
```

响应示例：

```json
{
  "contentType": "application/octet-stream",
  "body": "binary"
}
```

### GET /file/fileName/public/download

接口描述：

根据文件名下载公开文件

请求入参：

- `fileName` (String，query 参数): 文件名

响应出参：

- 返回类型: `ResponseEntity<InputStreamResource>`
- 返回二进制文件流。


请求示例：

```http
GET /file/fileName/public/download?fileName=sample.txt HTTP/1.1
```

响应示例：

```json
{
  "contentType": "application/octet-stream",
  "body": "binary"
}
```

### POST /file/upload/thumbnail

接口描述：

上传缩略图

请求入参：

- `file` (MultipartFile，form-data): 缩略图文件
- `fileId` (Long，query/form 参数): 文件标识

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /file/upload/thumbnail?fileId=1 HTTP/1.1
Content-Type: multipart/form-data

file=@thumb.png
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### GET /file/clear

接口描述：

资源清理

请求入参：

- `startDateTime` (LocalDateTime，query 参数): 开始时间
- `endDateTime` (LocalDateTime，query 参数): 结束时间

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
GET /file/clear?startDateTime=2026-04-01T00:00:00&endDateTime=2026-04-11T00:00:00 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /file/batch/upload

接口描述：

文件批量上传

请求入参：

- `files` (MultipartFile[]，form-data): 文件数组
- `appCode` (String，query/form 参数): 应用编码

响应出参：

- 返回类型: `JSONResult<List<OSFileApiVo>>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `OSFileApiVo` 列表。


请求示例：

```http
POST /file/batch/upload?appCode=sample HTTP/1.1
Content-Type: multipart/form-data

files=@a.txt
files=@b.txt
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": [
    {
      "fileId": 1
    },
    {
      "fileId": 2
    }
  ]
}
```

### GET /file/custom/thumbnail/download

接口描述：

自定义文件缩略图下载

请求入参：

- `fileId` (Long，query 参数): 文件标识
- `width` (Integer，query 参数): 宽度

响应出参：

- 返回类型: `ResponseEntity<InputStreamResource>`
- 返回二进制文件流。


请求示例：

```http
GET /file/custom/thumbnail/download?fileId=1&width=200 HTTP/1.1
```

响应示例：

```json
{
  "contentType": "application/octet-stream",
  "body": "binary"
}
```

### POST /file/export

接口描述：

文件导出

请求入参：

- 请求体: `FileExportInput`
  - `fileIdList` (List<Long>): 文件标识列表
  - `zipFileName` (String): zip文件名

响应出参：

- 返回类型: `ResponseEntity<InputStreamResource>`
- 返回二进制文件流。


请求示例：

```http
POST /file/export HTTP/1.1
Content-Type: application/json

{
  "fileIdList": [
    1,
    2
  ],
  "zipFileName": "sample.zip"
}
```

响应示例：

```json
{
  "contentType": "application/octet-stream",
  "body": "binary"
}
```

### POST /file/part/lighting

接口描述：

文件秒传记录

请求入参：

- 请求体: `FileUploadInitCheckInput`
  - `md5` (String): 文件摘要
  - `fileName` (String): 文件名
  - `fileSize` (Long): 文件大小

响应出参：

- 返回类型: `JSONResult<Long>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Long`。


请求示例：

```http
POST /file/part/lighting HTTP/1.1
Content-Type: application/json

{
  "md5": "sample",
  "fileName": "a.txt",
  "fileSize": 1
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": 1
}
```

### POST /file/part/init

接口描述：

文件分片上传初始化

请求入参：

- 请求体: `FileUploadInitCheckInput`
  - `md5` (String): 文件摘要
  - `fileName` (String): 文件名
  - `fileSize` (Long): 文件大小

响应出参：

- 返回类型: `JSONResult<FileUploadInitCheckVo>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `FileUploadInitCheckVo`。


请求示例：

```http
POST /file/part/init HTTP/1.1
Content-Type: application/json

{
  "md5": "sample",
  "fileName": "a.txt",
  "fileSize": 1
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": {
    "fileId": 1,
    "finishedPartList": []
  }
}
```

### POST /file/part/upload

接口描述：

分片上传

请求入参：

- `file` (MultipartFile，form-data): 分片文件
- `fileId` (Long，query/form 参数): 文件标识
- `partNumber` (Integer，query/form 参数): 分片序号

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /file/part/upload?fileId=1&partNumber=1 HTTP/1.1
Content-Type: multipart/form-data

file=@part.bin
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### GET /file/part/thumbnail/download

接口描述：

文件分片缩略图下载

请求入参：

- `fileId` (Long，query 参数): 文件标识
- `width` (Integer，query 参数): 宽度
- `height` (Integer，query 参数): 高度

响应出参：

- 返回类型: `ResponseEntity<InputStreamResource>`
- 返回二进制文件流。


请求示例：

```http
GET /file/part/thumbnail/download?fileId=1&width=200&height=200 HTTP/1.1
```

响应示例：

```json
{
  "contentType": "application/octet-stream",
  "body": "binary"
}
```

### POST /file/part/upload/record

接口描述：

记录文件上传完成

请求入参：

- 请求体: `FilePartUploadRecordFinishedInput`
  - `fileId` (Long): 文件标识
  - `partTotal` (Integer): 分片总数

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /file/part/upload/record HTTP/1.1
Content-Type: application/json

{
  "fileId": 1,
  "partTotal": 3
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### GET /file/ocr/{fileMd5}/download

接口描述：

OCR 文件下载

请求入参：

- `fileMd5` (String，path 参数): 文件摘要
- `fileName` (String，query 参数): 文件名

响应出参：

- 返回类型: `ResponseEntity<InputStreamResource>`
- 返回二进制文件流。


请求示例：

```http
GET /file/ocr/abc123/download?fileName=sample.pdf HTTP/1.1
```

响应示例：

```json
{
  "contentType": "application/octet-stream",
  "body": "binary"
}
```

### POST /ambry/to/minio

接口描述：

ambry 到 minio 转换下载

请求入参：

- `file` (MultipartFile，form-data): 待转换文件

响应出参：

- 返回类型: `ResponseEntity<InputStreamResource>`
- 返回二进制文件流。


请求示例：

```http
POST /ambry/to/minio HTTP/1.1
Content-Type: multipart/form-data

file=@source.xlsx
```

响应示例：

```json
{
  "contentType": "application/octet-stream",
  "body": "binary"
}
```


## 调度任务组

### GET /job/group/pageJobGroup

接口描述：

调度任务组分页查询

请求入参：

- 请求体: `JobGroupQueryApiInput`
  - `pageNum` (long): 分页页码
  - `pageSize` (long): 分页大小
  - `keyword` (String): 关键字搜索:任务组id、任务组名称
  - `appCode` (String): 应用编码
  - `moduleCode` (String): 模块编码
  - `tenantId` (Long): 租户id

响应出参：

- 返回类型: `PageResult<JobGroupApiVO>`
- 顶层字段: `pageNum`、`pageSize`、`total`、`dataList`。
- `dataList`: `JobGroupApiVO` 列表。
  - `jobGrpId` (Long): 任务组标识
  - `jobGrpName` (String): 任务组名称
  - `jobGrpDescribe` (String): 任务描述
  - `tenantId` (Long): 租户标识
  - `creator` (Long): 记录创建人
  - `modifier` (Long): 记录修改人
  - `createTm` (LocalDateTime): 记录创建时间
  - `modifyTm` (LocalDateTime): 记录修改时间
  - `ifDelete` (String): 是否删除  0:未删除,1:删除
  - `ifPreset` (String): 是否预置  0:非预置数据,1:预置数据
  - `appCode` (String): 应用编码
  - `moduleCode` (String): 模块编码
  - `groupBusinessType` (String): 任务组业务类型


请求示例：

```http
GET /job/group/pageJobGroup HTTP/1.1
Content-Type: application/json

{
  "pageNum": 1,
  "pageSize": 1,
  "keyword": "sample",
  "appCode": "sample",
  "moduleCode": "sample",
  "tenantId": 1
}
```

响应示例：

```json
{
  "pageNum": 1,
  "pageSize": 10,
  "total": 1,
  "dataList": [
    {
      "jobGrpId": 1,
      "jobGrpName": "sample",
      "jobGrpDescribe": "sample",
      "tenantId": 1,
      "creator": 1,
      "modifier": 1,
      "createTm": "2026-04-03 12:00:00",
      "modifyTm": "2026-04-03 12:00:00",
      "ifDelete": "sample",
      "ifPreset": "sample",
      "appCode": "sample",
      "moduleCode": "sample",
      "groupBusinessType": "sample"
    }
  ]
}
```

### POST /job/group/add

接口描述：

新增调度任务组

请求入参：

- 请求体: `JobGroupApiInput`
  - `jobGrpId` (Long): 任务组标识
  - `jobGrpName` (String): 任务组名称
  - `jobGrpDescribe` (String): 任务组描述
  - `appCode` (String): 应用编码
  - `moduleCode` (String): 模块编码
  - `groupBusinessType` (String): 任务组业务类型

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /job/group/add HTTP/1.1
Content-Type: application/json

{
  "jobGrpId": 1,
  "jobGrpName": "sample",
  "jobGrpDescribe": "sample",
  "appCode": "sample",
  "moduleCode": "sample",
  "groupBusinessType": "sample"
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /job/group/edit

接口描述：

更新调度任务组

请求入参：

- 请求体: `JobGroupApiInput`
  - `jobGrpId` (Long): 任务组标识
  - `jobGrpName` (String): 任务组名称
  - `jobGrpDescribe` (String): 任务组描述
  - `appCode` (String): 应用编码
  - `moduleCode` (String): 模块编码
  - `groupBusinessType` (String): 任务组业务类型

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /job/group/edit HTTP/1.1
Content-Type: application/json

{
  "jobGrpId": 1,
  "jobGrpName": "sample",
  "jobGrpDescribe": "sample",
  "appCode": "sample",
  "moduleCode": "sample",
  "groupBusinessType": "sample"
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /job/group/delete

接口描述：

删除调度任务组

请求入参：

- `id` (Long，query 参数): 任务组标识

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /job/group/delete?id=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### GET /job/group/getGroupById/{grpId}

接口描述：

通过id查询任务组详情

请求入参：

- `grpId` (Long，path 参数): 任务组标识

响应出参：

- 返回类型: `JSONResult<JobGroupApiVO>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `JobGroupApiVO`。
  - `jobGrpId` (Long): 任务组标识
  - `jobGrpName` (String): 任务组名称
  - `jobGrpDescribe` (String): 任务描述
  - `tenantId` (Long): 租户标识
  - `creator` (Long): 记录创建人
  - `modifier` (Long): 记录修改人
  - `createTm` (LocalDateTime): 记录创建时间
  - `modifyTm` (LocalDateTime): 记录修改时间
  - `ifDelete` (String): 是否删除  0:未删除,1:删除
  - `ifPreset` (String): 是否预置  0:非预置数据,1:预置数据
  - `appCode` (String): 应用编码
  - `moduleCode` (String): 模块编码
  - `groupBusinessType` (String): 任务组业务类型


请求示例：

```http
GET /job/group/getGroupById/{grpId}?grpId=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": {
    "jobGrpId": 1,
    "jobGrpName": "sample",
    "jobGrpDescribe": "sample",
    "tenantId": 1,
    "creator": 1,
    "modifier": 1,
    "createTm": "2026-04-03 12:00:00",
    "modifyTm": "2026-04-03 12:00:00",
    "ifDelete": "sample",
    "ifPreset": "sample",
    "appCode": "sample",
    "moduleCode": "sample",
    "groupBusinessType": "sample"
  }
}
```

### POST /job/group/start

接口描述：

启动调度任务组

请求入参：

- `grpId` (Long，query 参数): 任务组标识

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /job/group/start?grpId=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /job/group/stop

接口描述：

停止调度任务组

请求入参：

- `grpId` (Long，query 参数): 任务组标识

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /job/group/stop?grpId=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /job/group/stopAndDelete

接口描述：

停用并删除调度任务组

请求入参：

- `grpId` (Long，query 参数): 任务组标识

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /job/group/stopAndDelete?grpId=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /job/group/stopAndDeleteGroupJobList

接口描述：

停用并删除调度任务组及组内任务

请求入参：

- `grpId` (Long，query 参数): 任务组标识

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /job/group/stopAndDeleteGroupJobList?grpId=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /job/group/addSimpleJobGroup

接口描述：

新增简单调度任务组

请求入参：

- 请求体: `JobSimpleGroupApiInput`
  - `jobGrpName` (String): 任务组名称
  - `appCode` (String): 应用编码
  - `moduleCode` (String): 模块编码
  - `isPreset` (String): 是否预置
  - `isGroupStart` (Boolean): 是否启动任务组
  - `groupBusinessType` (String): 任务组业务类型
  - `jobInfoApiInputs` (List<JobInfoApiInput>): 任务列表

响应出参：

- 返回类型: `JSONResult<Long>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Long`。


请求示例：

```http
POST /job/group/addSimpleJobGroup HTTP/1.1
Content-Type: application/json

{
  "jobGrpName": "sample",
  "appCode": "sample",
  "moduleCode": "sample",
  "isPreset": "sample",
  "isGroupStart": true,
  "groupBusinessType": "sample",
  "jobInfoApiInputs": [
    {}
  ]
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": 1
}
```

### GET /job/group/getGroupJobList

接口描述：

获取任务组内任务列表

请求入参：

- `grpId` (Long，query 参数): 任务组标识

响应出参：

- 返回类型: `JSONResult<List<JobInfoApiVO>>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `List<JobInfoApiVO>`。


请求示例：

```http
GET /job/group/getGroupJobList?grpId=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": [
    {
      "jobId": 1,
      "jobName": "sample",
      "jobCode": "sample",
      "jobCron": "sample",
      "jobDescribe": "sample",
      "jobParam": "sample",
      "alarmEmail": "sample",
      "requestUrl": "sample",
      "jobType": "sample",
      "requestType": "sample",
      "requestCorrectMark": "sample",
      "jobTag": "sample",
      "tenantId": 1,
      "creator": 1,
      "modifier": 1,
      "createTm": "2026-04-03 12:00:00",
      "modifyTm": "2026-04-03 12:00:00",
      "ifDelete": "sample",
      "appCode": "sample",
      "moduleCode": "sample",
      "jobBusinessType": "sample"
    }
  ]
}
```

### GET /job/group/exportJobGroup

接口描述：

导出定时任务数据

请求入参：

- `appCode` (String，query 参数): 应用编码
- `moduleCode` (String，query 参数): 模块编码
- `tenantId` (Long，query 参数): 租户id

响应出参：

- 返回类型: `Response`
- 返回二进制流，响应头通常包含 `Content-Type` 和 `Content-Disposition`。


请求示例：

```http
GET /job/group/exportJobGroup?appCode=sample&moduleCode=sample&tenantId=1 HTTP/1.1
```

响应示例：

```text
HTTP/1.1 200 OK
Content-Type: application/octet-stream
Content-Disposition: attachment; filename="export.bin"

<binary-stream>
```

### POST /job/group/importJobGroup

接口描述：

导入定时任务数据

请求入参：

- `appCode` (String，query 参数): 应用编码
- `moduleCode` (String，query 参数): 模块编码
- `file` (MultipartFile，multipart): 任务数据文件

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /job/group/importJobGroup?appCode=sample&moduleCode=sample HTTP/1.1
Content-Type: multipart/form-data

file: <binary>
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /job/group/copyJobGroup

接口描述：

复制定时任务数据

请求入参：

- `appCode` (String，query 参数): 应用编码
- `moduleCode` (String，query 参数): 模块编码
- `newModuleCode` (String，query 参数): 新模块编码
- `tenantId` (Long，query 参数): 租户id
- `tarTenantId` (Long，query 参数): 目标租户id

响应出参：

- 返回类型: `JSONResult<Map<Long, Long>>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Map<Long, Long>`。


请求示例：

```http
POST /job/group/copyJobGroup?appCode=sample&moduleCode=sample&newModuleCode=sample&tenantId=1&tarTenantId=1&relationShips=sample HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": {
    "sampleKey": "sampleValue"
  }
}
```

### POST /job/group/startSchJobGroup

接口描述：

调度任务组测试执行

请求入参：

- `jobGroupId` (Long，query 参数): 任务组标识

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /job/group/startSchJobGroup?jobGroupId=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /job/group/freeze

接口描述：

冻结调度任务

请求入参：

- 请求体: `JobInfoFreezeApiInput`
  - `jobIdList` (List<Long>): 任务标识
  - `jobGrpId` (Long): 任务组标识

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /job/group/freeze HTTP/1.1
Content-Type: application/json

{
  "jobIdList": [
    1
  ],
  "jobGrpId": 1
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /job/group/unfreeze

接口描述：

解冻调度任务

请求入参：

- 请求体: `JobInfoFreezeApiInput`
  - `jobIdList` (List<Long>): 任务标识
  - `jobGrpId` (Long): 任务组标识

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /job/group/unfreeze HTTP/1.1
Content-Type: application/json

{
  "jobIdList": [
    1
  ],
  "jobGrpId": 1
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /job/group/skip

接口描述：

跳过调度任务

请求入参：

- `jobGroupId` (Long，query 参数): 任务组标识
- `jobId` (Long，query 参数): 任务标识

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /job/group/skip?jobGroupId=1&jobId=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /job/group/deleteJobGroupByAppCodeAndModuleCode

接口描述：

删除指定应用模块下的任务组

请求入参：

- `appCode` (String，query 参数): 应用编码
- `moduleCode` (String，query 参数): 模块编码

响应出参：

- 返回类型: `JSONResult<String>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `String`。


请求示例：

```http
POST /job/group/deleteJobGroupByAppCodeAndModuleCode?appCode=sample&moduleCode=sample HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": "sample"
}
```

### POST /job/group/batchStartJobGroupByAppCodeAndModuleCode

接口描述：

批量启用应用模块下的任务组

请求入参：

- `appCode` (String，query 参数): 见接口定义
- `moduleCode` (String，query 参数): 见接口定义

响应出参：

- 返回类型: `JSONResult<String>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `String`。


请求示例：

```http
POST /job/group/batchStartJobGroupByAppCodeAndModuleCode?appCode=sample&moduleCode=sample HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": "sample"
}
```

### POST /job/group/batchStopJobGroupByAppCodeAndModuleCode

接口描述：

批量停用应用模块下的任务组

请求入参：

- `appCode` (String，query 参数): 见接口定义
- `moduleCode` (String，query 参数): 见接口定义

响应出参：

- 返回类型: `JSONResult<String>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `String`。


请求示例：

```http
POST /job/group/batchStopJobGroupByAppCodeAndModuleCode?appCode=sample&moduleCode=sample HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": "sample"
}
```

### POST /job/group/getJobGroupListByGroupBusinessType

接口描述：

根据任务组业务类型查询调度任务组列表

请求入参：

- 请求体: `JobGroupBizTypeQueryApiInput`
  - `appCode` (String): 应用编码
  - `moduleCode` (String): 模块编码
  - `groupBusinessType` (String): 任务组业务类型
  - `tenantId` (Long): 租户id

响应出参：

- 返回类型: `JSONResult<List<JobGroupApiVO>>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `List<JobGroupApiVO>`。


请求示例：

```http
POST /job/group/getJobGroupListByGroupBusinessType HTTP/1.1
Content-Type: application/json

{
  "appCode": "sample",
  "moduleCode": "sample",
  "groupBusinessType": "sample",
  "tenantId": 1
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": [
    {
      "jobGrpId": 1,
      "jobGrpName": "sample",
      "jobGrpDescribe": "sample",
      "tenantId": 1,
      "creator": 1,
      "modifier": 1,
      "createTm": "2026-04-03 12:00:00",
      "modifyTm": "2026-04-03 12:00:00",
      "ifDelete": "sample",
      "ifPreset": "sample",
      "appCode": "sample",
      "moduleCode": "sample",
      "groupBusinessType": "sample"
    }
  ]
}
```

### POST /job/group/getJobGroupRelaListByGroupBusinessType

接口描述：

根据任务组业务类型查询调度任务组关联关系列表

请求入参：

- 请求体: `JobGroupBizTypeQueryApiInput`
  - `appCode` (String): 应用编码
  - `moduleCode` (String): 模块编码
  - `groupBusinessType` (String): 任务组业务类型
  - `tenantId` (Long): 租户id

响应出参：

- 返回类型: `JSONResult<List<JobGroupRelaApiVO>>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `List<JobGroupRelaApiVO>`。


请求示例：

```http
POST /job/group/getJobGroupRelaListByGroupBusinessType HTTP/1.1
Content-Type: application/json

{
  "appCode": "sample",
  "moduleCode": "sample",
  "groupBusinessType": "sample",
  "tenantId": 1
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": [
    {
      "jobGrpRelaId": 1,
      "jobGrpId": 1,
      "jobId": 1,
      "jobGrpRelaFileId": 1,
      "tenantId": 1,
      "creator": 1,
      "modifier": 1,
      "createTm": "2026-04-03 12:00:00",
      "modifyTm": "2026-04-03 12:00:00",
      "ifDelete": "sample"
    }
  ]
}
```


## 调度任务

### POST /job/pageJobInfo

接口描述：

调度任务分页查询

请求入参：

- 请求体: `JobInfoQueryApiInput`
  - `pageNum` (long): 分页页码
  - `pageSize` (long): 分页大小
  - `keyword` (String): 关键字搜索:任务id、任务名称、任务编码
  - `appCode` (String): 应用编码
  - `moduleCode` (String): 模块编码
  - `tenantId` (Long): 租户id

响应出参：

- 返回类型: `PageResult<JobInfoApiVO>`
- 顶层字段: `pageNum`、`pageSize`、`total`、`dataList`。
- `dataList`: `JobInfoApiVO` 列表。
  - `jobId` (Long): 任务标识
  - `jobName` (String): 任务名称
  - `jobCode` (String): 任务编码
  - `jobCron` (String): 任务执行corn
  - `jobDescribe` (String): 任务描述
  - `jobParam` (Object): 任务参数
  - `alarmEmail` (String): 报警邮箱
  - `requestUrl` (String): 请求url
  - `jobType` (String): 任务类型:GENERAL,SCHEDULED
  - `requestType` (String): 回调类型:GET,POST,SERVICE
  - `requestCorrectMark` (String): 请求正确标志
  - `jobTag` (String): 任务标签
  - `tenantId` (Long): 租户标识
  - `creator` (Long): 记录创建人
  - `modifier` (Long): 记录修改人
  - `createTm` (LocalDateTime): 记录创建时间
  - `modifyTm` (LocalDateTime): 记录修改时间
  - `ifDelete` (String): 是否删除
  - `appCode` (String): 应用编码
  - `moduleCode` (String): 模块编码
  - `jobBusinessType` (String): 任务业务类型


请求示例：

```http
POST /job/pageJobInfo HTTP/1.1
Content-Type: application/json

{
  "pageNum": 1,
  "pageSize": 1,
  "keyword": "sample",
  "appCode": "sample",
  "moduleCode": "sample",
  "tenantId": 1
}
```

响应示例：

```json
{
  "pageNum": 1,
  "pageSize": 10,
  "total": 1,
  "dataList": [
    {
      "jobId": 1,
      "jobName": "sample",
      "jobCode": "sample",
      "jobCron": "sample",
      "jobDescribe": "sample",
      "jobParam": "sample",
      "alarmEmail": "sample",
      "requestUrl": "sample",
      "jobType": "sample",
      "requestType": "sample",
      "requestCorrectMark": "sample",
      "jobTag": "sample",
      "tenantId": 1,
      "creator": 1,
      "modifier": 1,
      "createTm": "2026-04-03 12:00:00",
      "modifyTm": "2026-04-03 12:00:00",
      "ifDelete": "sample",
      "appCode": "sample",
      "moduleCode": "sample",
      "jobBusinessType": "sample"
    }
  ]
}
```

### GET /job/getInfoById

接口描述：

通过id查询任务详情

请求入参：

- `jobId` (Long，query 参数): 任务标识

响应出参：

- 返回类型: `JSONResult<JobInfoApiVO>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `JobInfoApiVO`。
  - `jobId` (Long): 任务标识
  - `jobName` (String): 任务名称
  - `jobCode` (String): 任务编码
  - `jobCron` (String): 任务执行corn
  - `jobDescribe` (String): 任务描述
  - `jobParam` (Object): 任务参数
  - `alarmEmail` (String): 报警邮箱
  - `requestUrl` (String): 请求url
  - `jobType` (String): 任务类型:GENERAL,SCHEDULED
  - `requestType` (String): 回调类型:GET,POST,SERVICE
  - `requestCorrectMark` (String): 请求正确标志
  - `jobTag` (String): 任务标签
  - `tenantId` (Long): 租户标识
  - `creator` (Long): 记录创建人
  - `modifier` (Long): 记录修改人
  - `createTm` (LocalDateTime): 记录创建时间
  - `modifyTm` (LocalDateTime): 记录修改时间
  - `ifDelete` (String): 是否删除
  - `appCode` (String): 应用编码
  - `moduleCode` (String): 模块编码
  - `jobBusinessType` (String): 任务业务类型


请求示例：

```http
GET /job/getInfoById?jobId=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": {
    "jobId": 1,
    "jobName": "sample",
    "jobCode": "sample",
    "jobCron": "sample",
    "jobDescribe": "sample",
    "jobParam": "sample",
    "alarmEmail": "sample",
    "requestUrl": "sample",
    "jobType": "sample",
    "requestType": "sample",
    "requestCorrectMark": "sample",
    "jobTag": "sample",
    "tenantId": 1,
    "creator": 1,
    "modifier": 1,
    "createTm": "2026-04-03 12:00:00",
    "modifyTm": "2026-04-03 12:00:00",
    "ifDelete": "sample",
    "appCode": "sample",
    "moduleCode": "sample",
    "jobBusinessType": "sample"
  }
}
```

### POST /job/add

接口描述：

任务新增

请求入参：

- 请求体: `JobInfoApiInput`
  - `jobId` (Long): 任务标识
  - `jobName` (String): 任务名称
  - `jobCode` (String): 任务编码
  - `jobCron` (String): 任务执行corn
  - `jobDescribe` (String): 任务描述
  - `jobParam` (String): 任务参数
  - `alarmEmail` (String): 报警邮箱
  - `requestUrl` (String): 请求url
  - `requestType` (String): 回调类型:GET,POST,SERVICE
  - `jobType` (String): 任务类型:GENERAL,SCHEDULED
  - `requestCorrectMark` (String): 请求正确标志
  - `jobTag` (String): 任务标签
  - `appCode` (String): 应用编码
  - `moduleCode` (String): 模块编码
  - `jobBusinessType` (String): 任务业务类型

响应出参：

- 返回类型: `JSONResult<Long>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Long`。


请求示例：

```http
POST /job/add HTTP/1.1
Content-Type: application/json

{
  "jobId": 1,
  "jobName": "sample",
  "jobCode": "sample",
  "jobCron": "sample",
  "jobDescribe": "sample",
  "jobParam": "sample",
  "alarmEmail": "sample",
  "requestUrl": "sample",
  "requestType": "sample",
  "jobType": "sample",
  "requestCorrectMark": "sample",
  "jobTag": "sample",
  "appCode": "sample",
  "moduleCode": "sample",
  "jobBusinessType": "sample"
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": 1
}
```

### POST /job/edit

接口描述：

更新调度任务

请求入参：

- 请求体: `JobInfoApiInput`
  - `jobId` (Long): 任务标识
  - `jobName` (String): 任务名称
  - `jobCode` (String): 任务编码
  - `jobCron` (String): 任务执行corn
  - `jobDescribe` (String): 任务描述
  - `jobParam` (String): 任务参数
  - `alarmEmail` (String): 报警邮箱
  - `requestUrl` (String): 请求url
  - `requestType` (String): 回调类型:GET,POST,SERVICE
  - `jobType` (String): 任务类型:GENERAL,SCHEDULED
  - `requestCorrectMark` (String): 请求正确标志
  - `jobTag` (String): 任务标签
  - `appCode` (String): 应用编码
  - `moduleCode` (String): 模块编码
  - `jobBusinessType` (String): 任务业务类型

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /job/edit HTTP/1.1
Content-Type: application/json

{
  "jobId": 1,
  "jobName": "sample",
  "jobCode": "sample",
  "jobCron": "sample",
  "jobDescribe": "sample",
  "jobParam": "sample",
  "alarmEmail": "sample",
  "requestUrl": "sample",
  "requestType": "sample",
  "jobType": "sample",
  "requestCorrectMark": "sample",
  "jobTag": "sample",
  "appCode": "sample",
  "moduleCode": "sample",
  "jobBusinessType": "sample"
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /job/delete

接口描述：

删除调度任务

请求入参：

- `jobId` (Long，query 参数): 任务标识
- `jobGrpId` (Long，query 参数): 见接口定义

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /job/delete?jobId=1&jobGrpId=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /job/pause

接口描述：

暂停调度任务

请求入参：

- `jobId` (Long，query 参数): 任务标识
- `jobGrpId` (Long，query 参数): 任务组标识

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /job/pause?jobId=1&jobGrpId=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /job/resume

接口描述：

恢复调度任务

请求入参：

- `jobId` (Long，query 参数): 任务标识
- `jobGrpId` (Long，query 参数): 任务组标识

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /job/resume?jobId=1&jobGrpId=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /job/api/start

接口描述：

api接口启用调度任务

请求入参：

- `grpId` (Long，query 参数): 任务组标识
- `jobId` (Long，query 参数): 任务标识

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /job/api/start?grpId=1&jobId=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### GET /job/assign/level/list

接口描述：

查询指定层级任务列表

请求入参：

- `jobId` (Long，query 参数): 任务标识
- `grpId` (Long，query 参数): 任务组标识
- `level` (Integer，query 参数): 层级
- `isUp` (Boolean，query 参数): true:查询上游任务列表,false:查询下游任务列表

响应出参：

- 返回类型: `JSONResult<JobAssignLevelRelationApiVO>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `JobAssignLevelRelationApiVO`。
  - `jobInfoApiVOList` (List<JobInfoApiVO>): 任务集合
  - `jobRelationInfo` (String): 任务依赖关系


请求示例：

```http
GET /job/assign/level/list?jobId=1&grpId=1&level=1&isUp=True HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": {
    "jobInfoApiVOList": [
      {}
    ],
    "jobRelationInfo": "sample"
  }
}
```

### POST /job/getJobListByJobBusinessType

接口描述：

根据任务业务类型查询调度任务列表

请求入参：

- 请求体: `JobInfoBizTypeQueryApiInput`
  - `appCode` (String): 应用编码
  - `moduleCode` (String): 模块编码
  - `jobBusinessType` (String): 任务业务类型
  - `tenantId` (Long): 租户id

响应出参：

- 返回类型: `JSONResult<List<JobInfoApiVO>>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `List<JobInfoApiVO>`。


请求示例：

```http
POST /job/getJobListByJobBusinessType HTTP/1.1
Content-Type: application/json

{
  "appCode": "sample",
  "moduleCode": "sample",
  "jobBusinessType": "sample",
  "tenantId": 1
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": [
    {
      "jobId": 1,
      "jobName": "sample",
      "jobCode": "sample",
      "jobCron": "sample",
      "jobDescribe": "sample",
      "jobParam": "sample",
      "alarmEmail": "sample",
      "requestUrl": "sample",
      "jobType": "sample",
      "requestType": "sample",
      "requestCorrectMark": "sample",
      "jobTag": "sample",
      "tenantId": 1,
      "creator": 1,
      "modifier": 1,
      "createTm": "2026-04-03 12:00:00",
      "modifyTm": "2026-04-03 12:00:00",
      "ifDelete": "sample",
      "appCode": "sample",
      "moduleCode": "sample",
      "jobBusinessType": "sample"
    }
  ]
}
```

### POST /job/getJobRelaListByJobBusinessType

接口描述：

根据任务业务类型查询调度任务关联关系列表

请求入参：

- 请求体: `JobInfoBizTypeQueryApiInput`
  - `appCode` (String): 应用编码
  - `moduleCode` (String): 模块编码
  - `jobBusinessType` (String): 任务业务类型
  - `tenantId` (Long): 租户id

响应出参：

- 返回类型: `JSONResult<List<JobRelaApiVO>>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `List<JobRelaApiVO>`。


请求示例：

```http
POST /job/getJobRelaListByJobBusinessType HTTP/1.1
Content-Type: application/json

{
  "appCode": "sample",
  "moduleCode": "sample",
  "jobBusinessType": "sample",
  "tenantId": 1
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": [
    {
      "jobRelaId": 1,
      "jobId": 1,
      "preJobId": 1,
      "jobRelaFileId": 1,
      "jobGrpId": 1,
      "tenantId": 1,
      "creator": 1,
      "modifier": 1,
      "createTm": "2026-04-03 12:00:00",
      "modifyTm": "2026-04-03 12:00:00",
      "ifDelete": "sample"
    }
  ]
}
```


## 调度任务实例

### POST /job/group/pageJobGroupInstance

接口描述：

调度任务组实例分页查询

请求入参：

- 请求体: `JobGroupInstanceQueryInput`
  - `jobGroupId` (Long): 任务组标识
  - `pageNum` (Integer): 页码
  - `pageSize` (Integer): 每页条数

响应出参：

- 返回类型: `PageResult<JobGroupInstanceVO>`
- 顶层字段: `pageNum`、`pageSize`、`total`、`dataList`。
- `dataList`: `JobGroupInstanceVO` 列表。


请求示例：

```http
POST /job/group/pageJobGroupInstance HTTP/1.1
Content-Type: application/json

{
  "jobGroupId": 1,
  "pageNum": 1,
  "pageSize": 10
}
```

响应示例：

```json
{
  "pageNum": 1,
  "pageSize": 10,
  "total": 1,
  "dataList": [
    {
      "jobGroupInstanceId": 1
    }
  ]
}
```

### POST /job/pageJobInstance

接口描述：

调度任务实例分页查询

请求入参：

- 请求体: `JobInstanceQueryInput`
  - `jobId` (Long): 任务标识
  - `pageNum` (Integer): 页码
  - `pageSize` (Integer): 每页条数

响应出参：

- 返回类型: `PageResult<JobInstanceVO>`
- 顶层字段: `pageNum`、`pageSize`、`total`、`dataList`。
- `dataList`: `JobInstanceVO` 列表。


请求示例：

```http
POST /job/pageJobInstance HTTP/1.1
Content-Type: application/json

{
  "jobId": 1,
  "pageNum": 1,
  "pageSize": 10
}
```

响应示例：

```json
{
  "pageNum": 1,
  "pageSize": 10,
  "total": 1,
  "dataList": [
    {
      "jobInstanceId": 1
    }
  ]
}
```

### POST /job/updateMinioUrl

接口描述：

接口说明见代码注释。

请求入参：

- 请求体: `JobInstanceMinioApiInput`
  - `jobInstanceId` (Long): 任务实例ID
  - `minioUrl` (String): minioUrl

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /job/updateMinioUrl HTTP/1.1
Content-Type: application/json

{
  "jobInstanceId": 1,
  "minioUrl": "sample"
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```


## Flink SQL 同步

### POST /flinksql/job/create

接口描述：

接口说明见代码注释。

请求入参：

- 请求体: `SyncFsJobConfigInput`
  - `serialVersionUID` (static final long): 见示例
  - `jobId` (Long): 见示例
  - `jobName` (String): 见示例
  - `jobSql` (String): 见示例
  - `appCode` (String): 见示例
  - `tenantId` (Long): 见示例
  - `creator` (Long): 见示例
  - `modifier` (Long): 见示例

响应出参：

- 返回类型: `JSONResult<Long>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Long`。


请求示例：

```http
POST /flinksql/job/create HTTP/1.1
Content-Type: application/json

{
  "jobId": 1,
  "jobName": "sample",
  "jobSql": "sample",
  "appCode": "sample",
  "tenantId": 1,
  "creator": 1,
  "modifier": 1
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": 1
}
```

### POST /flinksql/job/update

接口描述：

接口说明见代码注释。

请求入参：

- 请求体: `SyncFsJobConfigInput`
  - `serialVersionUID` (static final long): 见示例
  - `jobId` (Long): 见示例
  - `jobName` (String): 见示例
  - `jobSql` (String): 见示例
  - `appCode` (String): 见示例
  - `tenantId` (Long): 见示例
  - `creator` (Long): 见示例
  - `modifier` (Long): 见示例

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /flinksql/job/update HTTP/1.1
Content-Type: application/json

{
  "jobId": 1,
  "jobName": "sample",
  "jobSql": "sample",
  "appCode": "sample",
  "tenantId": 1,
  "creator": 1,
  "modifier": 1
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /flinksql/job/upload

接口描述：

接口说明见代码注释。

请求入参：

- 请求体: `Long`

响应出参：

- 返回类型: `JSONResult<String>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `String`。


请求示例：

```http
POST /flinksql/job/upload HTTP/1.1
Content-Type: application/json

1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": "sample"
}
```

### POST /flinksql/job/start

接口描述：

接口说明见代码注释。

请求入参：

- 请求体: `Long`

响应出参：

- 返回类型: `JSONResult<String>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `String`。


请求示例：

```http
POST /flinksql/job/start HTTP/1.1
Content-Type: application/json

1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": "sample"
}
```

### POST /flinksql/job/restart

接口描述：

接口说明见代码注释。

请求入参：

- 请求体: `Long`

响应出参：

- 返回类型: `JSONResult<String>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `String`。


请求示例：

```http
POST /flinksql/job/restart HTTP/1.1
Content-Type: application/json

1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": "sample"
}
```

### POST /flinksql/job/stop

接口描述：

接口说明见代码注释。

请求入参：

- `jobId` (Long，query 参数): 见接口定义

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /flinksql/job/stop?jobId=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /flinksql/job/delete

接口描述：

接口说明见代码注释。

请求入参：

- 请求体: `Long`

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /flinksql/job/delete HTTP/1.1
Content-Type: application/json

1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /flinksql/job/status

接口描述：

接口说明见代码注释。

请求入参：

- 请求体: `Long`

响应出参：

- 返回类型: `JSONResult<String>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `String`。


请求示例：

```http
POST /flinksql/job/status HTTP/1.1
Content-Type: application/json

1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": "sample"
}
```

### POST /flinksql/job/listStatus

接口描述：

接口说明见代码注释。

请求入参：

- 请求体: `List<Long>`

响应出参：

- 返回类型: `JSONResult<List<FlinkJobStatusVO>>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `List<FlinkJobStatusVO>`。


请求示例：

```http
POST /flinksql/job/listStatus HTTP/1.1
Content-Type: application/json

[
  1
]
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": [
    {
      "jobId": 1,
      "jobFlinkId": "sample",
      "jobStatus": "sample"
    }
  ]
}
```


## 同步作业

### POST /syncJob/pageSyncJob

接口描述：

同步作业分页查询

请求入参：

- 请求体: `SyncJobQueryInput`
  - `sourceDataTypes` (List<String>): 源数据库引擎
  - `targetDataTypes` (List<String>): 目标数据库引擎
  - `appCode` (String): 系统编码
  - `moduleCode` (String): 模块编码
  - `keyword` (String): 关键字搜索
  - `executeStatus` (String): 执行状态
  - `pageNum` (Integer): 起始页号
  - `pageSize` (Integer): 每页条数

响应出参：

- 返回类型: `PageResult<SyncJobVO>`
- 顶层字段: `pageNum`、`pageSize`、`total`、`dataList`。
- `dataList`: `SyncJobVO` 列表。
  - `serialVersionUID` (static final long): 见示例
  - `syncJobId` (Long): 作业标识
  - `syncJobFileId` (Long): 作业文件标识
  - `syncJobName` (String): 作业名称
  - `targetSchema` (String): 目标schema
  - `targetDb` (String): 目标数据库
  - `sourceSchema` (String): 源schema
  - `sourceDb` (String): 源数据库
  - `sourceDataSourceId` (Long): 源数据源标识
  - `sourceDataSourceName` (String): 源数据源名称
  - `sourceDbType` (String): 源数据库引擎
  - `targetTableName` (String): 目标表名
  - `targetTableCnName` (String): 目标表中文名
  - `sourceTableName` (String): 源表名
  - `sourceTableCnName` (String): 源表中文名
  - `targetDataSourceId` (Long): 目标数据源标识
  - `targetDataSourceName` (String): 目标数据源名称
  - `targetDbType` (String): 目标数据库引擎
  - `executeStatus` (String): 执行状态
  - `appCode` (String): 系统编码
  - `moduleCode` (String): 模块编码
  - `tenantId` (Long): 租户标识
  - `creator` (Long): 记录创建人标识
  - `createUserName` (String): 记录创建人
  - `modifier` (Long): 记录修改人
  - `createTm` (LocalDateTime): 记录创建时间
  - `modifyTm` (LocalDateTime): 记录修改时间


请求示例：

```http
POST /syncJob/pageSyncJob HTTP/1.1
Content-Type: application/json

{
  "sourceDataTypes": [
    "sample"
  ],
  "targetDataTypes": [
    "sample"
  ],
  "appCode": "sample",
  "moduleCode": "sample",
  "keyword": "sample",
  "executeStatus": "sample",
  "pageNum": 1,
  "pageSize": 1
}
```

响应示例：

```json
{
  "pageNum": 1,
  "pageSize": 10,
  "total": 1,
  "dataList": [
    {
      "syncJobId": 1,
      "syncJobFileId": 1,
      "syncJobName": "sample",
      "targetSchema": "sample",
      "targetDb": "sample",
      "sourceSchema": "sample",
      "sourceDb": "sample",
      "sourceDataSourceId": 1,
      "sourceDataSourceName": "sample",
      "sourceDbType": "sample",
      "targetTableName": "sample",
      "targetTableCnName": "sample",
      "sourceTableName": "sample",
      "sourceTableCnName": "sample",
      "targetDataSourceId": 1,
      "targetDataSourceName": "sample",
      "targetDbType": "sample",
      "executeStatus": "sample",
      "appCode": "sample",
      "moduleCode": "sample",
      "tenantId": 1,
      "creator": 1,
      "createUserName": "sample",
      "modifier": 1,
      "createTm": "2026-04-03 12:00:00",
      "modifyTm": "2026-04-03 12:00:00"
    }
  ]
}
```

### POST /syncJob/pageSyncJobHistory

接口描述：

同步作业历史分页查询

请求入参：

- 请求体: `SyncJobHistoryQueryInput`
  - `keyword` (String): 关键字搜索
  - `syncJobFileId` (Long): 同步作业文件标识
  - `pageNum` (Integer): 起始页号
  - `pageSize` (Integer): 每页条数

响应出参：

- 返回类型: `PageResult<SyncJobHistoryVO>`
- 顶层字段: `pageNum`、`pageSize`、`total`、`dataList`。
- `dataList`: `SyncJobHistoryVO` 列表。
  - `syncJobId` (Long): 作业标识
  - `syncJobFileId` (Long): 作业文件标识
  - `syncJobName` (String): 作业名称
  - `syncJobStatus` (String): 状态
  - `instanceNum` (Integer): 实例数
  - `creator` (Long): 发起人
  - `createUserName` (Long): 发起人


请求示例：

```http
POST /syncJob/pageSyncJobHistory HTTP/1.1
Content-Type: application/json

{
  "keyword": "sample",
  "syncJobFileId": 1,
  "pageNum": 1,
  "pageSize": 1
}
```

响应示例：

```json
{
  "pageNum": 1,
  "pageSize": 10,
  "total": 1,
  "dataList": [
    {
      "syncJobId": 1,
      "syncJobFileId": 1,
      "syncJobName": "sample",
      "syncJobStatus": "sample",
      "instanceNum": 1,
      "creator": 1,
      "createUserName": 1
    }
  ]
}
```

### POST /syncJob/getSyncJob

接口描述：

查询同步作业信息

请求入参：

- 无请求体，参数见请求 URL。

响应出参：

- 返回类型: `JSONResult<SyncJobVO>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `SyncJobVO`。
  - `serialVersionUID` (static final long): 见示例
  - `syncJobId` (Long): 作业标识
  - `syncJobFileId` (Long): 作业文件标识
  - `syncJobName` (String): 作业名称
  - `targetSchema` (String): 目标schema
  - `targetDb` (String): 目标数据库
  - `sourceSchema` (String): 源schema
  - `sourceDb` (String): 源数据库
  - `sourceDataSourceId` (Long): 源数据源标识
  - `sourceDataSourceName` (String): 源数据源名称
  - `sourceDbType` (String): 源数据库引擎
  - `targetTableName` (String): 目标表名
  - `targetTableCnName` (String): 目标表中文名
  - `sourceTableName` (String): 源表名
  - `sourceTableCnName` (String): 源表中文名
  - `targetDataSourceId` (Long): 目标数据源标识
  - `targetDataSourceName` (String): 目标数据源名称
  - `targetDbType` (String): 目标数据库引擎
  - `executeStatus` (String): 执行状态
  - `appCode` (String): 系统编码
  - `moduleCode` (String): 模块编码
  - `tenantId` (Long): 租户标识
  - `creator` (Long): 记录创建人标识
  - `createUserName` (String): 记录创建人
  - `modifier` (Long): 记录修改人
  - `createTm` (LocalDateTime): 记录创建时间
  - `modifyTm` (LocalDateTime): 记录修改时间


请求示例：

```http
POST /syncJob/getSyncJob?syncJobFileId=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": {
    "syncJobId": 1,
    "syncJobFileId": 1,
    "syncJobName": "sample",
    "targetSchema": "sample",
    "targetDb": "sample",
    "sourceSchema": "sample",
    "sourceDb": "sample",
    "sourceDataSourceId": 1,
    "sourceDataSourceName": "sample",
    "sourceDbType": "sample",
    "targetTableName": "sample",
    "targetTableCnName": "sample",
    "sourceTableName": "sample",
    "sourceTableCnName": "sample",
    "targetDataSourceId": 1,
    "targetDataSourceName": "sample",
    "targetDbType": "sample",
    "executeStatus": "sample",
    "appCode": "sample",
    "moduleCode": "sample",
    "tenantId": 1,
    "creator": 1,
    "createUserName": "sample",
    "modifier": 1,
    "createTm": "2026-04-03 12:00:00",
    "modifyTm": "2026-04-03 12:00:00"
  }
}
```

### POST /syncJob/prepareSyncJobDetail

接口描述：

新建同步作业时指定表的初始数据

请求入参：

- 请求体: `SyncJobDetailPrepareInput`

响应出参：

- 返回类型: `JSONResult<SyncJobDetailVO>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `SyncJobDetailVO`。


请求示例：

```http
POST /syncJob/prepareSyncJobDetail HTTP/1.1
Content-Type: application/json

{
  "sourceDataSourceId": 1,
  "sourceDbType": "sample",
  "targetDbType": "sample",
  "database": "sample",
  "schema": "sample",
  "table": "sample",
  "syncAll": true
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": {
    "syncJobId": 1,
    "syncConfigVo": {
      "syncConfigId": 1,
      "syncConfigFileId": 1,
      "syncJobFileId": 1,
      "targetTableCompressType": "sample",
      "targetTableCompressLevel": 1,
      "targetTableStoreMode": "sample",
      "targetTablePartitionCycle": "sample",
      "channelCnt": 1,
      "fetchSize": 1,
      "batchSize": 1,
      "errorRecordLimit": 1,
      "errorRatioLimit": 0.1,
      "splitPk": "sample",
      "conditionSql": "sample",
      "querySql": "sample",
      "preSql": "sample",
      "postSql": "sample",
      "tenantId": 1,
      "creator": 1,
      "modifier": 1,
      "createTm": "2026-04-03 12:00:00",
      "modifyTm": "2026-04-03 12:00:00",
      "ifDelete": "sample"
    },
    "syncColumnMappingVos": [
      {}
    ],
    "syncColumnMappingRelaVos": [
      {}
    ],
    "syncDbConfigVos": [
      {}
    ]
  }
}
```

### POST /syncJob/editSyncJob

接口描述：

编辑同步作业详细信息

请求入参：

- 无请求体，参数见请求 URL。

响应出参：

- 返回类型: `JSONResult<SyncJobEditVO>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `SyncJobEditVO`。


请求示例：

```http
POST /syncJob/editSyncJob?syncJobFileId=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": {
    "syncJobVo": {
      "syncJobId": 1,
      "syncJobFileId": 1,
      "syncJobName": "sample",
      "targetSchema": "sample",
      "targetDb": "sample",
      "sourceSchema": "sample",
      "sourceDb": "sample",
      "sourceDataSourceId": 1,
      "sourceDataSourceName": "sample",
      "sourceDbType": "sample",
      "targetTableName": "sample",
      "targetTableCnName": "sample",
      "sourceTableName": "sample",
      "sourceTableCnName": "sample",
      "targetDataSourceId": 1,
      "targetDataSourceName": "sample",
      "targetDbType": "sample",
      "executeStatus": "sample",
      "appCode": "sample",
      "moduleCode": "sample",
      "tenantId": 1,
      "creator": 1,
      "createUserName": "sample",
      "modifier": 1,
      "createTm": "2026-04-03 12:00:00",
      "modifyTm": "2026-04-03 12:00:00"
    },
    "syncJobDetailVo": {
      "syncJobId": 1,
      "syncConfigVo": {},
      "syncColumnMappingVos": [
        {}
      ],
      "syncColumnMappingRelaVos": [
        {}
      ],
      "syncDbConfigVos": [
        {}
      ]
    }
  }
}
```

### POST /syncJob/getSyncJobById

接口描述：

根据同步作业标识查询同步作业详细信息

请求入参：

- 无请求体，参数见请求 URL。

响应出参：

- 返回类型: `JSONResult<SyncJobEditVO>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `SyncJobEditVO`。


请求示例：

```http
POST /syncJob/getSyncJobById?syncJobId=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": {
    "syncJobVo": {
      "syncJobId": 1,
      "syncJobFileId": 1,
      "syncJobName": "sample",
      "targetSchema": "sample",
      "targetDb": "sample",
      "sourceSchema": "sample",
      "sourceDb": "sample",
      "sourceDataSourceId": 1,
      "sourceDataSourceName": "sample",
      "sourceDbType": "sample",
      "targetTableName": "sample",
      "targetTableCnName": "sample",
      "sourceTableName": "sample",
      "sourceTableCnName": "sample",
      "targetDataSourceId": 1,
      "targetDataSourceName": "sample",
      "targetDbType": "sample",
      "executeStatus": "sample",
      "appCode": "sample",
      "moduleCode": "sample",
      "tenantId": 1,
      "creator": 1,
      "createUserName": "sample",
      "modifier": 1,
      "createTm": "2026-04-03 12:00:00",
      "modifyTm": "2026-04-03 12:00:00"
    },
    "syncJobDetailVo": {
      "syncJobId": 1,
      "syncConfigVo": {},
      "syncColumnMappingVos": [
        {}
      ],
      "syncColumnMappingRelaVos": [
        {}
      ],
      "syncDbConfigVos": [
        {}
      ]
    }
  }
}
```

### POST /syncJob/viewSyncJob

接口描述：

查询同步作业详细信息

请求入参：

- 无请求体，参数见请求 URL。

响应出参：

- 返回类型: `JSONResult<SyncJobEditVO>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `SyncJobEditVO`。


请求示例：

```http
POST /syncJob/viewSyncJob?syncJobFileId=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": {
    "syncJobVo": {
      "syncJobId": 1,
      "syncJobFileId": 1,
      "syncJobName": "sample",
      "targetSchema": "sample",
      "targetDb": "sample",
      "sourceSchema": "sample",
      "sourceDb": "sample",
      "sourceDataSourceId": 1,
      "sourceDataSourceName": "sample",
      "sourceDbType": "sample",
      "targetTableName": "sample",
      "targetTableCnName": "sample",
      "sourceTableName": "sample",
      "sourceTableCnName": "sample",
      "targetDataSourceId": 1,
      "targetDataSourceName": "sample",
      "targetDbType": "sample",
      "executeStatus": "sample",
      "appCode": "sample",
      "moduleCode": "sample",
      "tenantId": 1,
      "creator": 1,
      "createUserName": "sample",
      "modifier": 1,
      "createTm": "2026-04-03 12:00:00",
      "modifyTm": "2026-04-03 12:00:00"
    },
    "syncJobDetailVo": {
      "syncJobId": 1,
      "syncConfigVo": {},
      "syncColumnMappingVos": [
        {}
      ],
      "syncColumnMappingRelaVos": [
        {}
      ],
      "syncDbConfigVos": [
        {}
      ]
    }
  }
}
```

### POST /syncJob/insertSyncJobs

接口描述：

新增同步作业

请求入参：

- 请求体: `SyncJobInsertInput`
  - `sourceDataSourceId` (Long): 源数据源标识
  - `targetDataSourceId` (Long): 目标数据源标识
  - `appCode` (String): 系统编码
  - `moduleCode` (String): 模块编码
  - `syncJobName` (String): 同步作业名称
  - `sourceDb` (String): 源数据库
  - `targetDb` (String): 目标数据库
  - `sourceSchema` (String): 源schema
  - `targetSchema` (String): 目标schema
  - `sourceTableNames` (List<SyncTableInput>): 源表
  - `targetTableNames` (List<SyncTableInput>): 目标表
  - `syncJobDetailInputs` (List<SyncJobDetailInput>): 作业明细集合

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /syncJob/insertSyncJobs HTTP/1.1
Content-Type: application/json

{
  "sourceDataSourceId": 1,
  "targetDataSourceId": 1,
  "appCode": "sample",
  "moduleCode": "sample",
  "syncJobName": "sample",
  "sourceDb": "sample",
  "targetDb": "sample",
  "sourceSchema": "sample",
  "targetSchema": "sample",
  "sourceTableNames": [
    {}
  ],
  "syncAll": true,
  "targetTableNames": [
    {}
  ],
  "syncJobDetailInputs": [
    {}
  ]
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /syncJob/updateSyncJob

接口描述：

修改同步作业

请求入参：

- 请求体: `SyncJobUpdateInput`
  - `syncJobId` (Long): 同步作业标识
  - `syncJobFileId` (Long): 同步作业文件标识
  - `sourceDataSourceId` (Long): 源数据源标识
  - `targetDataSourceId` (Long): 目标数据源标识
  - `appCode` (String): 系统编码
  - `moduleCode` (String): 模块编码
  - `syncJobName` (String): 同步作业名称
  - `sourceDb` (String): 源数据库
  - `targetDb` (String): 目标数据库
  - `sourceSchema` (String): 源schema
  - `targetSchema` (String): 目标schema
  - `sourceTableName` (String): 源表名
  - `sourceTableCnName` (String): 源表中文名
  - `targetTableName` (String): 目标表名
  - `targetTableCnName` (String): 目标表中文名
  - `syncJobDetailInput` (SyncJobDetailInput): 作业明细

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /syncJob/updateSyncJob HTTP/1.1
Content-Type: application/json

{
  "syncJobId": 1,
  "syncJobFileId": 1,
  "sourceDataSourceId": 1,
  "targetDataSourceId": 1,
  "appCode": "sample",
  "moduleCode": "sample",
  "syncJobName": "sample",
  "sourceDb": "sample",
  "targetDb": "sample",
  "sourceSchema": "sample",
  "targetSchema": "sample",
  "sourceTableName": "sample",
  "sourceTableCnName": "sample",
  "targetTableName": "sample",
  "targetTableCnName": "sample",
  "syncJobDetailInput": {
    "syncJobId": 1,
    "syncJobFileId": 1,
    "syncColumnMappingInputs": [
      {}
    ],
    "syncColumnMappingRelaInputs": [
      {}
    ],
    "syncConfigInput": {},
    "syncDbConfigInputs": [
      {}
    ]
  }
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /syncJob/deleteSyncJob

接口描述：

删除同步作业

请求入参：

- 无请求体，参数见请求 URL。

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /syncJob/deleteSyncJob?syncJobFileId=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /syncJob/deleteSyncJobs

接口描述：

批量删除同步作业

请求入参：

- 无请求体，参数见请求 URL。

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /syncJob/deleteSyncJobs?syncJobFileIds=sample HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /syncJob/getSyncJobTableDdlById

接口描述：

根据同步作业标识查询建表语句

请求入参：

- 无请求体，参数见请求 URL。

响应出参：

- 返回类型: `JSONResult<String>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `String`。


请求示例：

```http
POST /syncJob/getSyncJobTableDdlById?syncJobFileId=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": "sample"
}
```

### POST /syncJob/getSyncJobTableDdlByInput

接口描述：

根据界面设置查询建表语句

请求入参：

- 请求体: `SyncJobUpdateInput`
  - `syncJobId` (Long): 同步作业标识
  - `syncJobFileId` (Long): 同步作业文件标识
  - `sourceDataSourceId` (Long): 源数据源标识
  - `targetDataSourceId` (Long): 目标数据源标识
  - `appCode` (String): 系统编码
  - `moduleCode` (String): 模块编码
  - `syncJobName` (String): 同步作业名称
  - `sourceDb` (String): 源数据库
  - `targetDb` (String): 目标数据库
  - `sourceSchema` (String): 源schema
  - `targetSchema` (String): 目标schema
  - `sourceTableName` (String): 源表名
  - `sourceTableCnName` (String): 源表中文名
  - `targetTableName` (String): 目标表名
  - `targetTableCnName` (String): 目标表中文名
  - `syncJobDetailInput` (SyncJobDetailInput): 作业明细

响应出参：

- 返回类型: `JSONResult<String>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `String`。


请求示例：

```http
POST /syncJob/getSyncJobTableDdlByInput HTTP/1.1
Content-Type: application/json

{
  "syncJobId": 1,
  "syncJobFileId": 1,
  "sourceDataSourceId": 1,
  "targetDataSourceId": 1,
  "appCode": "sample",
  "moduleCode": "sample",
  "syncJobName": "sample",
  "sourceDb": "sample",
  "targetDb": "sample",
  "sourceSchema": "sample",
  "targetSchema": "sample",
  "sourceTableName": "sample",
  "sourceTableCnName": "sample",
  "targetTableName": "sample",
  "targetTableCnName": "sample",
  "syncJobDetailInput": {
    "syncJobId": 1,
    "syncJobFileId": 1,
    "syncColumnMappingInputs": [
      {}
    ],
    "syncColumnMappingRelaInputs": [
      {}
    ],
    "syncConfigInput": {},
    "syncDbConfigInputs": [
      {}
    ]
  }
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": "sample"
}
```

### POST /syncJob/getSyncJobScriptById

接口描述：

根据同步作业标识查询同步作业脚本

请求入参：

- 无请求体，参数见请求 URL。

响应出参：

- 返回类型: `JSONResult<String>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `String`。


请求示例：

```http
POST /syncJob/getSyncJobScriptById?syncJobFileId=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": "sample"
}
```

### POST /syncJob/getSyncJobScriptByInput

接口描述：

根据界面设置查询同步作业脚本

请求入参：

- 请求体: `SyncJobUpdateInput`
  - `syncJobId` (Long): 同步作业标识
  - `syncJobFileId` (Long): 同步作业文件标识
  - `sourceDataSourceId` (Long): 源数据源标识
  - `targetDataSourceId` (Long): 目标数据源标识
  - `appCode` (String): 系统编码
  - `moduleCode` (String): 模块编码
  - `syncJobName` (String): 同步作业名称
  - `sourceDb` (String): 源数据库
  - `targetDb` (String): 目标数据库
  - `sourceSchema` (String): 源schema
  - `targetSchema` (String): 目标schema
  - `sourceTableName` (String): 源表名
  - `sourceTableCnName` (String): 源表中文名
  - `targetTableName` (String): 目标表名
  - `targetTableCnName` (String): 目标表中文名
  - `syncJobDetailInput` (SyncJobDetailInput): 作业明细

响应出参：

- 返回类型: `JSONResult<String>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `String`。


请求示例：

```http
POST /syncJob/getSyncJobScriptByInput HTTP/1.1
Content-Type: application/json

{
  "syncJobId": 1,
  "syncJobFileId": 1,
  "sourceDataSourceId": 1,
  "targetDataSourceId": 1,
  "appCode": "sample",
  "moduleCode": "sample",
  "syncJobName": "sample",
  "sourceDb": "sample",
  "targetDb": "sample",
  "sourceSchema": "sample",
  "targetSchema": "sample",
  "sourceTableName": "sample",
  "sourceTableCnName": "sample",
  "targetTableName": "sample",
  "targetTableCnName": "sample",
  "syncJobDetailInput": {
    "syncJobId": 1,
    "syncJobFileId": 1,
    "syncColumnMappingInputs": [
      {}
    ],
    "syncColumnMappingRelaInputs": [
      {}
    ],
    "syncConfigInput": {},
    "syncDbConfigInputs": [
      {}
    ]
  }
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": "sample"
}
```

### POST /syncJob/getSyncConfigWrapper

接口描述：

根据界面设置查询同步作业脚本

请求入参：

- 请求体: `SyncDataxConfigInput`
  - `fileType` (String): 支持 txt,csv,hdfs| api
  - `readerDataSourceId` (Long): reader数据源的id
  - `writerDataSourceId` (Long): writer数据源的id

响应出参：

- 返回类型: `JSONResult<SyncConfigWrapper>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `SyncConfigWrapper`。
  - `dataxConfigJson` (String): 见示例
  - `job` (Job): 见示例
  - `setting` (Setting): 见示例
  - `content` (List<Content>): 见示例
  - `reader` (ReaderWriter): 见示例
  - `writer` (ReaderWriter): 见示例
  - `speed` (Map<String, Object>): 见示例
  - `errorLimit` (Map<String, Object>): 见示例
  - `restore` (Boolean): 见示例
  - `name` (String): 见示例
  - `parameter` (Parameter): 见示例
  - `column` (List<Object>): 链接相关--公共
  - `path` (List<String>): 文件路径
  - `encoding` (String): 文件编码
  - `fieldDelimiter` (String): 文件分隔符
  - `skipHeader` (Boolean): 跳过表头
  - `lineDelimiter` (String): 文件record分割付记录分割符号
  - `username` (String): 用户名
  - `password` (String): 密码
  - `connection` (List<Connection>): hive连接
  - `haveKerberos` (String): haveKerberos相关
  - `kerberosKeytabFilePath` (String): 见示例
  - `kerberosPrincipal` (String): 见示例
  - `defaultFS` (String): hdfs地址,比如 hdfs://namenode:8020"
  - `fileType` (String): hdfs文件类型,比如 text, orc, parquet
  - `fileName` (String): 见示例
  - `writeMode` (String): 见示例
  - `path` (List<String>): 文件路径
  - `encoding` (String): 文件编码
  - `fieldDelimiter` (String): 文件分隔符
  - `skipHeader` (Boolean): 跳过表头
  - `compress` (String): 见示例
  - `lineDelimiter` (String): 文件record分割付记录分割符号
  - `protocol` (String): 协议(ftp,sftp)
  - `host` (String): host
  - `port` (String): port
  - `username` (String): 见示例
  - `password` (String): 见示例
  - `fileType` (String): 见示例
  - `path` (List<String>): 见示例
  - `fieldDelimiter` (String): 文件分隔符
  - `encoding` (String): 文件编码
  - `lineDelimiter` (String): 文件record分割付记录分割符号
  - `url` (String): 接口地址
  - `postType` (String): 一般为= "json"
  - `method` (String): 请求方式
  - `headers` (Map<String, String>): 请求头
  - `params` (Map<String, String>): 请求参数
  - `resultKey` (String): 见示例
  - `paging` (Pagination): 分页相关
  - `username` (String): 数据源用户名
  - `password` (String): password
  - `column` (List<Object>): 列
  - `connection` (List<Connection>): 链接相关
  - `fetchSize` (Integer): 从服务器每次读取数量 --读
  - `splitPk` (String): 主键
  - `where` (String): where字句
  - `preSql` (List<String>): 前置sql
  - `postSql` (List<String>): 后置sql
  - `batchSize` (Integer): 一次性批量写入提交记录数量 -- 写
  - `name` (String): 基础属性-列名，必须与数据库字段或源字段对应 示例: "id"
  - `type` (String): 基础属性-数据类型，用于数据转换 示例: "string", "int", "float", "long"
  - `index` (Integer): 基础属性-列在源/目标表中的索引（可选） 示例: 0, 1...
  - `value` (String): 转换和处理-默认值，如果源值为空时使用
  - `dateFormat` (String): 转换和处理,日期类型格式化 示例: "yyyy-MM-dd HH:mm:ss"
  - `format` (String): 转换和处理-格式化规则（如字符串长度、精度）示例: "%.2f"
  - `nullable` (Boolean): 校验规则-是否允许空值 示例:true / false
  - `trim` (Boolean): 校验规则-是否去掉空格 示例:true / false
  - `table` (List<String>): 表相关
  - `jdbcUrl` (List<String>): jdbcUrl
  - `querySql` (List<String>): 查询sql
  - `jdbcUrl` (String): jdbcUrl
  - `indexParameter` (String): 见示例
  - `sizeParameter` (String): 见示例
  - `startIndex` (Integer): 见示例
  - `pageSize` (Integer): 见示例
  - `totalPath` (String): 见示例


请求示例：

```http
POST /syncJob/getSyncConfigWrapper HTTP/1.1
Content-Type: application/json

{
  "fileType": "sample",
  "readerDataSourceId": 1,
  "writerDataSourceId": 1
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": {
    "dataxConfigJson": "sample",
    "job": "sample",
    "setting": "sample",
    "content": [
      {}
    ],
    "reader": "sample",
    "writer": "sample",
    "speed": {
      "sampleKey": "sampleValue"
    },
    "errorLimit": {
      "sampleKey": "sampleValue"
    },
    "restore": true,
    "name": "sample",
    "parameter": "sample",
    "column": [
      "sample"
    ],
    "path": [
      "sample"
    ],
    "encoding": "sample",
    "fieldDelimiter": "sample",
    "skipHeader": true,
    "lineDelimiter": "sample",
    "username": "sample",
    "password": "sample",
    "connection": [
      {}
    ],
    "haveKerberos": "sample",
    "kerberosKeytabFilePath": "sample",
    "kerberosPrincipal": "sample",
    "defaultFS": "sample",
    "fileType": "sample",
    "fileName": "sample",
    "writeMode": "sample",
    "compress": "sample",
    "protocol": "sample",
    "host": "sample",
    "port": "sample",
    "url": "sample",
    "postType": "sample",
    "method": "sample",
    "headers": {
      "sampleKey": "sampleValue"
    },
    "params": {
      "sampleKey": "sampleValue"
    },
    "resultKey": "sample",
    "paging": "sample",
    "fetchSize": 1,
    "splitPk": "sample",
    "where": "sample",
    "preSql": [
      "sample"
    ],
    "postSql": [
      "sample"
    ],
    "batchSize": 1,
    "type": "sample",
    "index": 1,
    "value": "sample",
    "dateFormat": "sample",
    "format": "sample",
    "nullable": true,
    "trim": true,
    "table": [
      "sample"
    ],
    "jdbcUrl": "sample",
    "querySql": [
      "sample"
    ],
    "indexParameter": "sample",
    "sizeParameter": "sample",
    "startIndex": 1,
    "pageSize": 1,
    "totalPath": "sample"
  }
}
```


## 同步作业实例

### POST /syncJobInstance/pageSyncJobInstance

接口描述：

查询作业实例

请求入参：

- 请求体: `SyncJobInstanceQueryInput`
  - `syncJobFileId` (Long): 作业文件标识
  - `keyword` (String): 关键字搜索
  - `pageNum` (Integer): 起始页号
  - `pageSize` (Integer): 每页条数

响应出参：

- 返回类型: `PageResult<SyncJobInstanceVO>`
- 顶层字段: `pageNum`、`pageSize`、`total`、`dataList`。
- `dataList`: `SyncJobInstanceVO` 列表。
  - `serialVersionUID` (static final long): 见示例
  - `syncJobInstanceId` (Long): 实例标识
  - `syncJobId` (Long): 数据同步标识
  - `syncJobName` (String): 数据同步名称
  - `executeResult` (String): 执行结果
  - `endTm` (LocalDateTime): 执行结束时间
  - `startTm` (LocalDateTime): 执行开始时间
  - `spentTime` (String): 耗时
  - `processId` (Long): 进程号
  - `tenantId` (Long): 租户标识
  - `creator` (Long): 记录创建人ID
  - `createUserName` (String): 记录创建人名称


请求示例：

```http
POST /syncJobInstance/pageSyncJobInstance HTTP/1.1
Content-Type: application/json

{
  "syncJobFileId": 1,
  "keyword": "sample",
  "pageNum": 1,
  "pageSize": 1
}
```

响应示例：

```json
{
  "pageNum": 1,
  "pageSize": 10,
  "total": 1,
  "dataList": [
    {
      "syncJobInstanceId": 1,
      "syncJobId": 1,
      "syncJobName": "sample",
      "executeResult": "sample",
      "endTm": "2026-04-03 12:00:00",
      "startTm": "2026-04-03 12:00:00",
      "spentTime": "sample",
      "processId": 1,
      "tenantId": 1,
      "creator": 1,
      "createUserName": "sample"
    }
  ]
}
```

### POST /syncJobInstance/startSyncJob

接口描述：

启动同步作业

请求入参：

- 无请求体，参数见请求 URL。

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /syncJobInstance/startSyncJob?syncJobFileId=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /syncJobInstance/startOuterSyncJob

接口描述：

启动外部同步作业

请求入参：

- 请求体: `JobCallBackParamDTO`
  - `jobId` (Long): 作业标识
  - `appCode` (String): 应用编码
  - `params` (Object): 外部参数

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /syncJobInstance/startOuterSyncJob HTTP/1.1
Content-Type: application/json

{
  "jobId": 1,
  "appCode": "sample",
  "params": {
    "k": "v"
  }
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /syncJobInstance/startSyncJobs

接口描述：

批量启动同步作业

请求入参：

- 无请求体，参数见请求 URL。

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /syncJobInstance/startSyncJobs?syncJobFileIds=sample HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /syncJobInstance/stopSyncJob

接口描述：

停止同步作业实例

请求入参：

- 无请求体，参数见请求 URL。

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /syncJobInstance/stopSyncJob?syncJobInstanceId=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /syncJobInstance/stopSyncJobs

接口描述：

批量停止同步作业实例

请求入参：

- 无请求体，参数见请求 URL。

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /syncJobInstance/stopSyncJobs?syncJobInstanceIds=sample HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /syncJobInstance/querySyncJobInstanceLog

接口描述：

查询作业实例运行日志

请求入参：

- 请求体: `SyncJobInstanceLogQueryInput`
  - `syncJobInstanceId` (Long): 作业实例标识
  - `startRow` (Integer): 开始行数
  - `endRow` (Integer): 结束行数

响应出参：

- 返回类型: `JSONResult<String>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `String`。


请求示例：

```http
POST /syncJobInstance/querySyncJobInstanceLog HTTP/1.1
Content-Type: application/json

{
  "syncJobInstanceId": 1,
  "startRow": 1,
  "endRow": 1
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": "sample"
}
```


## 同步元数据

### POST /syncMetadata/listDatabase

接口描述：

获取数据源下的数据库和schema

请求入参：

- 无请求体，参数见请求 URL。

响应出参：

- 返回类型: `JSONResult<List<SyncDatabaseVO>>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `List<SyncDatabaseVO>`。


请求示例：

```http
POST /syncMetadata/listDatabase?dataSourceId=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": [
    {
      "name": "sample",
      "schemas": [
        "sample"
      ]
    }
  ]
}
```

### POST /syncMetadata/listDataSource

接口描述：

查询数据源

请求入参：

- 无请求体，参数见请求 URL。

响应出参：

- 返回类型: `JSONResult<List<SyncDataSourceVO>>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `List<SyncDataSourceVO>`。


请求示例：

```http
POST /syncMetadata/listDataSource HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": [
    {
      "dataSourceId": 1,
      "dataSourceName": "sample",
      "dbType": "sample"
    }
  ]
}
```

### POST /syncMetadata/listColumnTypes

接口描述：

查询数据库下的列类型

请求入参：

- 无请求体，参数见请求 URL。

响应出参：

- 返回类型: `JSONResult<List<String>>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `List<String>`。


请求示例：

```http
POST /syncMetadata/listColumnTypes?dbType=sample HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": [
    "sample"
  ]
}
```

### POST /syncMetadata/listDbType

接口描述：

获取数据源引擎

请求入参：

- 无请求体，参数见请求 URL。

响应出参：

- 返回类型: `JSONResult<List<String>>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `List<String>`。


请求示例：

```http
POST /syncMetadata/listDbType HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": [
    "sample"
  ]
}
```

### POST /syncMetadata/listTableByDatabase

接口描述：

获取数据源下的表

请求入参：

- 无请求体，参数见请求 URL。

响应出参：

- 返回类型: `JSONResult<List<SyncTableVO>>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `List<SyncTableVO>`。


请求示例：

```http
POST /syncMetadata/listTableByDatabase?dataSourceId=1&database=sample&schema=sample HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": [
    {
      "tableCnName": "sample",
      "tableEnName": "sample"
    }
  ]
}
```


## 实时同步 CDC

### GET /cdc/job/fetch

接口描述：

获取实时同步任务参数

请求入参：

- `jobId` (String，query 参数): 任务标识
- `withMapping` (Boolean，query 参数): 是否返回映射

响应出参：

- 返回类型: `String`


请求示例：

```http
GET /cdc/job/fetch?jobId=1&withMapping=true HTTP/1.1
```

响应示例：

```json
"sample-config-content"
```

### POST /cdc/job/save

接口描述：

接口说明见代码注释。

请求入参：

- 请求体: `String`

响应出参：

- 返回类型: `JSONResult<Long>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Long`。


请求示例：

```http
POST /cdc/job/save HTTP/1.1
Content-Type: application/json

"sample"
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": 1
}
```

### POST /cdc/job/start

接口描述：

接口说明见代码注释。

请求入参：

- 请求体: `String`

响应出参：

- 返回类型: `JSONResult<Long>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Long`。


请求示例：

```http
POST /cdc/job/start HTTP/1.1
Content-Type: application/json

"sample"
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": 1
}
```

### POST /cdc/job/publish

接口描述：

接口说明见代码注释。

请求入参：

- 请求体: `String`

响应出参：

- 返回类型: `JSONResult<Long>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Long`。


请求示例：

```http
POST /cdc/job/publish HTTP/1.1
Content-Type: application/json

"sample"
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": 1
}
```

### POST /cdc/job/start/{jobId}

接口描述：

接口说明见代码注释。

请求入参：

- `jobId` (Long，path 参数): 见接口定义

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /cdc/job/start/{jobId}?jobId=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /cdc/job/stop/{jobId}

接口描述：

接口说明见代码注释。

请求入参：

- `jobId` (Long，path 参数): 见接口定义

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /cdc/job/stop/{jobId}?jobId=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /cdc/job/delete/{jobId}

接口描述：

接口说明见代码注释。

请求入参：

- `jobId` (Long，path 参数): 见接口定义

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /cdc/job/delete/{jobId}?jobId=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /cdc/job/upload/jar

接口描述：

接口说明见代码注释。

请求入参：

- 无请求体，参数见请求 URL。

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /cdc/job/upload/jar HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /cdc/job/status

接口描述：

接口说明见代码注释。

请求入参：

- 请求体: `List<Long>`

响应出参：

- 返回类型: `JSONResult<List<SyncRealTimeJobInfo>>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `List<SyncRealTimeJobInfo>`。


请求示例：

```http
POST /cdc/job/status HTTP/1.1
Content-Type: application/json

[
  1
]
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": [
    {
      "jobId": 1,
      "jobName": "sample",
      "syncCdcJobStatus": "sample"
    }
  ]
}
```

### POST /cdc/job/status/push

接口描述：

推送实时同步任务状态

请求入参：

- 请求体: `JobInspectDto`
  - `jobId` (Long): 任务标识
  - `jobStatus` (String): 任务状态

响应出参：

- 返回类型: `String`


请求示例：

```http
POST /cdc/job/status/push HTTP/1.1
Content-Type: application/json

{
  "jobId": 1,
  "jobStatus": "RUNNING"
}
```

响应示例：

```json
"success"
```


## 工作流基础定义

### POST /workflow/page

接口描述：

工作流基础定义分页查询

请求入参：

- 请求体: `WfBaseDefQueryInput`
  - `pageNum` (long): 分页页码
  - `pageSize` (long): 分页大小
  - `keyWord` (String): 关键字
  - `status` (String): 任务状态:启用,停用
  - `appCode` (String): 应用编码
  - `moduleCode` (String): 模块编码
  - `sysClass` (String): 系统分类
  - `moduleClass` (String): 模块分类
  - `tenantId` (Long): 租户标识

响应出参：

- 返回类型: `PageResult<WfBaseDefVO>`
- 顶层字段: `pageNum`、`pageSize`、`total`、`dataList`。
- `dataList`: `WfBaseDefVO` 列表。
  - `wfBaseDefObjectId` (Long): 工作流基础定义对象标识
  - `wfBaseDefFileId` (Long): 工作流基础定义文件标识
  - `wfCnName` (String): 工作流中文名称
  - `wfEnName` (String): 工作流英文名称
  - `status` (WfBaseDefObjectStatusEnum): 工作流基础定义对象状态
  - `appCode` (String): 应用编码
  - `moduleCode` (String): 模块编码
  - `sysClass` (String): 系统分类
  - `moduleClass` (String): 模块分类
  - `requestPara` (List<WfParamVO>): 请求参数
  - `callBackSet` (WfCallBackSetVO): 流程回调
  - `ccSetting` (WfCcSettingVO): 抄送详情
  - `messageId` (Long): 消息标识
  - `lastDeployCm` (LocalDateTime): 上一次部署时间
  - `ifTenantLimit` (String): 是否租户限制
  - `ifCanRevoke` (String): 是否可撤销
  - `ifCanApprovePersonRepeat` (String): 是否可审批人重复
  - `nodeTimeout` (Integer): 节点超时时间(天)
  - `tenantId` (Long): 租户标识
  - `tenantName` (String): 租户名称
  - `creator` (Long): 记录创建人
  - `createCnName` (String): 记录创建人
  - `createTm` (LocalDateTime): 记录创建时间
  - `modifier` (Long): 记录修改人
  - `modifyCnName` (String): 记录修改人
  - `modifyTm` (LocalDateTime): 记录修改时间
  - `ifDelete` (String): 是否删除


请求示例：

```http
POST /workflow/page HTTP/1.1
Content-Type: application/json

{
  "pageNum": 1,
  "pageSize": 1,
  "keyWord": "sample",
  "status": "sample",
  "appCode": "sample",
  "moduleCode": "sample",
  "sysClass": "sample",
  "moduleClass": "sample",
  "tenantId": 1
}
```

响应示例：

```json
{
  "pageNum": 1,
  "pageSize": 10,
  "total": 1,
  "dataList": [
    {
      "wfBaseDefObjectId": 1,
      "wfBaseDefFileId": 1,
      "wfCnName": "sample",
      "wfEnName": "sample",
      "status": "sample",
      "appCode": "sample",
      "moduleCode": "sample",
      "sysClass": "sample",
      "moduleClass": "sample",
      "requestPara": [
        {}
      ],
      "callBackSet": {
        "submitSet": [
          {}
        ],
        "passSet": [
          {}
        ],
        "rejectSet": [
          {}
        ],
        "completeSet": [
          {}
        ],
        "stopSet": [
          {}
        ]
      },
      "ccSetting": {
        "ccTypes": [
          {}
        ],
        "ccTemplateId": 1,
        "ccRequestParam": [
          {}
        ]
      },
      "messageId": 1,
      "lastDeployCm": "2026-04-03 12:00:00",
      "ifTenantLimit": "sample",
      "ifCanRevoke": "sample",
      "ifCanApprovePersonRepeat": "sample",
      "nodeTimeout": 1,
      "tenantId": 1,
      "tenantName": "sample",
      "creator": 1,
      "createCnName": "sample",
      "createTm": "2026-04-03 12:00:00",
      "modifier": 1,
      "modifyCnName": "sample",
      "modifyTm": "2026-04-03 12:00:00",
      "ifDelete": "sample"
    }
  ]
}
```

### POST /workflow/list

接口描述：

工作流列表查询

请求入参：

- 请求体: `ListWfBaseDefInput`
  - `appCode` (String): 应用编码
  - `moduleCode` (String): 模块编码
  - `tenantId` (Long): 租户主键
  - `sysClass` (String): 系统分类
  - `moduleClass` (String): 模块分类

响应出参：

- 返回类型: `JSONResult<List<WfBaseDefVO>>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `List<WfBaseDefVO>`。


请求示例：

```http
POST /workflow/list HTTP/1.1
Content-Type: application/json

{
  "appCode": "sample",
  "moduleCode": "sample",
  "tenantId": 1,
  "sysClass": "sample",
  "moduleClass": "sample"
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": [
    {
      "wfBaseDefObjectId": 1,
      "wfBaseDefFileId": 1,
      "wfCnName": "sample",
      "wfEnName": "sample",
      "status": {},
      "appCode": "sample",
      "moduleCode": "sample",
      "sysClass": "sample",
      "moduleClass": "sample",
      "requestPara": [
        {}
      ],
      "callBackSet": {},
      "ccSetting": {},
      "messageId": 1,
      "lastDeployCm": "2026-04-03 12:00:00",
      "ifTenantLimit": "sample",
      "ifCanRevoke": "sample",
      "ifCanApprovePersonRepeat": "sample",
      "nodeTimeout": 1,
      "tenantId": 1,
      "tenantName": "sample",
      "creator": 1,
      "createCnName": "sample",
      "createTm": "2026-04-03 12:00:00",
      "modifier": 1,
      "modifyCnName": "sample",
      "modifyTm": "2026-04-03 12:00:00",
      "ifDelete": "sample"
    }
  ]
}
```

### POST /workflow/count

接口描述：

工作流数量查询

请求入参：

- 请求体: `ListWfBaseDefInput`
  - `appCode` (String): 应用编码
  - `moduleCode` (String): 模块编码
  - `tenantId` (Long): 租户主键
  - `sysClass` (String): 系统分类
  - `moduleClass` (String): 模块分类

响应出参：

- 返回类型: `JSONResult<Long>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Long`。


请求示例：

```http
POST /workflow/count HTTP/1.1
Content-Type: application/json

{
  "appCode": "sample",
  "moduleCode": "sample",
  "tenantId": 1,
  "sysClass": "sample",
  "moduleClass": "sample"
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": 1
}
```

### POST /workflow/add

接口描述：

新增工作流基础定义

请求入参：

- 请求体: `WfBaseDefInput`
  - `wfBaseDefObjectId` (Long): 工作流基础定义对象标识
  - `wfBaseDefFileId` (Long): 工作流基础定义文件标识
  - `wfCnName` (String): 工作流中文名称
  - `wfEnName` (String): 工作流英文名称
  - `appCode` (String): 应用编码
  - `moduleCode` (String): 模块编码
  - `sysClass` (String): 系统分类
  - `moduleClass` (String): 模块分类
  - `ifTenantLimit` (String): 是否租户限制
  - `ifCanRevoke` (String): 是否可撤销
  - `ifCanApprovePersonRepeat` (String): 是否可审批人重复
  - `nodeTimeout` (Integer): 节点超时时间(天)
  - `requestPara` (List<WfParamInput>): 流程变量（输入详情）
  - `callBackSet` (WfCallBackSetInput): 流程回调
  - `ccSetting` (WfCcSettingInput): 抄送详情
  - `messageId` (Long): 消息标识

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /workflow/add HTTP/1.1
Content-Type: application/json

{
  "wfBaseDefObjectId": 1,
  "wfBaseDefFileId": 1,
  "wfCnName": "sample",
  "wfEnName": "sample",
  "appCode": "sample",
  "moduleCode": "sample",
  "sysClass": "sample",
  "moduleClass": "sample",
  "ifTenantLimit": "sample",
  "ifCanRevoke": "sample",
  "ifCanApprovePersonRepeat": "sample",
  "nodeTimeout": 1,
  "requestPara": [
    {}
  ],
  "callBackSet": {
    "submitSet": [
      {}
    ],
    "passSet": [
      {}
    ],
    "rejectSet": [
      {}
    ],
    "completeSet": [
      {}
    ],
    "stopSet": [
      {}
    ]
  },
  "ccSetting": {
    "ccTypes": [
      {}
    ],
    "ccTemplateId": 1,
    "ccRequestParam": [
      {}
    ]
  },
  "messageId": 1
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /workflow/system/add

接口描述：

系统新增工作流基础定义

请求入参：

- 请求体: `SystemWfBaseDefInput`
  - `wfBaseDefInput` (WfBaseDefInput): 工作流基础定义信息
  - `wfFlowDefInput` (WfFlowDefInput): 流程定定义参数
  - `userId` (Long): 用户标识
  - `tenantId` (Long): 租户标识

响应出参：

- 返回类型: `JSONResult<Long>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Long`。


请求示例：

```http
POST /workflow/system/add HTTP/1.1
Content-Type: application/json

{
  "wfBaseDefInput": {
    "wfBaseDefObjectId": 1,
    "wfBaseDefFileId": 1,
    "wfCnName": "sample",
    "wfEnName": "sample",
    "appCode": "sample",
    "moduleCode": "sample",
    "sysClass": "sample",
    "moduleClass": "sample",
    "ifTenantLimit": "sample",
    "ifCanRevoke": "sample",
    "ifCanApprovePersonRepeat": "sample",
    "nodeTimeout": 1,
    "requestPara": [
      {}
    ],
    "callBackSet": {},
    "ccSetting": {},
    "messageId": 1
  },
  "wfFlowDefInput": {
    "wfBaseDefFileId": 1,
    "wfFlowDefId": 1,
    "wfFlowDefFileId": 1,
    "flowContent": {}
  },
  "userId": 1,
  "tenantId": 1
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": 1
}
```

### POST /workflow/get

接口描述：

通过id查询工作流定义

请求入参：

- `wfBaseDefFileId` (Long，query 参数): 工作流定义文件标识

响应出参：

- 返回类型: `JSONResult<WfBaseDefVO>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `WfBaseDefVO`。
  - `wfBaseDefObjectId` (Long): 工作流基础定义对象标识
  - `wfBaseDefFileId` (Long): 工作流基础定义文件标识
  - `wfCnName` (String): 工作流中文名称
  - `wfEnName` (String): 工作流英文名称
  - `status` (WfBaseDefObjectStatusEnum): 工作流基础定义对象状态
  - `appCode` (String): 应用编码
  - `moduleCode` (String): 模块编码
  - `sysClass` (String): 系统分类
  - `moduleClass` (String): 模块分类
  - `requestPara` (List<WfParamVO>): 请求参数
  - `callBackSet` (WfCallBackSetVO): 流程回调
  - `ccSetting` (WfCcSettingVO): 抄送详情
  - `messageId` (Long): 消息标识
  - `lastDeployCm` (LocalDateTime): 上一次部署时间
  - `ifTenantLimit` (String): 是否租户限制
  - `ifCanRevoke` (String): 是否可撤销
  - `ifCanApprovePersonRepeat` (String): 是否可审批人重复
  - `nodeTimeout` (Integer): 节点超时时间(天)
  - `tenantId` (Long): 租户标识
  - `tenantName` (String): 租户名称
  - `creator` (Long): 记录创建人
  - `createCnName` (String): 记录创建人
  - `createTm` (LocalDateTime): 记录创建时间
  - `modifier` (Long): 记录修改人
  - `modifyCnName` (String): 记录修改人
  - `modifyTm` (LocalDateTime): 记录修改时间
  - `ifDelete` (String): 是否删除


请求示例：

```http
POST /workflow/get?wfBaseDefFileId=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": {
    "wfBaseDefObjectId": 1,
    "wfBaseDefFileId": 1,
    "wfCnName": "sample",
    "wfEnName": "sample",
    "status": "sample",
    "appCode": "sample",
    "moduleCode": "sample",
    "sysClass": "sample",
    "moduleClass": "sample",
    "requestPara": [
      {}
    ],
    "callBackSet": {
      "submitSet": [
        {}
      ],
      "passSet": [
        {}
      ],
      "rejectSet": [
        {}
      ],
      "completeSet": [
        {}
      ],
      "stopSet": [
        {}
      ]
    },
    "ccSetting": {
      "ccTypes": [
        {}
      ],
      "ccTemplateId": 1,
      "ccRequestParam": [
        {}
      ]
    },
    "messageId": 1,
    "lastDeployCm": "2026-04-03 12:00:00",
    "ifTenantLimit": "sample",
    "ifCanRevoke": "sample",
    "ifCanApprovePersonRepeat": "sample",
    "nodeTimeout": 1,
    "tenantId": 1,
    "tenantName": "sample",
    "creator": 1,
    "createCnName": "sample",
    "createTm": "2026-04-03 12:00:00",
    "modifier": 1,
    "modifyCnName": "sample",
    "modifyTm": "2026-04-03 12:00:00",
    "ifDelete": "sample"
  }
}
```

### POST /workflow/edit

接口描述：

更新工作流基础定义

请求入参：

- 请求体: `WfBaseDefInput`
  - `wfBaseDefObjectId` (Long): 工作流基础定义对象标识
  - `wfBaseDefFileId` (Long): 工作流基础定义文件标识
  - `wfCnName` (String): 工作流中文名称
  - `wfEnName` (String): 工作流英文名称
  - `appCode` (String): 应用编码
  - `moduleCode` (String): 模块编码
  - `sysClass` (String): 系统分类
  - `moduleClass` (String): 模块分类
  - `ifTenantLimit` (String): 是否租户限制
  - `ifCanRevoke` (String): 是否可撤销
  - `ifCanApprovePersonRepeat` (String): 是否可审批人重复
  - `nodeTimeout` (Integer): 节点超时时间(天)
  - `requestPara` (List<WfParamInput>): 流程变量（输入详情）
  - `callBackSet` (WfCallBackSetInput): 流程回调
  - `ccSetting` (WfCcSettingInput): 抄送详情
  - `messageId` (Long): 消息标识

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /workflow/edit HTTP/1.1
Content-Type: application/json

{
  "wfBaseDefObjectId": 1,
  "wfBaseDefFileId": 1,
  "wfCnName": "sample",
  "wfEnName": "sample",
  "appCode": "sample",
  "moduleCode": "sample",
  "sysClass": "sample",
  "moduleClass": "sample",
  "ifTenantLimit": "sample",
  "ifCanRevoke": "sample",
  "ifCanApprovePersonRepeat": "sample",
  "nodeTimeout": 1,
  "requestPara": [
    {}
  ],
  "callBackSet": {
    "submitSet": [
      {}
    ],
    "passSet": [
      {}
    ],
    "rejectSet": [
      {}
    ],
    "completeSet": [
      {}
    ],
    "stopSet": [
      {}
    ]
  },
  "ccSetting": {
    "ccTypes": [
      {}
    ],
    "ccTemplateId": 1,
    "ccRequestParam": [
      {}
    ]
  },
  "messageId": 1
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /workflow/delete

接口描述：

通过id删除工作流基础定义

请求入参：

- `wfBaseDefFileId` (Long，query 参数): 工作流基础定义文件标识

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /workflow/delete?wfBaseDefFileId=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /workflow/close

接口描述：

关闭工作流基础定义

请求入参：

- `wfBaseDefFileId` (Long，query 参数): 工作流基础定义文件标识

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /workflow/close?wfBaseDefFileId=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /workflow/copyWfBaseDef

接口描述：

复制工作流定义

请求入参：

- `wfBaseDefFileId` (Long，query 参数): 工作流文件标识
- `tenantId` (Long，query 参数): 见接口定义

响应出参：

- 返回类型: `JSONResult<Long>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Long`。


请求示例：

```http
POST /workflow/copyWfBaseDef?wfBaseDefFileId=1&tenantId=1&wfCnName=sample&wfEnName=sample HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": 1
}
```

### POST /workflow/deployWfBaseDef

接口描述：

部署工作流定于

请求入参：

- `wfBaseDefFileId` (Long，query 参数): 工作流文件标识

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /workflow/deployWfBaseDef?wfBaseDefFileId=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### GET /workflow/pack/export

接口描述：

导出工作流定义

请求入参：

- `appCode` (String，query 参数): 应用编码
- `moduleCode` (String，query 参数): 模块编码
- `tenantId` (Long，query 参数): 租户id

响应出参：

- 返回类型: `Response`
- 返回二进制流，响应头通常包含 `Content-Type` 和 `Content-Disposition`。


请求示例：

```http
GET /workflow/pack/export?appCode=sample&moduleCode=sample&tenantId=1 HTTP/1.1
```

响应示例：

```text
HTTP/1.1 200 OK
Content-Type: application/octet-stream
Content-Disposition: attachment; filename="export.bin"

<binary-stream>
```

### POST /workflow/pack/import

接口描述：

导入工作流定义

请求入参：

- `appCode` (String，query 参数): 应用编码
- `moduleCode` (String，query 参数): 模块编码
- `file` (MultipartFile，multipart): 任务数据文件

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /workflow/pack/import?appCode=sample&moduleCode=sample HTTP/1.1
Content-Type: multipart/form-data

file: <binary>
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /workflow/pack/copy

接口描述：

复制工作流定义

请求入参：

- 请求体: `CopyWorkflowDto`
  - `appCode` (String): 见示例
  - `moduleCode` (String): 见示例
  - `newModuleCode` (String): 见示例
  - `tenantId` (Long): 见示例
  - `tarTenantId` (Long): 见示例
  - `relationShips` (Map<String,Long>): 见示例

响应出参：

- 返回类型: `JSONResult<Map<Long, Long>>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Map<Long, Long>`。


请求示例：

```http
POST /workflow/pack/copy HTTP/1.1
Content-Type: application/json

{
  "appCode": "sample",
  "moduleCode": "sample",
  "newModuleCode": "sample",
  "tenantId": 1,
  "tarTenantId": 1,
  "relationShips": {
    "sampleKey": "sampleValue"
  }
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": {
    "sampleKey": "sampleValue"
  }
}
```

### POST /workflow/base/start

接口描述：

启用工作流

请求入参：

- `appCode` (String，query 参数): 应用编码
- `moduleCode` (String，query 参数): 模块编码

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /workflow/base/start?appCode=sample&moduleCode=sample HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /workflow/base/stop

接口描述：

停止工作流

请求入参：

- `appCode` (String，query 参数): 应用编码
- `moduleCode` (String，query 参数): 模块编码

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /workflow/base/stop?appCode=sample&moduleCode=sample HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /workflow/base/unload

接口描述：

卸载工作流

请求入参：

- `appCode` (String，query 参数): 应用编码
- `moduleCode` (String，query 参数): 模块编码

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /workflow/base/unload?appCode=sample&moduleCode=sample HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### GET /workflow/base/reset/approval

接口描述：

重置默认审批人节点 （默认重置 发起人指定类型: 所有人  第一审批/办理节点  指定审批人 或签方式）

请求入参：

- `moduleCode` (String，query 参数): 模块编码
- `userIds` (List<String>，query 参数): 用户主键

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
GET /workflow/base/reset/approval?moduleCode=sample&userIds=sample HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```


## 工作流流程定义

### POST /workflow/def/get

接口描述：

根据流程定义文件标识查询流程定义

请求入参：

- `wfBaseDefFileId` (Long，query 参数): 根据流程定义文件标识查询流程定义

响应出参：

- 返回类型: `JSONResult<WfFlowDefVO>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `WfFlowDefVO`。
  - `wfBaseDefFileId` (Long): 工作流基础定义文件标识
  - `wfFlowDefId` (Long): 工作流流程定义标识
  - `wfFlowDefFileId` (Long): 工作流流程定义标识
  - `flowContent` (WfFlowContentVO): 流程内容对象


请求示例：

```http
POST /workflow/def/get?wfBaseDefFileId=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": {
    "wfBaseDefFileId": 1,
    "wfFlowDefId": 1,
    "wfFlowDefFileId": 1,
    "flowContent": {
      "nodes": [
        {}
      ],
      "lines": [
        {}
      ],
      "params": "sample",
      "originatorAttribute": {},
      "approvalAttributes": [
        {}
      ],
      "transactorAttributes": [
        {}
      ],
      "conditionsAttributes": [
        {}
      ]
    }
  }
}
```

### POST /workflow/def/add

接口描述：

保存流程定义

请求入参：

- 请求体: `WfFlowDefInput`
  - `wfBaseDefFileId` (Long): 工作流基础定义文件标识
  - `wfFlowDefId` (Long): 工作流流程定义标识
  - `wfFlowDefFileId` (Long): 工作流流程定义标识
  - `flowContent` (WfFlowContentInput): 流程内容对象

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /workflow/def/add HTTP/1.1
Content-Type: application/json

{
  "wfBaseDefFileId": 1,
  "wfFlowDefId": 1,
  "wfFlowDefFileId": 1,
  "flowContent": {
    "nodes": [
      {}
    ],
    "lines": [
      {}
    ],
    "params": "sample",
    "originatorAttribute": {},
    "approvalAttributes": [
      {}
    ],
    "transactorAttributes": [
      {}
    ],
    "conditionsAttributes": [
      {}
    ]
  }
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```


## 工作流实例

### POST /workflow/submit

接口描述：

发起工作流实例

请求入参：

- 请求体: `SubmitWfInstanceInput`
  - `wfBaseDefFileId` (Long): 工作流基础文件标识
  - `approvalObjectId` (String): 审批对象标识
  - `approvalObjectTitle` (String): 审批对象标题
  - `approvalObjectType` (String): 审批对象类型
  - `approvalFormData` (List<SubmitWfInstanceFormDataInput>): 审批表单数据(用户提交数据)

响应出参：

- 返回类型: `JSONResult<Long>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Long`。


请求示例：

```http
POST /workflow/submit HTTP/1.1
Content-Type: application/json

{
  "wfBaseDefFileId": 1,
  "approvalObjectId": "sample",
  "approvalObjectTitle": "sample",
  "approvalObjectType": "sample",
  "approvalFormData": [
    {}
  ]
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": 1
}
```

### POST /workflow/system/submit

接口描述：

系统自动发起工作流实例

请求入参：

- 请求体: `SystemSubmitWfInstanceInput`
  - `wfBaseDefFileId` (Long): 工作流基础文件标识
  - `approvalObjectId` (String): 审批对象标识
  - `approvalObjectTitle` (String): 审批对象标题
  - `approvalObjectType` (String): 审批对象类型
  - `approvalFormData` (List<SubmitWfInstanceFormDataInput>): 审批表单数据(用户提交数据)
  - `userId` (Long): 用户标识
  - `tenantId` (Long): 、

响应出参：

- 返回类型: `JSONResult<Long>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Long`。


请求示例：

```http
POST /workflow/system/submit HTTP/1.1
Content-Type: application/json

{
  "wfBaseDefFileId": 1,
  "approvalObjectId": "sample",
  "approvalObjectTitle": "sample",
  "approvalObjectType": "sample",
  "approvalFormData": [
    {}
  ],
  "userId": 1,
  "tenantId": 1
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": 1
}
```

### POST /workflow/hasSubmitWfInstance

接口描述：

是否有发起任务实例权限

请求入参：

- `wfBaseDefFileId` (Long，query 参数): 工作流文件标识

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /workflow/hasSubmitWfInstance?wfBaseDefFileId=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /workflow/getWfInstanceById

接口描述：

获取任务实例详情

请求入参：

- `id` (Long，query 参数): 主键标识

响应出参：

- 返回类型: `JSONResult<WfInstanceApiVO>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `WfInstanceApiVO`。
  - `wfInstanceId` (Long): 工作流实例标识
  - `wfBaseDefObjectId` (Long): 工作流基础定义对象标识
  - `wfBaseDefFileId` (Long): 工作流基础定义文件标识
  - `wfDefDeployInstanceId` (Long): 工作流定义部署实例标识
  - `appCode` (String): 应用编码
  - `moduleCode` (String): 模块编码
  - `sysClass` (String): 系统分类
  - `moduleClass` (String): 模块分类
  - `wfCnName` (String): 任务名称
  - `wfEnName` (String): 任务名称
  - `approvalObjectId` (String): 审批对象标识
  - `approvalObjectTitle` (String): 审批对象标题
  - `approvalObjectType` (String): 审批对象类型
  - `approveStatus` (WfTaskStatusEnum): 审批任务状态
  - `commitPersonId` (Long): 发起人标识
  - `commitPersonCnName` (String): 发起人名称
  - `approvePerson` (String): 办理/审批人组
  - `currNode` (String): 当前所处节点
  - `currNodeName` (String): 当前所处节点名称
  - `currNodeType` (WfFlowContentNodeTypeEnum): 当前节点类型
  - `approveType` (WfFlowApprovalStatusEnum): 最近审批操作类型
  - `taskStartTm` (LocalDateTime): 任务开始时间
  - `taskEndTm` (LocalDateTime): 任务结束时间
  - `filterType` (String): 筛选类型
  - `tenantId` (Long): 租户标识
  - `status` (String): 状态
  - `modifyTm` (LocalDateTime): 最近更新时间
  - `modifier` (Long): 最近更新人标识
  - `modifierCnName` (String): 最近更新人名称


请求示例：

```http
POST /workflow/getWfInstanceById?id=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": {
    "wfInstanceId": 1,
    "wfBaseDefObjectId": 1,
    "wfBaseDefFileId": 1,
    "wfDefDeployInstanceId": 1,
    "appCode": "sample",
    "moduleCode": "sample",
    "sysClass": "sample",
    "moduleClass": "sample",
    "wfCnName": "sample",
    "wfEnName": "sample",
    "approvalObjectId": "sample",
    "approvalObjectTitle": "sample",
    "approvalObjectType": "sample",
    "approveStatus": "sample",
    "commitPersonId": 1,
    "commitPersonCnName": "sample",
    "approvePerson": "sample",
    "currNode": "sample",
    "currNodeName": "sample",
    "currNodeType": "sample",
    "approveType": "sample",
    "taskStartTm": "2026-04-03 12:00:00",
    "taskEndTm": "2026-04-03 12:00:00",
    "filterType": "sample",
    "tenantId": 1,
    "status": "sample",
    "modifyTm": "2026-04-03 12:00:00",
    "modifier": 1,
    "modifierCnName": "sample"
  }
}
```

### POST /workflow/system/getWfInstanceById

接口描述：

后台获取任务实例详情

请求入参：

- `id` (Long，query 参数): 主键标识

响应出参：

- 返回类型: `JSONResult<WfInstanceApiVO>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `WfInstanceApiVO`。
  - `wfInstanceId` (Long): 工作流实例标识
  - `wfBaseDefObjectId` (Long): 工作流基础定义对象标识
  - `wfBaseDefFileId` (Long): 工作流基础定义文件标识
  - `wfDefDeployInstanceId` (Long): 工作流定义部署实例标识
  - `appCode` (String): 应用编码
  - `moduleCode` (String): 模块编码
  - `sysClass` (String): 系统分类
  - `moduleClass` (String): 模块分类
  - `wfCnName` (String): 任务名称
  - `wfEnName` (String): 任务名称
  - `approvalObjectId` (String): 审批对象标识
  - `approvalObjectTitle` (String): 审批对象标题
  - `approvalObjectType` (String): 审批对象类型
  - `approveStatus` (WfTaskStatusEnum): 审批任务状态
  - `commitPersonId` (Long): 发起人标识
  - `commitPersonCnName` (String): 发起人名称
  - `approvePerson` (String): 办理/审批人组
  - `currNode` (String): 当前所处节点
  - `currNodeName` (String): 当前所处节点名称
  - `currNodeType` (WfFlowContentNodeTypeEnum): 当前节点类型
  - `approveType` (WfFlowApprovalStatusEnum): 最近审批操作类型
  - `taskStartTm` (LocalDateTime): 任务开始时间
  - `taskEndTm` (LocalDateTime): 任务结束时间
  - `filterType` (String): 筛选类型
  - `tenantId` (Long): 租户标识
  - `status` (String): 状态
  - `modifyTm` (LocalDateTime): 最近更新时间
  - `modifier` (Long): 最近更新人标识
  - `modifierCnName` (String): 最近更新人名称


请求示例：

```http
POST /workflow/system/getWfInstanceById?id=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": {
    "wfInstanceId": 1,
    "wfBaseDefObjectId": 1,
    "wfBaseDefFileId": 1,
    "wfDefDeployInstanceId": 1,
    "appCode": "sample",
    "moduleCode": "sample",
    "sysClass": "sample",
    "moduleClass": "sample",
    "wfCnName": "sample",
    "wfEnName": "sample",
    "approvalObjectId": "sample",
    "approvalObjectTitle": "sample",
    "approvalObjectType": "sample",
    "approveStatus": "sample",
    "commitPersonId": 1,
    "commitPersonCnName": "sample",
    "approvePerson": "sample",
    "currNode": "sample",
    "currNodeName": "sample",
    "currNodeType": "sample",
    "approveType": "sample",
    "taskStartTm": "2026-04-03 12:00:00",
    "taskEndTm": "2026-04-03 12:00:00",
    "filterType": "sample",
    "tenantId": 1,
    "status": "sample",
    "modifyTm": "2026-04-03 12:00:00",
    "modifier": 1,
    "modifierCnName": "sample"
  }
}
```

### POST /workflow/testCallback

接口描述：

回调接口测试

请求入参：

- 请求体: `TestCallbackInput`
  - `wfBaseDefFileId` (Long): 工作流标识
  - `approvalObjectId` (String): 审批对象标识
  - `approvalObjectTitle` (String): 审批对象标题
  - `approvalObjectType` (String): 审批对象类型
  - `wfInstanceId` (Long): 工作流实例标识
  - `wfInstanceApprovalStatus` (String): 最终审批结果 1通过 0驳回 2异常
  - `wfInstanceApprover` (Long): 最终审批人
  - `wfInstanceApproverTenantId` (Long): 最终审批人所属租户

响应出参：

- 返回类型: `JSONResult<TestCallbackResultVO>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `TestCallbackResultVO`。
  - `wfBaseDefFileId` (Long): 工作流标识
  - `approvalObjectId` (String): 审批对象标识
  - `approvalObjectTitle` (String): 审批对象标题
  - `approvalObjectType` (String): 审批对象类型
  - `wfInstanceId` (Long): 工作流实例标识
  - `wfInstanceApprovalStatus` (String): 最终审批结果 1通过 0驳回 2异常
  - `wfInstanceApprover` (Long): 最终审批人
  - `wfInstanceApproverTenantId` (Long): 最终审批人所属租户


请求示例：

```http
POST /workflow/testCallback HTTP/1.1
Content-Type: application/json

{
  "wfBaseDefFileId": 1,
  "approvalObjectId": "sample",
  "approvalObjectTitle": "sample",
  "approvalObjectType": "sample",
  "wfInstanceId": 1,
  "wfInstanceApprovalStatus": "sample",
  "wfInstanceApprover": 1,
  "wfInstanceApproverTenantId": 1
}
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": {
    "wfBaseDefFileId": 1,
    "approvalObjectId": "sample",
    "approvalObjectTitle": "sample",
    "approvalObjectType": "sample",
    "wfInstanceId": 1,
    "wfInstanceApprovalStatus": "sample",
    "wfInstanceApprover": 1,
    "wfInstanceApproverTenantId": 1
  }
}
```

### POST /workflow/countMyWfInstance

接口描述：

我的流程总数

请求入参：

- 无请求体，参数见请求 URL。

响应出参：

- 返回类型: `JSONResult<Long>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Long`。


请求示例：

```http
POST /workflow/countMyWfInstance?keyWord=sample&filterType=sample&approvalObjectId=sample&approvalObjectTitle=sample&approvalObjectType=sample&appCode=sample&moduleCode=sample&sysClass=sample&moduleClass=sample&approveStatus=sample&tenantId=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": 1
}
```

### POST /workflow/pageMyWfInstance

接口描述：

我的流程

请求入参：

- 无请求体，参数见请求 URL。

响应出参：

- 返回类型: `PageResult<WfInstanceApiVO>`
- 顶层字段: `pageNum`、`pageSize`、`total`、`dataList`。
- `dataList`: `WfInstanceApiVO` 列表。
  - `wfInstanceId` (Long): 工作流实例标识
  - `wfBaseDefObjectId` (Long): 工作流基础定义对象标识
  - `wfBaseDefFileId` (Long): 工作流基础定义文件标识
  - `wfDefDeployInstanceId` (Long): 工作流定义部署实例标识
  - `appCode` (String): 应用编码
  - `moduleCode` (String): 模块编码
  - `sysClass` (String): 系统分类
  - `moduleClass` (String): 模块分类
  - `wfCnName` (String): 任务名称
  - `wfEnName` (String): 任务名称
  - `approvalObjectId` (String): 审批对象标识
  - `approvalObjectTitle` (String): 审批对象标题
  - `approvalObjectType` (String): 审批对象类型
  - `approveStatus` (WfTaskStatusEnum): 审批任务状态
  - `commitPersonId` (Long): 发起人标识
  - `commitPersonCnName` (String): 发起人名称
  - `approvePerson` (String): 办理/审批人组
  - `currNode` (String): 当前所处节点
  - `currNodeName` (String): 当前所处节点名称
  - `currNodeType` (WfFlowContentNodeTypeEnum): 当前节点类型
  - `approveType` (WfFlowApprovalStatusEnum): 最近审批操作类型
  - `taskStartTm` (LocalDateTime): 任务开始时间
  - `taskEndTm` (LocalDateTime): 任务结束时间
  - `filterType` (String): 筛选类型
  - `tenantId` (Long): 租户标识
  - `status` (String): 状态
  - `modifyTm` (LocalDateTime): 最近更新时间
  - `modifier` (Long): 最近更新人标识
  - `modifierCnName` (String): 最近更新人名称


请求示例：

```http
POST /workflow/pageMyWfInstance?keyWord=sample&filterType=sample&approvalObjectId=sample&approvalObjectTitle=sample&approvalObjectType=sample&appCode=sample&moduleCode=sample&sysClass=sample&moduleClass=sample&tenantId=1&approveStatus=sample&pageNum=1&pageSize=1 HTTP/1.1
```

响应示例：

```json
{
  "pageNum": 1,
  "pageSize": 10,
  "total": 1,
  "dataList": [
    {
      "wfInstanceId": 1,
      "wfBaseDefObjectId": 1,
      "wfBaseDefFileId": 1,
      "wfDefDeployInstanceId": 1,
      "appCode": "sample",
      "moduleCode": "sample",
      "sysClass": "sample",
      "moduleClass": "sample",
      "wfCnName": "sample",
      "wfEnName": "sample",
      "approvalObjectId": "sample",
      "approvalObjectTitle": "sample",
      "approvalObjectType": "sample",
      "approveStatus": "sample",
      "commitPersonId": 1,
      "commitPersonCnName": "sample",
      "approvePerson": "sample",
      "currNode": "sample",
      "currNodeName": "sample",
      "currNodeType": "sample",
      "approveType": "sample",
      "taskStartTm": "2026-04-03 12:00:00",
      "taskEndTm": "2026-04-03 12:00:00",
      "filterType": "sample",
      "tenantId": 1,
      "status": "sample",
      "modifyTm": "2026-04-03 12:00:00",
      "modifier": 1,
      "modifierCnName": "sample"
    }
  ]
}
```

### POST /workflow/pageWfInstance

接口描述：

流程查询

请求入参：

- 无请求体，参数见请求 URL。

响应出参：

- 返回类型: `PageResult<WfInstanceApiVO>`
- 顶层字段: `pageNum`、`pageSize`、`total`、`dataList`。
- `dataList`: `WfInstanceApiVO` 列表。
  - `wfInstanceId` (Long): 工作流实例标识
  - `wfBaseDefObjectId` (Long): 工作流基础定义对象标识
  - `wfBaseDefFileId` (Long): 工作流基础定义文件标识
  - `wfDefDeployInstanceId` (Long): 工作流定义部署实例标识
  - `appCode` (String): 应用编码
  - `moduleCode` (String): 模块编码
  - `sysClass` (String): 系统分类
  - `moduleClass` (String): 模块分类
  - `wfCnName` (String): 任务名称
  - `wfEnName` (String): 任务名称
  - `approvalObjectId` (String): 审批对象标识
  - `approvalObjectTitle` (String): 审批对象标题
  - `approvalObjectType` (String): 审批对象类型
  - `approveStatus` (WfTaskStatusEnum): 审批任务状态
  - `commitPersonId` (Long): 发起人标识
  - `commitPersonCnName` (String): 发起人名称
  - `approvePerson` (String): 办理/审批人组
  - `currNode` (String): 当前所处节点
  - `currNodeName` (String): 当前所处节点名称
  - `currNodeType` (WfFlowContentNodeTypeEnum): 当前节点类型
  - `approveType` (WfFlowApprovalStatusEnum): 最近审批操作类型
  - `taskStartTm` (LocalDateTime): 任务开始时间
  - `taskEndTm` (LocalDateTime): 任务结束时间
  - `filterType` (String): 筛选类型
  - `tenantId` (Long): 租户标识
  - `status` (String): 状态
  - `modifyTm` (LocalDateTime): 最近更新时间
  - `modifier` (Long): 最近更新人标识
  - `modifierCnName` (String): 最近更新人名称


请求示例：

```http
POST /workflow/pageWfInstance?keyWord=sample&filterType=sample&approvalObjectId=sample&approvalObjectTitle=sample&approvalObjectType=sample&appCode=sample&moduleCode=sample&sysClass=sample&moduleClass=sample&tenantId=1&userId=1&approveStatus=sample&pageNum=1&pageSize=1 HTTP/1.1
```

响应示例：

```json
{
  "pageNum": 1,
  "pageSize": 10,
  "total": 1,
  "dataList": [
    {
      "wfInstanceId": 1,
      "wfBaseDefObjectId": 1,
      "wfBaseDefFileId": 1,
      "wfDefDeployInstanceId": 1,
      "appCode": "sample",
      "moduleCode": "sample",
      "sysClass": "sample",
      "moduleClass": "sample",
      "wfCnName": "sample",
      "wfEnName": "sample",
      "approvalObjectId": "sample",
      "approvalObjectTitle": "sample",
      "approvalObjectType": "sample",
      "approveStatus": "sample",
      "commitPersonId": 1,
      "commitPersonCnName": "sample",
      "approvePerson": "sample",
      "currNode": "sample",
      "currNodeName": "sample",
      "currNodeType": "sample",
      "approveType": "sample",
      "taskStartTm": "2026-04-03 12:00:00",
      "taskEndTm": "2026-04-03 12:00:00",
      "filterType": "sample",
      "tenantId": 1,
      "status": "sample",
      "modifyTm": "2026-04-03 12:00:00",
      "modifier": 1,
      "modifierCnName": "sample"
    }
  ]
}
```

### POST /workflow/cancelWfInstance

接口描述：

流程撤销

请求入参：

- 无请求体，参数见请求 URL。

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /workflow/cancelWfInstance?wfInstanceId=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /workflow/statusWfInstance

接口描述：

根据审批对象标识模糊查询实例状态

请求入参：

- `approvalObjectIds` (List<String>，query 参数): 审批对象标识集合

响应出参：

- 返回类型: `JSONResult<Map<String, WfInstanceStatusApiVO>>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Map<String, WfInstanceStatusApiVO>`。


请求示例：

```http
POST /workflow/statusWfInstance?approvalObjectIds=sample HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": {
    "sampleKey": "sampleValue"
  }
}
```

### POST /workflow/statusWfInstanceLk

接口描述：

根据审批对象标识查询实例状态

请求入参：

- `approvalObjectIdLks` (List<String>，query 参数): 审批对象标识集合

响应出参：

- 返回类型: `JSONResult<Map<String, WfInstanceStatusApiVO>>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Map<String, WfInstanceStatusApiVO>`。


请求示例：

```http
POST /workflow/statusWfInstanceLk?approvalObjectIdLks=sample HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": {
    "sampleKey": "sampleValue"
  }
}
```

### POST /workflow/countStatusWfInstance

接口描述：

流程状态总数

请求入参：

- 无请求体，参数见请求 URL。

响应出参：

- 返回类型: `JSONResult<Long>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Long`。


请求示例：

```http
POST /workflow/countStatusWfInstance?approvalObjectIdLk=sample&approvalObjectTypeLk=sample&appCode=sample&moduleCode=sample&sysClass=sample&moduleClass=sample&approveStatus=sample&tenantId=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": 1
}
```

### POST /workflow/deleteStatusWfInstance

接口描述：

删除状态实例

请求入参：

- 无请求体，参数见请求 URL。

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /workflow/deleteStatusWfInstance?approvalObjectIdLk=sample&approvalObjectTypeLk=sample&appCode=sample&moduleCode=sample&sysClass=sample&moduleClass=sample&approveStatus=sample&tenantId=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```


## 工作流审批历史

### POST /workflow/approve/his

接口描述：

审批历史: 指定工作流实例审批历史信息

请求入参：

- 无请求体，参数见请求 URL。

响应出参：

- 返回类型: `JSONResult<List<WfInstanceApproveHisApiVO>>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `List<WfInstanceApproveHisApiVO>`。


请求示例：

```http
POST /workflow/approve/his?wfInstanceId=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": [
    {
      "wfTaskInsApproveHistoryId": 1,
      "wfInstanceApproveHisId": 1,
      "orderNo": 1,
      "nodeId": "sample",
      "nodeName": "sample",
      "nodeType": {},
      "approveType": {},
      "approvePersonId": 1,
      "approvePersonCnName": "sample",
      "approveOpinion": "sample",
      "approveAttachment": "sample",
      "startTm": "2026-04-03 12:00:00",
      "endTm": "2026-04-03 12:00:00",
      "description": "sample"
    }
  ]
}
```


## 工作流节点

### POST /workflow/node/get

接口描述：

待办任务详情

请求入参：

- 无请求体，参数见请求 URL。

响应出参：

- 返回类型: `JSONResult<WfInstanceNodeApiVO>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `WfInstanceNodeApiVO`。
  - `wfInstanceId` (Long): 工作流实例标识
  - `wfInstanceNodeId` (Long): 工作流实例节点标识
  - `wfDefDeployInstanceId` (Long): 工作流定义部署实例标识
  - `wfTaskTitle` (String): 工作流任务标题
  - `filterType` (String): 筛选类型
  - `approvePersonId` (Long): 审批人标识
  - `approvePersonCnName` (String): 审批人名称
  - `wfTaskNode` (String): 工作流任务节点
  - `nodeName` (String): 节点名称
  - `sysClass` (String): 系统分类
  - `moduleClass` (String): 模块分类
  - `appCode` (String): 应用编码
  - `moduleCode` (String): 模块编码
  - `nodeType` (String): 节点类型
  - `multiPersonApprovalAttribute` (String): 多人审批类型
  - `approveType` (String): 审批类型
  - `status` (String): 状态
  - `approveOpinion` (String): 审批意见
  - `approveAttachmentUrl` (String): 审批附件url
  - `nodeStartTm` (LocalDateTime): 节点开始时间
  - `nodeEndTm` (LocalDateTime): 节点结束时间
  - `approvalObjectId` (String): 审批对象标识
  - `approvalObjectTitle` (String): 审批对象标题
  - `approvalObjectType` (String): 审批对象类型
  - `wfTaskOrder` (Integer): 任务序号
  - `tenantId` (Long): 租户标识
  - `creator` (Long): 记录创建人
  - `createTm` (LocalDateTime): 记录创建时间
  - `modifier` (Long): 记录修改人
  - `modifyTm` (LocalDateTime): 记录修改时间
  - `ifDelete` (String): 是否删除
  - `commitPersonId` (Long): 提交人标识
  - `commitPersonCnName` (String): 提交人名称


请求示例：

```http
POST /workflow/node/get?wfInstanceNodeId=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": {
    "wfInstanceId": 1,
    "wfInstanceNodeId": 1,
    "wfDefDeployInstanceId": 1,
    "wfTaskTitle": "sample",
    "filterType": "sample",
    "approvePersonId": 1,
    "approvePersonCnName": "sample",
    "wfTaskNode": "sample",
    "nodeName": "sample",
    "sysClass": "sample",
    "moduleClass": "sample",
    "appCode": "sample",
    "moduleCode": "sample",
    "nodeType": "sample",
    "multiPersonApprovalAttribute": "sample",
    "approveType": "sample",
    "status": "sample",
    "approveOpinion": "sample",
    "approveAttachmentUrl": "sample",
    "nodeStartTm": "2026-04-03 12:00:00",
    "nodeEndTm": "2026-04-03 12:00:00",
    "approvalObjectId": "sample",
    "approvalObjectTitle": "sample",
    "approvalObjectType": "sample",
    "wfTaskOrder": 1,
    "tenantId": 1,
    "creator": 1,
    "createTm": "2026-04-03 12:00:00",
    "modifier": 1,
    "modifyTm": "2026-04-03 12:00:00",
    "ifDelete": "sample",
    "commitPersonId": 1,
    "commitPersonCnName": "sample"
  }
}
```

### POST /workflow/node/sign/before

接口描述：

办理：任务节点前置加签

请求入参：

- 无请求体，参数见请求 URL。

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /workflow/node/sign/before?wfInstanceNodeId=1&signPersonId=1&signPersonTenantId=1&approveOpinion=sample&approveAttachmentUrl=sample HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /workflow/node/sign/after

接口描述：

办理：任务节点后置加签

请求入参：

- 无请求体，参数见请求 URL。

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /workflow/node/sign/after?wfInstanceNodeId=1&signPersonId=1&signPersonTenantId=1&approveOpinion=sample&approveAttachmentUrl=sample HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /workflow/node/assign

接口描述：

办理：转交工作流实例

请求入参：

- 无请求体，参数见请求 URL。

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /workflow/node/assign?wfInstanceNodeId=1&assignUserId=1&assignTenantId=1&approveOpinion=sample&approveAttachmentUrl=sample HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /workflow/node/complete

接口描述：

办理：通过任务审批

请求入参：

- 无请求体，参数见请求 URL。

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /workflow/node/complete?wfInstanceNodeId=1&approveOpinion=1&approveAttachmentUrl=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /workflow/node/reject

接口描述：

办理：驳回任务审批

请求入参：

- 无请求体，参数见请求 URL。

响应出参：

- 返回类型: `JSONResult<Boolean>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Boolean`。


请求示例：

```http
POST /workflow/node/reject?wfInstanceNodeId=1&approveOpinion=sample&approveAttachmentUrl=sample HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": true
}
```

### POST /workflow/node/count

接口描述：

我的待办任务总数

请求入参：

- 无请求体，参数见请求 URL。

响应出参：

- 返回类型: `JSONResult<Long>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `Long`。


请求示例：

```http
POST /workflow/node/count?keyWord=sample&filterType=sample&approvalObjectId=sample&approvalObjectTitle=sample&approvalObjectType=sample&appCode=sample&moduleCode=sample&sysClass=sample&moduleClass=sample&tenantId=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": 1
}
```

### POST /workflow/node/page

接口描述：

我的待办

请求入参：

- 无请求体，参数见请求 URL。

响应出参：

- 返回类型: `PageResult<WfInstanceNodeApiVO>`
- 顶层字段: `pageNum`、`pageSize`、`total`、`dataList`。
- `dataList`: `WfInstanceNodeApiVO` 列表。
  - `wfInstanceId` (Long): 工作流实例标识
  - `wfInstanceNodeId` (Long): 工作流实例节点标识
  - `wfDefDeployInstanceId` (Long): 工作流定义部署实例标识
  - `wfTaskTitle` (String): 工作流任务标题
  - `filterType` (String): 筛选类型
  - `approvePersonId` (Long): 审批人标识
  - `approvePersonCnName` (String): 审批人名称
  - `wfTaskNode` (String): 工作流任务节点
  - `nodeName` (String): 节点名称
  - `sysClass` (String): 系统分类
  - `moduleClass` (String): 模块分类
  - `appCode` (String): 应用编码
  - `moduleCode` (String): 模块编码
  - `nodeType` (String): 节点类型
  - `multiPersonApprovalAttribute` (String): 多人审批类型
  - `approveType` (String): 审批类型
  - `status` (String): 状态
  - `approveOpinion` (String): 审批意见
  - `approveAttachmentUrl` (String): 审批附件url
  - `nodeStartTm` (LocalDateTime): 节点开始时间
  - `nodeEndTm` (LocalDateTime): 节点结束时间
  - `approvalObjectId` (String): 审批对象标识
  - `approvalObjectTitle` (String): 审批对象标题
  - `approvalObjectType` (String): 审批对象类型
  - `wfTaskOrder` (Integer): 任务序号
  - `tenantId` (Long): 租户标识
  - `creator` (Long): 记录创建人
  - `createTm` (LocalDateTime): 记录创建时间
  - `modifier` (Long): 记录修改人
  - `modifyTm` (LocalDateTime): 记录修改时间
  - `ifDelete` (String): 是否删除
  - `commitPersonId` (Long): 提交人标识
  - `commitPersonCnName` (String): 提交人名称


请求示例：

```http
POST /workflow/node/page?keyWord=sample&filterType=sample&approvalObjectId=sample&approvalObjectTitle=sample&approvalObjectType=sample&appCode=sample&moduleCode=sample&sysClass=sample&moduleClass=sample&tenantId=1&pageNum=1&pageSize=1 HTTP/1.1
```

响应示例：

```json
{
  "pageNum": 1,
  "pageSize": 10,
  "total": 1,
  "dataList": [
    {
      "wfInstanceId": 1,
      "wfInstanceNodeId": 1,
      "wfDefDeployInstanceId": 1,
      "wfTaskTitle": "sample",
      "filterType": "sample",
      "approvePersonId": 1,
      "approvePersonCnName": "sample",
      "wfTaskNode": "sample",
      "nodeName": "sample",
      "sysClass": "sample",
      "moduleClass": "sample",
      "appCode": "sample",
      "moduleCode": "sample",
      "nodeType": "sample",
      "multiPersonApprovalAttribute": "sample",
      "approveType": "sample",
      "status": "sample",
      "approveOpinion": "sample",
      "approveAttachmentUrl": "sample",
      "nodeStartTm": "2026-04-03 12:00:00",
      "nodeEndTm": "2026-04-03 12:00:00",
      "approvalObjectId": "sample",
      "approvalObjectTitle": "sample",
      "approvalObjectType": "sample",
      "wfTaskOrder": 1,
      "tenantId": 1,
      "creator": 1,
      "createTm": "2026-04-03 12:00:00",
      "modifier": 1,
      "modifyTm": "2026-04-03 12:00:00",
      "ifDelete": "sample",
      "commitPersonId": 1,
      "commitPersonCnName": "sample"
    }
  ]
}
```


## 工作流步骤

### POST /workflow/step/list

接口描述：

根据工作流实例标识查询工作流实例步骤

请求入参：

- 无请求体，参数见请求 URL。

响应出参：

- 返回类型: `JSONResult<List<WfInstanceStepApiVO>>`
- 顶层字段: `success`、`msg`、`data`。
- `data`: `List<WfInstanceStepApiVO>`。


请求示例：

```http
POST /workflow/step/list?wfInstanceId=1 HTTP/1.1
```

响应示例：

```json
{
  "success": true,
  "msg": "success",
  "data": [
    {
      "wfInstanceStepId": 1,
      "wfInstanceId": 1,
      "orderNo": 1,
      "nodeId": "sample",
      "nodeName": "sample",
      "nodeType": {},
      "status": {},
      "approvePerson": "sample",
      "startTm": "2026-04-03 12:00:00",
      "endTm": "2026-04-03 12:00:00"
    }
  ]
}
```


---

## 资产盘点系统 — 审批能力落地整理

以下仅保留调用 BASE 接口示例。各占位符含义见 `01-开发环境配置.md` 第 5、6 节。

### 公共请求头

```http
Authorization: Bearer {access_token}
Cookie: seabox_acc_token={access_token}; access_token={access_token}
Content-Type: application/json
```

### 1. 发起审批

```http
POST /workflow/submit HTTP/1.1
Authorization: Bearer {access_token}
Cookie: seabox_acc_token={access_token}; access_token={access_token}
Content-Type: application/json
```

```json
{
  "wfBaseDefFileId": {WF_BASE_DEF_FILE_ID},
  "approvalObjectId": "{record.id}",
  "approvalObjectTitle": "{xxxx审批} - {ID} - {Name}",
  "approvalObjectType": "{APPROVAL_OBJECT_TYPE}",
  "approvalFormData": [
    { "wfParamName": "approveType", "wfParamCnName": "审批类型", "wfParamValue": "{APPROVE_TYPE}" },
    { "wfParamName": "appCode", "wfParamCnName": "应用编码", "wfParamValue": "{appCode}" },
    { "wfParamName": "moduleCode", "wfParamCnName": "模块编码", "wfParamValue": "{moduleCode}" },
    { "wfParamName": "Id", "wfParamCnName": "编号", "wfParamValue": "{ID}" }
  ]
}
```

```json
{ "success": true, "msg": "success", "data": "{wfInstanceId}" }
```

### 2. 待审批列表

```http
POST /workflow/node/page?approvalObjectType={APPROVAL_OBJECT_TYPE}&keyWord=&tenantId={tenantId}&pageNum=1&pageSize=10 HTTP/1.1
Authorization: Bearer {access_token}
Cookie: seabox_acc_token={access_token}; access_token={access_token}
```

```json
{
  "total": "1",
  "pageSize": "10",
  "pageNum": "1",
  "dataList": []
}
```

### 3. 我发起的审批列表 / 已关闭审批列表

```http
POST /workflow/pageMyWfInstance?approvalObjectType={APPROVAL_OBJECT_TYPE}&keyWord=&tenantId={tenantId}&pageNum=1&pageSize=10 HTTP/1.1
Authorization: Bearer {access_token}
Cookie: seabox_acc_token={access_token}; access_token={access_token}
```

```json
{
  "total": "1",
  "pageSize": "10",
  "pageNum": "1",
  "dataList": []
}
```

### 4. 审批通过

```http
POST /workflow/node/complete?wfInstanceNodeId={wfInstanceNodeId}&approveOpinion= HTTP/1.1
Authorization: Bearer {access_token}
Cookie: seabox_acc_token={access_token}; access_token={access_token}
```

```json
{ "success": true, "msg": "success", "data": true }
```

### 5. 审批驳回

```http
POST /workflow/node/reject?wfInstanceNodeId={wfInstanceNodeId}&approveOpinion= HTTP/1.1
Authorization: Bearer {access_token}
Cookie: seabox_acc_token={access_token}; access_token={access_token}
```

```json
{ "success": true, "msg": "success", "data": true }
```
