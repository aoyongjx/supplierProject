# SeaboxSQL函数和插件说明

## 文档用途

用于记录公司自研 SeaboxSQL 中可直接使用的函数、插件和扩展能力。

本文件只作为能力参考，不重复项目建表规范和项目级数据库设计。

## 用户说明

每位用户的用户名、密码、schema 名称三者相同（初始密码即用户名）。  
用户登录后 `search_path` 已自动设置为自己的 schema，同时具有以下共享 schema 的读取权限：

**共享只读 Schema 列表：**
- `demo_northwind` - 北风贸易数据库示例
- `demo_northwind_dm` - 北风贸易数据仓库示例
- `demo_nyc` - 纽约市交通数据集
- `demo_supermarket` - 超市销售数据集
- `demo_vector` - 向量检索示例数据集
- `demo_doc` - 文档检索示例数据集
- `demo_stock` - 股票市场数据集

这些共享 schema 主要用于培训和学习，可以直接读取其中的数据表，但不允许修改或删除。

以下示例统一用 `zhangsan` 代指用户名，使用时替换为自己的用户名即可。

**已安装组件：**

| 组件 | 用途 |
|------|------|
| SeaboxTS | 时序数据引擎（TimescaleDB 兼容，内置） |
| PostGIS | 空间地理数据处理 |
| pg_jieba | 中文分词全文检索（结巴分词） |
| sdcnparser | 中文分词全文检索（备选解析器） |
| Apache AGE | 图数据库（Cypher 查询语言） |
| MADlib | 数据库内机器学习 |
| pgvector | 向量存储与相似度检索 |

---

## 连接数据库

```bash
psql -h 10.1.1.113 -p 7300 -U zhangsan -d training_exercises
# 密码与用户名相同
```

连接后确认当前 schema：

```sql
SHOW search_path;
-- 应返回 zhangsan, ag_catalog, madlib, public
```

---

## 一、SeaboxTS 时序引擎

> SeaboxTS 是本库内置的时序引擎，与 TimescaleDB API 兼容，无需 `CREATE EXTENSION`，直接使用。

### 验证可用性

```sql
SELECT time_bucket('1 hour', NOW());
-- 正常返回当前小时的时间戳即表示可用
```

### 创建超表

```sql
CREATE TABLE sensor_data (
    time        TIMESTAMPTZ      NOT NULL,
    sensor_id   INT              NOT NULL,
    temperature DOUBLE PRECISION,
    humidity    DOUBLE PRECISION
);

-- 转换为超表，按 time 列自动分区
SELECT create_hypertable('sensor_data', 'time');
```

### 写入与查询

```sql
-- 批量插入测试数据
INSERT INTO sensor_data (time, sensor_id, temperature, humidity)
SELECT
    NOW() - (i || ' minutes')::INTERVAL,
    (i % 5) + 1,
    20 + random() * 10,
    50 + random() * 20
FROM generate_series(1, 1000) AS i;

-- 按时间范围查询
SELECT time, sensor_id, temperature
FROM sensor_data
WHERE time > NOW() - INTERVAL '1 hour'
ORDER BY time DESC
LIMIT 20;

-- 时间桶聚合（每10分钟均值）
SELECT
    time_bucket('10 minutes', time) AS bucket,
    sensor_id,
    AVG(temperature) AS avg_temp,
    MAX(humidity)    AS max_hum
FROM sensor_data
WHERE time > NOW() - INTERVAL '3 hours'
GROUP BY bucket, sensor_id
ORDER BY bucket DESC;
```

### first / last 聚合

```sql
SELECT
    sensor_id,
    last(temperature, time)  AS latest_temp,
    first(temperature, time) AS earliest_temp
FROM sensor_data
GROUP BY sensor_id;
```

### 连续聚合

```sql
CREATE MATERIALIZED VIEW sensor_hourly
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS bucket,
    sensor_id,
    AVG(temperature) AS avg_temp,
    COUNT(*)         AS cnt
FROM sensor_data
GROUP BY bucket, sensor_id;

-- 手动刷新
CALL refresh_continuous_aggregate('sensor_hourly', NULL, NULL);

SELECT * FROM sensor_hourly ORDER BY bucket DESC LIMIT 10;
```

### 数据压缩

```sql
ALTER TABLE sensor_data SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'sensor_id'
);

SELECT add_compression_policy('sensor_data', INTERVAL '7 days');

-- 查看压缩状态
SELECT * FROM chunk_compression_stats('sensor_data');
```

---

## 二、PostGIS 空间扩展

### 验证可用性

```sql
SELECT PostGIS_Version();
-- 返回版本号即表示可用，如 2.5 USE_GEOS=1 ...
```

### 创建空间表

```sql
CREATE TABLE locations (
    id   SERIAL PRIMARY KEY,
    name TEXT,
    geom GEOMETRY(Point, 4326)
);

CREATE INDEX locations_geom_idx ON locations USING GIST (geom);
```

### 写入与查询

```sql
INSERT INTO locations (name, geom) VALUES
    ('北京', ST_SetSRID(ST_MakePoint(116.4074, 39.9042), 4326)),
    ('上海', ST_SetSRID(ST_MakePoint(121.4737, 31.2304), 4326)),
    ('广州', ST_SetSRID(ST_MakePoint(113.2644, 23.1291), 4326)),
    ('成都', ST_SetSRID(ST_MakePoint(104.0665, 30.5723), 4326));

-- 计算距离（公里）
SELECT
    a.name AS from_city,
    b.name AS to_city,
    ROUND(ST_Distance(a.geom::GEOGRAPHY, b.geom::GEOGRAPHY)::NUMERIC / 1000, 2) AS km
FROM locations a, locations b
WHERE a.name = '北京' AND b.name != '北京';

-- 查找距北京1500公里以内的城市
SELECT name FROM locations
WHERE ST_DWithin(
    geom::GEOGRAPHY,
    ST_SetSRID(ST_MakePoint(116.4074, 39.9042), 4326)::GEOGRAPHY,
    1500000
);
```

### 常用函数速查

| 函数 | 说明 |
|------|------|
| `ST_MakePoint(lon, lat)` | 创建点 |
| `ST_Distance(a, b)` | 两点距离 |
| `ST_DWithin(a, b, r)` | 是否在半径 r 内 |
| `ST_Contains(a, b)` | a 是否包含 b |
| `ST_Intersects(a, b)` | 是否相交 |
| `ST_Area(geom)` | 面积 |
| `ST_AsText(geom)` | 转 WKT 文本 |
| `ST_GeomFromText(wkt)` | WKT 转几何 |

---

## 三、pg_jieba 中文分词

### 验证可用性

```sql
SELECT tokid, token FROM ts_parse('jieba', '自然语言处理很有趣');
-- 正常返回分词结果即表示可用
```

### 内置分词配置

pg_jieba 已预置以下 4 种分词配置，无需管理员额外创建，直接使用：

| 配置名 | 对应解析器 | 说明 |
|--------|-----------|------|
| `jiebacfg` | jieba | 精确模式（默认推荐） |
| `jiebamp`  | jiebamp | 最大概率模式 |
| `jiebahmm` | jiebahmm | HMM 隐马尔可夫模式 |
| `jiebaqry` | jiebaqry | 搜索引擎模式（切词更细） |

### 建表与全文索引

```sql
CREATE TABLE articles (
    id      SERIAL PRIMARY KEY,
    title   TEXT,
    content TEXT,
    tsv     TSVECTOR
);

INSERT INTO articles (title, content) VALUES
    ('人工智能发展', '深度学习和自然语言处理推动了人工智能的快速发展'),
    ('数据库技术',   'PostgreSQL是一款功能强大的开源关系型数据库'),
    ('机器学习入门', '机器学习是人工智能的重要分支，包括监督学习和无监督学习');

UPDATE articles
SET tsv = to_tsvector('jiebacfg', title || ' ' || content);

CREATE INDEX articles_tsv_idx ON articles USING GIN (tsv);

-- 全文搜索
SELECT title FROM articles
WHERE tsv @@ to_tsquery('jiebacfg', '人工智能');

-- 带排名
SELECT title, ts_rank(tsv, query) AS rank
FROM articles, to_tsquery('jiebacfg', '机器学习') AS query
WHERE tsv @@ query
ORDER BY rank DESC;
```

### 直接分词

```sql
-- 精确模式
SELECT tokid, token FROM ts_parse('jieba', 'PostgreSQL数据库中文全文检索');

-- 搜索引擎模式（切词更细，适合查询扩展）
SELECT tokid, token FROM ts_parse('jiebaqry', '中华人民共和国成立于1949年');

-- HMM 模式（适合新词发现）
SELECT tokid, token FROM ts_parse('jiebahmm', '自然语言处理很有趣');
```

---

## 四、sdcnparser 中文分词（备选）

> sdcnparser 是 SeaboxSQL 自带的中文分词解析器，用法与 pg_jieba 类似，可作为备选方案。

### 验证可用性

```sql
SELECT extname, extversion FROM pg_extension WHERE extname = 'sdcnparser';
-- 返回行即表示可用
```

### 直接分词

```sql
SELECT tokid, token FROM ts_parse('sdcnparser', '自然语言处理很有趣');
```

### 配置全文搜索

> sdcnparser 无预置配置，需在自己的 schema 下创建一次。

```sql
-- 在自己的 schema 下创建配置（每个用户执行一次）
CREATE TEXT SEARCH CONFIGURATION chinese2 (PARSER = sdcnparser);
ALTER TEXT SEARCH CONFIGURATION chinese2
    ADD MAPPING FOR n, v, a, i, e, l WITH simple;
```

### 使用示例

```sql
CREATE TABLE news (
    id      SERIAL PRIMARY KEY,
    title   TEXT,
    content TEXT,
    tsv     TSVECTOR
);

INSERT INTO news (title, content) VALUES
    ('量子计算突破', '量子计算机在密码学和药物研发领域取得重大突破'),
    ('新能源汽车', '电动汽车销量持续增长，充电基础设施加速建设');

UPDATE news
SET tsv = to_tsvector('chinese2', title || ' ' || content);

CREATE INDEX news_tsv_idx ON news USING GIN (tsv);

-- 全文搜索
SELECT title FROM news
WHERE tsv @@ to_tsquery('chinese2', '量子计算');
```

### pg_jieba vs sdcnparser 对比

| 特性 | pg_jieba | sdcnparser |
|------|----------|------------|
| 分词算法 | 结巴分词 | SeaboxSQL 内置 |
| 自定义词典 | 支持 | 依赖内置词典 |
| 配置名（示例） | `chinese` | `chinese2` |
| 适用场景 | 通用中文分词 | SeaboxSQL 原生场景 |

---

## 五、Apache AGE 图数据库

### 验证可用性

```sql
SELECT extname, extversion FROM pg_extension WHERE extname = 'age';
-- 返回 age 及版本号即表示可用
```

### 创建图与节点

```sql
-- 每个用户创建自己的图，图名建议加用户名前缀避免冲突
SELECT ag_catalog.create_graph('zhangsan_graph');

-- 使用 Cypher 语法创建节点
SELECT * FROM ag_catalog.cypher('zhangsan_graph', $$
    CREATE (:Person {name: '张三', age: 30})
    CREATE (:Person {name: '李四', age: 25})
    CREATE (:Person {name: '王五', age: 35})
    CREATE (:Company {name: 'ABC科技', industry: '互联网'})
$$) AS (result agtype);
```

### 创建关系

```sql
SELECT * FROM ag_catalog.cypher('zhangsan_graph', $$
    MATCH (a:Person {name: '张三'}), (b:Person {name: '李四'})
    CREATE (a)-[:KNOWS {since: 2020}]->(b)
$$) AS (result agtype);

SELECT * FROM ag_catalog.cypher('zhangsan_graph', $$
    MATCH (p:Person {name: '张三'}), (c:Company {name: 'ABC科技'})
    CREATE (p)-[:WORKS_AT {role: '工程师'}]->(c)
$$) AS (result agtype);
```

### 查询图数据

```sql
-- 查询所有 Person
SELECT * FROM ag_catalog.cypher('zhangsan_graph', $$
    MATCH (p:Person) RETURN p.name AS name, p.age AS age
$$) AS (name agtype, age agtype);

-- 查询关系
SELECT * FROM ag_catalog.cypher('zhangsan_graph', $$
    MATCH (a:Person)-[r:KNOWS]->(b:Person)
    RETURN a.name AS from, b.name AS to, r.since AS since
$$) AS (from agtype, to agtype, since agtype);

-- 两跳路径：张三认识的人所在的公司
SELECT * FROM ag_catalog.cypher('zhangsan_graph', $$
    MATCH (a:Person {name: '张三'})-[:KNOWS]->(b:Person)-[:WORKS_AT]->(c:Company)
    RETURN b.name AS person, c.name AS company
$$) AS (person agtype, company agtype);
```

### Cypher 语法速查

| 操作 | 语法 |
|------|------|
| 创建节点 | `CREATE (n:Label {key: value})` |
| 创建关系 | `CREATE (a)-[:REL]->(b)` |
| 匹配节点 | `MATCH (n:Label) WHERE n.key = val` |
| 更新属性 | `SET n.key = value` |
| 删除节点 | `DETACH DELETE n` |
| 计数 | `RETURN count(n)` |
| 最短路径 | `MATCH p=shortestPath((a)-[*]-(b))` |

---

## 六、MADlib 机器学习

> MADlib 函数位于 `madlib` schema，已在 `search_path` 中，可直接调用。

### 验证可用性

```sql
SELECT madlib.version();
-- 返回版本信息即表示可用
```

### 线性回归

```sql
-- 准备训练数据
CREATE TABLE house_prices (
    id     SERIAL,
    area   FLOAT,   -- 面积（平方米）
    rooms  FLOAT,   -- 房间数
    price  FLOAT    -- 价格（万元）
);

INSERT INTO house_prices (area, rooms, price) VALUES
    (80,  2, 150), (100, 3, 200), (120, 3, 240),
    (150, 4, 310), (60,  1, 100), (200, 5, 420),
    (90,  2, 170), (130, 3, 260), (110, 3, 210);

-- 训练线性回归模型（结果写入自己的 schema）
SELECT madlib.linregr_train(
    'house_prices',
    'zhangsan.lr_model',         -- 输出到自己的 schema
    'price',
    'ARRAY[1, area, rooms]'      -- 1 为截距项
);

-- 查看模型系数
SELECT unnest(ARRAY['intercept','area','rooms']) AS feature,
       unnest(coef) AS coefficient
FROM zhangsan.lr_model;

-- 预测：面积140㎡、3室的房价
SELECT madlib.linregr_predict(
    ARRAY[1, 140, 3],
    coef
) AS predicted_price
FROM zhangsan.lr_model;
```

### 逻辑回归

```sql
CREATE TABLE customer_data (
    id      SERIAL,
    age     FLOAT,
    income  FLOAT,
    bought  INT     -- 1=购买，0=未购买
);

INSERT INTO customer_data (age, income, bought) VALUES
    (25, 3000, 0), (35, 8000, 1), (45, 12000, 1),
    (22, 2500, 0), (50, 15000, 1), (30, 5000, 0),
    (40, 9000, 1), (28, 4000, 0), (55, 18000, 1);

-- 训练逻辑回归
SELECT madlib.logregr_train(
    'customer_data',
    'zhangsan.logr_model',
    'bought',
    'ARRAY[1, age, income]',
    NULL, 20, 'irls'
);

-- 预测购买概率
SELECT madlib.logregr_predict_prob(
    ARRAY[1, 38, 7500],
    coef
) AS buy_probability
FROM zhangsan.logr_model;
```

### K-Means 聚类

```sql
-- 准备数据
CREATE TABLE points AS
SELECT i AS id,
       (random() * 100)::FLOAT AS x,
       (random() * 100)::FLOAT AS y
FROM generate_series(1, 200) AS i;

-- 运行 K-Means（分3类）
SELECT madlib.kmeans_random(
    'points',
    'ARRAY[x, y]',
    3
);
```

---

## 七、pgvector 向量检索

> pgvector 扩展名为 `vector`，已安装。

### 验证可用性

```sql
SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';
-- 返回 vector 及版本号即表示可用
```

### 创建向量表

```sql
-- 1536 维向量（适配 OpenAI text-embedding-ada-002 等模型）
CREATE TABLE embeddings (
    id      SERIAL PRIMARY KEY,
    content TEXT,
    vec     VECTOR(1536)
);

-- IVFFlat 近似最近邻索引
CREATE INDEX embeddings_vec_idx
ON embeddings USING ivfflat (vec vector_cosine_ops)
WITH (lists = 100);
```

### 写入与相似度查询

```sql
-- 插入示例（实际 vec 由嵌入模型生成，此处用随机向量演示）
INSERT INTO embeddings (content, vec)
SELECT
    '文档' || i,
    ('[' || array_to_string(
        ARRAY(SELECT (random() * 2 - 1)::TEXT FROM generate_series(1, 1536)),
        ','
    ) || ']')::VECTOR(1536)
FROM generate_series(1, 100) AS i;

-- 余弦相似度最近邻查询（找最相似的5条）
SELECT content,
       1 - (vec <=> (SELECT vec FROM embeddings WHERE id = 1)) AS similarity
FROM embeddings
WHERE id != 1
ORDER BY vec <=> (SELECT vec FROM embeddings WHERE id = 1)
LIMIT 5;
```

### 距离运算符

| 运算符 | 含义 |
|--------|------|
| `<->` | 欧氏距离（L2） |
| `<#>` | 负内积 |
| `<=>` | 余弦距离 |

