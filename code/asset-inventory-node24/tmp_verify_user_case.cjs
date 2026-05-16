const fs=require('fs');
const p='src/pages/PreciseSourcingAgentPage.jsx';
const s=fs.readFileSync(p,'utf8');
const m=s.match(/function normalizeLlmMarkdownForRender\(text = ''\) \{([\s\S]*?)\n\}\n\nfunction markdownChildrenToText/);
const fn=new Function('text', m[1]+'\nreturn s;');
const input='【RAG参考】\n1. 关于规范中央企业采购管理工作的指导意见.docx | 相似度=0.5157\n2. https://www.mee.gov.cn/ywgz/fgbz/fl/201404/t20140425_271040.shtml | 相似度=0.5071\n5. https://www.mee.gov.cn/ywgz/fgbz/fl/201404/t20140425_271040.shtml | 相似度=0.4901歌恩电子（上海）有限公司|当前上下文中仅此家有直接证据||东风|**证据不足/待核验**|当前召回上下文里没有明确指向东风配套客户|---##明确不足/待核验1.东风配套供应商证据缺失2.rerankReason对象不可读---##下一步检索建议1.东风定向检索2.修复序列化---##建议优先跟进名单|优先级|供应商|推荐原因|建议切入点||---|---|---|---||高|麦歌恩电子（上海）有限公司|同时命中比亚迪、奇瑞|传感器类询价||低|其余候选|当前缺乏足够证据支撑|不建议直接进入短名单|';
console.log(fn(input));
