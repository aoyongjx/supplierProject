const fs = require('fs');
const p = 'src/pages/PreciseSourcingAgentPage.jsx';
const s = fs.readFileSync(p,'utf8');
const m = s.match(/function normalizeLlmMarkdownForRender\(text = ''\) \{([\s\S]*?)\n\}\n\nfunction markdownChildrenToText/);
if(!m){console.error('extract failed');process.exit(1)}
const fn = new Function('text', m[1] + '\nreturn s;');
const input = '5. https://www.mee.gov.cn/ywgz/fgbz/fl/201404/t20140425_271040.shtml | 相似度=0.4901\n6. https://example.com/a | 相似度=0.5123\\n##可选图表建议-图1: 按主机厂分组 图2: 按证据强度';
const out = fn(input);
console.log(out);
