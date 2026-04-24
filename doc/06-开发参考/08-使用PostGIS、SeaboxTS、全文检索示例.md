

## 地图页面生成提示词

请连接项目开发文档中的数据库，读取 `demo_nyc` schema，使用 PostGIS 查询空间数据并实现一个 NYC 地图导航页：后端提供地图数据 API，将 `geometry` 通过 `ST_Transform(..., 4326)` 和 `ST_AsGeoJSON` 转成 GeoJSON，前端使用 Leaflet 展示社区边界、道路、地铁站、凶案点位、停车计费器等图层，并提供图层开关、要素点击详情、基础统计和响应式布局。

可补充要求：

```text
地图数据必须使用 PostGIS，不要在前端硬编码坐标；尽量在 SQL 中做几何简化以控制返回体积，例如 ST_SimplifyPreserveTopology；点数据可用 ST_MakePoint(longitude, latitude) 生成；页面需要加入导航入口。
```

## 股票 K 线页面生成提示词

请连接项目开发文档中的数据库，读取 `demo_stock.all_stocks_5yr` 股票 OHLCV 数据，使用 SeaboxTS/TimescaleDB 兼容函数实现一个股票 K 线导航页：后端提供股票概览和历史 K 线 API，历史数据用 `time_bucket`、`first(open, time)`、`last(close, time)`、`max(high)`、`min(low)`、`sum(volume)` 聚合生成日线、周线、30日线，前端使用 lightweight-charts 展示蜡烛图、成交量、均线、股票选择、时间范围和周期切换。

可补充要求：

```text
股票时序聚合必须使用 SeaboxTS，不要只在前端处理原始日线；如果 time_bucket 不支持 month/year interval，则用 30 days 替代月线；注意 trade_date 如为 text 需显式 cast 为 timestamp；页面需要加入导航入口。
```

## 文档检索页面生成提示词

请连接项目开发文档中的数据库，读取 `demo_doc.sino_news` 新闻数据，实现一个文档检索导航页：搜索首页做成类似百度/谷歌的极简搜索框，输入关键词后进入结果页，点击结果进入详情页；后端基于 `search_vector @@ to_tsquery('jiebacfg', keyword)` 做正文全文检索，同时支持标题匹配，返回命中摘要、分类、标题、时间和分页信息，前端对标题和摘要中的命中词做高亮，并提供搜索候选词下拉、上一页/下一页和详情页返回原搜索页。

可补充要求：

```text
search_vector 当前只索引 content，所以标题需要额外匹配；不要固定截取正文开头作为摘要，应根据命中词截取上下文；对于 jiebacfg 分词后的词元，要把数据库实际解析出的 tsquery 词元也返回给前端用于高亮；全文检索时不要使用 `order by` 排序；结果页需要分页，建议用 limit + 1 判断 hasNext，避免每次 count(*)。
```
