const fs = require('fs');
const p = 'src/pages/PreciseSourcingAgentPage.jsx';
const s = fs.readFileSync(p, 'utf8');
const m = s.match(/function normalizeLlmMarkdownForRender\(text = ''\) \{([\s\S]*?)\n\}\n\nfunction markdownChildrenToText/);
if (!m) {
  console.error('extract failed');
  process.exit(1);
}
const body = m[1];
const fn = new Function('text', body + '\nreturn s;');
const input = [
  '##建议优先跟进名单 | 优先级 | 供应商 | 推荐原因 | 建议切入点',
  '——',
  '｜ 高 ｜ 麦歌恩电子（上海）有限公司 ｜ 同时命中比亚迪、奇瑞 ｜ 传感器类询价 ｜｜ 中 ｜ 富临精工股份有限公司 ｜ rerank靠前 ｜ 客户关系移验再接触 ｜｜ 低 ｜ 其余候选 ｜ 证据不足 ｜ 不建议直推',
  '##可选图表建议',
  '图1: xxx'
].join('\n');
const out = fn(input);
console.log(out);
