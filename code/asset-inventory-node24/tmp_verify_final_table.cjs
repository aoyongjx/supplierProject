const fs = require('fs');
const p = 'src/pages/PreciseSourcingAgentPage.jsx';
const s = fs.readFileSync(p,'utf8');
const m = s.match(/function normalizeLlmMarkdownForRender\(text = ''\) \{([\s\S]*?)\n\}\n\nfunction markdownChildrenToText/);
const fn = new Function('text', m[1] + '\nreturn s;');
const input = '##建议优先跟进名单 | 优先级 | 供应商 | 推荐原因 | 建议切入点\n| 高 | A有限公司 | 命中 | 切入 | | 中 | B有限公司 | 命中 | 切入 | | 低 | 其余候选 | 当前缺乏足够证据支持 | 不建议直接进入短名单 |\n##可选图表建议-图1: 按主机厂分组 图2: 四象限';
console.log(fn(input));
