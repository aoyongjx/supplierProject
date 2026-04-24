# TypeScript 通用设计规范（前后端统一版）

## 1. 文档目的

本文档用于统一团队内 TypeScript 项目的工程结构、命名方式、类型建模、错误处理、测试策略、代码评审和工程化约束。

本文档同时作为面向大模型生成代码时的显式执行规则。模型输出必须优先服从本规范，再考虑局部实现偏好。

## 2. 适用范围

- TypeScript 语言层通用规则
- 前端应用
- Node.js 后端服务
- CLI、脚本、构建工具
- 共享协议、共享类型、共享工具包
- AI 辅助开发、代码生成、代码补全、自动修复场景

## 3. 规则等级

本文档采用以下分级：

- `必须`：强制要求，不满足即视为违规
- `应该`：默认遵守；如需例外，必须有明确理由
- `可以`：允许采用，由团队或项目自行判断
- `禁止`：明确不允许

当多条规则冲突时，优先级如下：

1. 安全与数据边界
2. 类型与运行时校验
3. 跨层契约一致性
4. 可测试性与可维护性
5. 代码风格偏好

## 4. 面向大模型执行的总则

### 4.1 基本要求

- 大模型生成 TypeScript 代码时，`必须`先识别目录边界、模块边界和输入输出边界，再开始实现
- 大模型生成跨边界输入输出逻辑时，`必须`先定义 `zod schema`，再编写业务代码
- 大模型生成任何正式代码时，`必须`默认满足 `eslint`、`prettier`、`check-types` 和 `vitest` 的基础要求
- 大模型修改已有代码时，`必须`优先复用现有模式，不得无理由重写成另一种风格
- 大模型生成代码时，`禁止`绕过现有共享契约、自创平行命名体系、自创目录层级

### 4.2 生成顺序

大模型在实现功能时，推荐遵循以下顺序：

1. 确认目录位置与模块归属
2. 定义 `zod schema`
3. 从 `schema` 推导 TypeScript 类型
4. 定义错误码与异常语义
5. 编写业务实现
6. 编写或补充测试
7. 自检 `lint`、`check-types`、`vitest`

### 4.3 禁止事项

- `禁止`先写业务逻辑，再补类型和校验
- `禁止`只写 TypeScript 类型而不做运行时校验
- `禁止`生成裸 `any` 作为快速通路
- `禁止`把一个对象同时当 DTO、领域对象、数据库对象和视图对象使用
- `禁止`因为框架便利而破坏层次边界
- `禁止`为了省事直接吞异常、返回模糊错误或依赖自由文本判断错误类型

## 5. 总体原则

- `必须`优先清晰而不是炫技
- `必须`优先稳定边界而不是临时复用
- `必须`优先显式契约而不是隐式约定
- `必须`优先组合而不是深层继承
- `必须`优先可测试实现而不是一次性脚本式实现
- `应该`优先共享协议与共享规则，不共享耦合实现
- `应该`优先使用小而稳定的模块，而不是超大万能模块
- `可以`在前端项目中优先推荐 Vue，但本文档不强制绑定前端框架
- Node.js 后端 `可以`使用任意框架，但 `必须`满足本文档的分层、契约和校验规则

## 6. 工程结构规范

### 6.1 顶层目录

- 项目 `必须`优先采用 `pnpm workspace`
- 顶层目录 `应该`体现“应用入口、共享能力、工程配置、脚本工具”四类职责，但不强制目录名完全一致
- 可独立运行和发布的程序 `必须`有清晰归属
- 共享契约、共享工具、共享测试能力 `必须`集中管理
- 工程配置 `应该`集中放置，避免散落在各应用内部长期漂移
- 一次性或运维型脚本 `可以`单独存放，但 `禁止`承载正式业务逻辑

推荐按职责分为以下几类，而不是死记某个固定目录树：

- 应用入口层：承载 Web、Server、CLI、Desktop 等可运行单元
- 共享能力层：承载 contracts、shared、testing、utils 等复用单元
- 工程配置层：承载 tsconfig、eslint、prettier、vitest、构建配置等
- 脚本工具层：承载初始化、迁移、发布、检查脚本等

宽模板示例：

```text
.
├─ <runtime-apps>/
├─ <shared-packages>/
├─ <tooling-or-config>/
├─ <scripts>/
├─ package.json
└─ pnpm-workspace.yaml
```

说明：

- `<runtime-apps>` 不要求必须叫 `apps`
- `<shared-packages>` 不要求必须叫 `packages`
- `<tooling-or-config>` 可以拆分，也可以合并
- 只要职责边界清楚，目录名称可以按团队习惯命名

正例：

- 单独维护一处跨端 `schema`、类型、错误码
- 单独维护一处测试工厂、fixture、mock helper
- 将工程规则集中管理，而不是每个子项目各自漂移

反例：

- 在 `code/src` 中直接定义一套仅供后端使用、但和共享契约重复的响应结构
- 在 `code/src` 中复制一份项目中已存在的共享契约类型
- 把所有代码长期堆在单一 `src/` 下且无模块边界
- 目录虽然很多，但职责仍然混乱，无法看出边界归属

### 6.2 应用内目录

- 应用内部 `必须`按职责分层，不得把接口、业务、适配、测试混写
- 前端项目 `应该`至少区分页面编排、组件、状态、服务访问、契约或 schema
- 后端项目 `应该`至少区分接口层、应用编排层、领域层、基础设施层
- `schema` 与 `contract` 文件 `应该`靠近边界层放置，而不是散落在业务细节目录中
- 目录设计 `应该`服务于职责隔离，而不是为了对齐模板而对齐模板

前端宽模板参考：

```text
src/
├─ <app-or-bootstrap>/
├─ <pages-or-features>/
├─ <components>/
├─ <state-or-stores>/
├─ <services-or-clients>/
├─ <schemas-or-contracts>/
└─ main.ts
```

后端宽模板参考：

```text
src/
├─ main.ts
├─ <common-or-shared>/
├─ <modules-or-features>/
│  └─ <domain-module>/
│     ├─ <interface-layer>/
│     ├─ <application-layer>/
│     ├─ <domain-layer>/
│     ├─ <infrastructure-layer>/
│     └─ <schemas-or-contracts>/
└─ <config>/
```

说明：

- 前端不强制 `pages` 或 `features` 二选一，按团队组织方式统一即可
- 后端不强制 `modules` 命名，也不强制必须按框架目录习惯展开
- 重点不是目录名，而是能否一眼看出边界、依赖方向和职责划分

### 6.3 共享包边界

- `packages/contracts` `必须`作为跨端协议单一事实来源
- `packages/shared` `应该`只放纯函数、轻量工具和稳定常量
- `packages/testing` `应该`只用于测试，不得被正式生产代码依赖
- `禁止`前端直接依赖后端实现包
- `禁止`后端直接依赖前端页面层或组件层代码

## 7. 命名规范

### 7.1 通用命名规则

- 文件名和目录名 `必须`使用英文，避免中文、拼音和无语义缩写
- 同一层级 `必须`使用同一命名风格
- 命名 `必须`表达真实职责，不得“名不副实”
- 命名 `应该`优先使用完整单词，避免临时缩写

### 7.2 代码命名

- 类型、类、枚举 `必须`使用 `UpperCamelCase`
- 变量、函数、方法、参数 `必须`使用 `lowerCamelCase`
- 常量 `必须`使用 `UPPER_SNAKE_CASE`
- 布尔变量 `应该`使用 `is`、`has`、`can`、`enabled`、`visible` 等可读语义
- 异步函数 `可以`不加 `Async` 后缀，但名称 `必须`体现动作语义

正例：

```ts
const isExpired = false;

function createUserProfile() {}

type CreateUserRequest = {};

const DEFAULT_PAGE_SIZE = 20;
```

反例：

```ts
const flag = false;

function handleData() {}

type data = {};

const size = 20;
```

### 7.3 文件命名

- 普通 TypeScript 文件 `应该`使用中划线命名
- 组件文件名 `可以`按团队统一约定使用 `UpperCamelCase`，但必须全仓一致
- 测试文件 `必须`显式体现被测对象与测试类型

正例：

- `user-profile-service.ts`
- `create-user.schema.ts`
- `user-service.test.ts`
- `user-service.integration.test.ts`

反例：

- `UserService2.ts`
- `temp.ts`
- `do-user.ts`

### 7.4 类型后缀

- 跨边界输入输出对象 `应该`显式使用稳定后缀
- 推荐后缀：`Request`、`Response`、`Command`、`Query`、`Dto`、`ViewModel`
- `禁止`在同一仓库中混用同义后缀而无规则，例如同义场景同时出现 `Req`、`RequestDto`、`Input`

## 8. 类型设计与 Zod 约束

### 8.1 单一事实来源

- 所有外部输入输出模型 `必须`优先由 `zod schema` 定义
- TypeScript 类型 `必须`从 `schema` 推导，而不是手写一个平行类型
- 运行时校验 `必须`发生在边界层进入业务前

正例：

```ts
import { z } from "zod";

export const createUserSchema = z.object({
  name: z.string().min(1).max(50),
  email: z.string().email(),
});

export type CreateUserRequest = z.infer<typeof createUserSchema>;
```

反例：

```ts
type CreateUserRequest = {
  name: string;
  email: string;
};

function createUser(input: CreateUserRequest) {
  return repository.save(input);
}
```

反例问题：

- 只有编译期约束，没有运行时校验
- 边界层无法统一返回结构化错误
- 后续字段变更容易出现类型与校验脱节

### 8.2 分层建模

- DTO、领域对象、持久化对象、前端展示对象 `必须`分层建模
- `禁止`一个类型贯穿 Controller、Service、Repository、UI
- 前后端共享的仅应是契约对象，不应是实现对象

推荐分层：

- `Request` / `Response`：接口契约层
- `Command` / `Query`：应用编排层
- `Entity` / `ValueObject`：领域层
- `Record` / `Model`：持久化映射层
- `ViewModel`：前端展示层

### 8.3 any 与 unknown

- 正式业务代码中 `禁止`裸 `any`
- 动态输入桥接场景 `应该`优先使用 `unknown`
- 使用 `unknown` 后 `必须`显式收窄或通过 `zod` 解析

正例：

```ts
function parseInput(input: unknown): CreateUserRequest {
  return createUserSchema.parse(input);
}
```

反例：

```ts
function parseInput(input: any): any {
  return input;
}
```

### 8.4 泛型

- 泛型 `应该`服务于复用与约束，不得为了“高级感”滥用
- 泛型命名 `应该`表达语义，如 `TInput`、`TResult`
- 影响可读性的复杂泛型 `应该`拆分为中间类型

## 9. 前后端通用边界规范

### 9.1 前端

- 前端 `必须`把页面编排、交互逻辑、接口访问、契约校验分层处理
- Vue 为推荐方案，但不是强制要求
- 状态管理 `应该`区分服务端状态、页面状态、表单状态
- 表单 `必须`尽量与 `zod schema` 对齐
- `禁止`在页面组件中直接硬编码后端错误码语义而无共享常量

### 9.2 后端

- Node.js 后端框架可自由选择，但 `必须`遵守输入校验、层次边界和错误映射要求
- 控制器或路由层 `必须`负责协议转换和边界校验
- 业务层 `必须`负责业务规则与编排
- 基础设施层 `必须`负责数据库、缓存、消息、文件和外部服务接入
- `禁止`在控制器中直接写复杂业务逻辑

### 9.3 跨端共享

- 错误码、契约、稳定常量 `必须`进入共享包
- 实现细节 `禁止`跨端共享
- 共享包 `应该`保持无框架或弱框架耦合

## 10. 错误码与异常处理规范

### 10.1 总体要求

- 同一模块 `必须`提供稳定错误码
- 错误处理 `必须`区分：
  - 用户输入错误
  - 业务规则错误
  - 外部依赖错误
  - 系统内部错误
- `禁止`依赖自由文本判断错误类型
- `禁止`吞掉异常

### 10.2 错误码设计

- 错误码 `必须`稳定、可搜索、可追踪
- 错误码 `应该`按域分类
- 错误码 `应该`使用字符串常量而不是魔法数字

正例：

```ts
export const ErrorCode = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  USER_NOT_FOUND: "USER_NOT_FOUND",
  EMAIL_ALREADY_USED: "EMAIL_ALREADY_USED",
  EXTERNAL_SERVICE_TIMEOUT: "EXTERNAL_SERVICE_TIMEOUT",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
```

反例：

```ts
throw new Error("邮箱重复");
throw new Error("调用三方超时");
```

### 10.3 异常模型

- 项目 `应该`提供统一基础异常类型
- 自定义异常 `应该`至少包含 `code`、`message`、`details`
- `应该`在边界层统一映射异常，不得四处重复拼装响应

示例：

```ts
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }
}
```

### 10.4 统一错误响应

- HTTP、RPC、CLI、任务执行结果 `应该`尽量遵循统一错误结构
- 最低要求字段：
  - `code`
  - `message`
  - `details`
  - `requestId` 或 `traceId`

示例：

```ts
export const errorResponseSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
  requestId: z.string().optional(),
});

export type ErrorResponse = z.infer<typeof errorResponseSchema>;
```

### 10.5 处理策略

- 可以恢复的异常 `应该`转换为稳定错误响应
- 不可恢复的异常 `必须`记录上下文并上抛到统一边界
- 外部依赖异常 `应该`转换为本域错误码，不得把底层库错误原样透出给用户
- 日志 `禁止`输出密钥、令牌、完整敏感信息

正例：

```ts
try {
  const result = await paymentClient.charge(payload);
  return result;
} catch (error) {
  logger.error({ error, orderId: payload.orderId }, "payment failed");
  throw new AppError("EXTERNAL_SERVICE_TIMEOUT", "支付服务暂时不可用", {
    provider: "payment",
  });
}
```

反例：

```ts
try {
  return await paymentClient.charge(payload);
} catch (error) {
  return null;
}
```

## 11. 测试策略

### 11.1 总体原则

- 测试 `必须`覆盖风险，而不是只覆盖代码行数
- 新功能 `必须`附带与风险相称的测试
- 修复缺陷 `必须`补充回归测试
- AI 生成代码 `必须`自带最低限度的可验证测试或测试建议

### 11.2 测试分层

- 单元测试：覆盖纯函数、领域规则、转换逻辑、错误分支
- 集成测试：覆盖模块协作、数据库、配置装配、外部适配器
- E2E 或关键链路测试：覆盖真实用户路径或核心业务流程

### 11.3 工具约束

- 默认测试框架 `必须`使用 `vitest`
- 前端组件测试 `可以`基于 `vitest` 和对应渲染工具实现
- 后端服务测试 `可以`基于 `vitest` 结合测试容器或轻量桩实现

### 11.4 覆盖重点

以下内容 `必须`优先补测试：

- `zod schema` 的关键边界
- 错误码与异常映射
- 核心业务规则
- 权限判断
- 配置解析
- 外部依赖失败分支
- 历史缺陷修复点

以下内容 `应该`避免只写表面测试：

- 仅断言函数被调用，而不验证结果语义
- 只测成功分支，不测失败分支
- 只测 happy path，不测边界输入

正例：

```ts
import { describe, expect, it } from "vitest";

describe("createUserSchema", () => {
  it("rejects invalid email", () => {
    expect(() =>
      createUserSchema.parse({
        name: "Ada",
        email: "not-an-email",
      }),
    ).toThrow();
  });
});
```

反例：

```ts
it("works", () => {
  expect(true).toBe(true);
});
```

### 11.5 测试文件命名

- 单元测试文件 `必须`使用 `*.test.ts`
- 集成测试文件 `应该`使用 `*.integration.test.ts`
- 关键链路测试 `可以`使用 `*.e2e.test.ts`

### 11.6 AI 生成代码自查要求

大模型在提交代码前，`必须`至少自查以下问题：

1. 是否存在未校验的外部输入
2. 是否存在裸 `any`
3. 是否存在未覆盖的错误分支
4. 是否存在与规范冲突的命名
5. 是否缺少最小测试

## 12. 代码评审标准

### 12.1 评审目标

代码评审的目标不是寻找格式差异，而是确认：

- 契约是否稳定
- 边界是否清晰
- 风险是否被测试覆盖
- 异常路径是否可观测
- 大模型生成内容是否真正遵守规范

### 12.2 必查项

以下项 `必须`纳入评审：

1. 是否使用 `zod` 对外部输入做运行时校验
2. 类型是否从 `schema` 推导，是否存在平行定义
3. 是否破坏目录和模块边界
4. 是否引入裸 `any`、隐式 `any` 或模糊返回值
5. 是否定义稳定错误码
6. 是否补充了必要测试
7. 是否符合 `pnpm`、`eslint`、`prettier`、`check-types`、`vitest` 的门禁要求

### 12.3 应重点质疑的问题

- 这个对象是否承担了过多层次职责
- 这个校验是否放在了正确边界
- 这个错误是否可以被稳定识别
- 这个共享代码是否真的应该共享
- 这段抽象是否降低了理解成本，还是只是显得高级

### 12.4 可以放宽的问题

以下问题 `可以`在不影响一致性的前提下灵活处理：

- 局部实现采用 `type` 还是 `interface`
- 前端是否使用 Vue 相关最佳实践细节
- 后端使用哪种 Node.js 框架

### 12.5 大模型代码专项评审

评审 AI 生成代码时，`应该`额外检查：

- 是否跳过了既有共享包而重复造轮子
- 是否生成了不必要的大而全抽象
- 是否只补 happy path 测试
- 是否把注释写成空洞重复描述
- 是否出现与项目既有风格明显冲突的目录和命名

## 13. 工程化与质量门禁

### 13.1 统一工具链

- 包管理 `必须`使用 `pnpm`
- 前端构建 `推荐`使用 `vite`
- 测试 `必须`使用 `vitest`
- 代码检查 `必须`纳入 `eslint`
- 类型检查 `必须`纳入 `check-types`
- 代码格式化 `必须`纳入 `prettier`

### 13.2 推荐脚本

根目录 `应该`具备以下脚本：

```json
{
  "scripts": {
    "lint": "eslint .",
    "format": "prettier --write .",
    "check-types": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run"
  }
}
```

### 13.3 质量门禁

合并前 `必须`至少满足：

1. `pnpm lint`
2. `pnpm check-types`
3. `pnpm test`

如项目存在前端构建入口，`应该`补充：

4. `pnpm build`

### 13.4 禁止事项

- `禁止`以“本地能跑”替代类型检查
- `禁止`跳过 `check-types` 直接合并
- `禁止`关闭 lint 规则来绕过真实问题
- `禁止`把格式化工具当成代码质量工具本身

## 14. 示例代码模板

### 14.1 契约模板

```ts
import { z } from "zod";

export const createUserRequestSchema = z.object({
  name: z.string().min(1).max(50),
  email: z.string().email(),
});

export const userResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  createdAt: z.string(),
});

export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;
export type UserResponse = z.infer<typeof userResponseSchema>;
```

### 14.2 后端应用服务模板

```ts
import { AppError } from "../errors/app-error";
import { createUserRequestSchema, type CreateUserRequest } from "../../contracts/user-contract";

type CreateUserDeps = {
  userRepository: {
    findByEmail(email: string): Promise<{ id: string } | null>;
    create(input: CreateUserRequest): Promise<{
      id: string;
      name: string;
      email: string;
      createdAt: string;
    }>;
  };
};

export function createUserService(deps: CreateUserDeps) {
  return {
    async execute(input: unknown) {
      const command = createUserRequestSchema.parse(input);

      const existingUser = await deps.userRepository.findByEmail(command.email);
      if (existingUser) {
        throw new AppError("EMAIL_ALREADY_USED", "邮箱已被使用");
      }

      return deps.userRepository.create(command);
    },
  };
}
```

### 14.3 路由或控制器模板

```ts
export async function createUserHandler(req: Request, res: Response) {
  try {
    const result = await createUserService(deps).execute(req.body);
    res.status(201).json(result);
  } catch (error) {
    const response = mapErrorToHttpResponse(error);
    res.status(response.status).json(response.body);
  }
}
```

### 14.4 前端调用模板

```ts
import { userResponseSchema, type CreateUserRequest } from "@repo/contracts/user-contract";

export async function createUser(input: CreateUserRequest) {
  const response = await fetch("/api/users", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  const payload = await response.json();
  return userResponseSchema.parse(payload);
}
```

### 14.5 单元测试模板

```ts
import { describe, expect, it, vi } from "vitest";

describe("createUserService", () => {
  it("throws EMAIL_ALREADY_USED when email exists", async () => {
    const service = createUserService({
      userRepository: {
        findByEmail: vi.fn().mockResolvedValue({ id: "u1" }),
        create: vi.fn(),
      },
    });

    await expect(
      service.execute({
        name: "Ada",
        email: "ada@example.com",
      }),
    ).rejects.toMatchObject({
      code: "EMAIL_ALREADY_USED",
    });
  });
});
```

## 15. 大模型执行清单

在生成或修改 TypeScript 代码前，大模型应按以下顺序自检：

1. 我是否选对了目录与模块
2. 我是否先定义了 `zod schema`
3. 我是否从 `schema` 推导了类型
4. 我是否定义了稳定错误码
5. 我是否避免了裸 `any`
6. 我是否保持了前后端共享边界清晰
7. 我是否补充了最小必要测试
8. 我的命名、目录、脚本是否符合项目统一口径

若任一答案为“否”，应先修正后再输出结果。

## 16. 推荐落地方式

- 将本文档作为团队统一规范
- 将本文档摘要写入项目根目录 `AGENTS.md`、`CONTRIBUTING.md` 或 AI 编码提示词
- 在 PR 模板中加入 `zod`、错误码、测试、自查项清单
- 在 CI 中强制执行 `lint`、`check-types`、`test`

## 17. 一句话总结

TypeScript 项目中的前后端统一规范，不是“大家都写 TS”这么简单，而是：统一边界、统一契约、统一校验、统一错误语义、统一质量门禁，并让大模型在这些边界内稳定地产出代码。
