const fs=require('fs');
const p='src/pages/PreciseSourcingAgentPage.jsx';
const s=fs.readFileSync(p,'utf8');
const m=s.match(/function normalizeLlmMarkdownForRender\(text = ''\) \{([\s\S]*?)\n\}\n\nfunction markdownChildrenToText/);
const fn=new Function('text', m[1]+'\nreturn s;');
const input='##RAG参考\n1. a.docx | 相似度=0.5157\n2. https://x.com | 相似度=0.49\n##明确不足/待核验\n1. 东风证据缺失\n2. rerankReason对象不可读\n##下一步检索建议\n1. 东风定向检索\n2. 修复对象序列化';
console.log(fn(input));
