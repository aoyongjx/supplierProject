# 人脸数据集下载链接（中国明星人脸数据集）

https://ai-studio-online.bj.bcebos.com/v1/f568330bae63474db1497733fb06447d460d1a4800954e8899fd0c5d9353e6e7?responseContentDisposition=attachment%3Bfilename%3Dfaces.zip&authorization=bce-auth-v1%2FALTAKzReLNvew3ySINYJ0fuAMN%2F2026-04-15T06%3A37%3A13Z%2F60%2F%2F31c88c258916fb79b90f0f22a084afa577c08a165cc779c65d43eb82d915dafc

# 利用AI生成使用pgvector进行人脸比对的完整应用提示词


## 一次性主提示词（完整版）

你是一个资深全栈工程师，请帮我从 0 到 1 生成一个可在本地直接运行的人脸识别检索 Web 应用。

### 1. 目标功能
- 我有一个本地人脸数据集：每个人一个文件夹，文件夹名是人物姓名，里面是该人物多张照片。
- 需要将人脸图片向量化后存入 PostgreSQL 的 pgvector。
- 提供一个 Web 页面：上传图片后识别是谁。
- 使用 SQL Top-K 检索：`ORDER BY embedding <=> :query_vec LIMIT k`。
- 识别结果要展示：
  - 人物姓名
  - 相似度/距离
  - Top-K 候选
  - 每个候选的照片
  - 命中人物在数据库里的其他照片
  - 查询图片的 embedding 向量
- 页面左侧增加“数据库已有数据”列表，显示姓名 + 头像缩略图。

### 2. 技术约束
- 后端：Python + FastAPI
- 前端：HTML/CSS/JavaScript
- 数据库：PostgreSQL + pgvector
- 人脸检测：RetinaFace
- 人脸向量：ArcFace
- 要求在 Windows 本地可运行
- 创建独立虚拟环境（Python 3.12）

### 3. 数据库连接（脱敏模板）
请使用环境变量，不要把真实账号密码硬编码到代码里。

```env
DB_HOST=10.1.1.113
DB_PORT=7300
DB_NAME=training_exercises
DB_SCHEMA=****
DB_USER=***
DB_PASSWORD=***
```

### 4. 初始化脚本要求
需要将人脸数据集向量化后存入数据库中，编写对应的脚本并自动执行

### 5. 页面布局要求
- 左侧：数据库已有数据（姓名 + 头像）
- 中间：Face Identity Search（上传、Top-K、阈值、提交）
- 右侧：上传预览
- 下方（中+右）：识别结果（更宽）
- 美观、简洁、现代感；移动端可自适应

### 6. API 契约要求
至少包含：
- `GET /api/health`
- `GET /api/people`
- `POST /api/recognize`

其中 `POST /api/recognize` 返回：
- `matched`
- `message`
- `query_embedding`
- `best_match`
- `candidates`

### 7. 交付要求
请直接输出完整项目文件


README 里必须给出：
- 虚拟环境创建与激活命令
- 依赖安装命令
- 服务启动命令
- 页面访问地址
- 初始化脚本执行命令

### 8. 异常处理要求
- 数据库不可用时，不要让服务直接崩溃；页面应可打开并返回明确错误。
- 上传空文件、图片解码失败、人脸未检测到时，要返回清晰提示。

---

## 精简版提示词（快速）

请帮我生成一个 FastAPI + 纯 JS 的人脸识别检索应用：
- 使用 RetinaFace 检测 + ArcFace 向量
- 向量存 PostgreSQL pgvector（schema: demo_vector）
- 支持上传图片并用 `ORDER BY embedding <=> :query_vec LIMIT k` 做 Top-K 检索
- 返回并展示：姓名、相似度、Top-K 候选（带候选照片）、命中人物其他照片、query embedding
- 左侧显示数据库已有人物（姓名+头像）
- 提供初始化脚本：扫描 faces 目录，每人仅前 5 张入库
- 前端三栏布局（左已有数据，中上传控制，右预览；下方结果更宽）
- 输出完整可运行代码 + README
- 数据库账号密码仅用环境变量，示例使用脱敏：`DB_USER=***`、`DB_PASSWORD=***`

---

## 使用建议
- 先用“完整版提示词”生成第一版。
- 再补一条追问让 AI 做 UI 微调或性能优化。
