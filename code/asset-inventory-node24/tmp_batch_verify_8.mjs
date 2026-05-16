import fs from 'fs'
const queries = [
'筛选主营阀类零部件且有认证信息记录的供应商，返回企业名称、认证信息、联系方式、主营产品与数据来源。',
'筛选主营“IGBT功率半导体及电动化芯片”的供应商，返回配套客户、产品类别、经营信息（规模/营收字段）、来源链接。',
'筛选“ADAS辅助驾驶”相关供应商，且有“技术与专利”记录，返回专利关键词、数量字段、生产基地与来源。',
'筛选“电芯”相关供应商，且有质量体系（IATF/ISO）和生产基地信息，返回综合评分与资质排序。关键词：汽车供应商 配套客户 认证 生产基地 专利。',
'请对“电磁阀、IGBT功率半导体及电动化芯片”两类供应商做组合寻源，返回同时满足“有认证+有配套信息+可联系”的企业清单。关键词：汽车供应商 配套客户 认证 生产基地 专利。',
'请对已筛出的候选企业做寻源分析：按企业评分、资质排序、产品配套、生产基地、技术与专利、质量与口碑输出Top10，并标注每条结论来源。',
'请筛选“有直接配套客户或间接配套客户记录”的ADAS/电芯相关供应商，并输出配套关系、认证体系、经营信息完整度。',
'请筛选“经营信息+认证信息+专利信息”三项都不为空的功率半导体/电磁阀供应商，输出优先推荐名单与推荐依据。'
]

const payloadBase = {
  selectedTools: ['db_chat','local_kb','web_search'],
  kbIds: ['kb-1777456851339-410de6'],
  selectedDbTables: ['main.supplier_profiles','main.gas_supplier_profiles','main.gas_suppliers'],
  topK: 5,
  dbTopK: 15,
  finalTopN: 8,
  executionMode: 'fast',
  model: 'gpt-5.4'
}

const out = []
const save = () => fs.writeFileSync('tmp_batch_verify_8.json', JSON.stringify(out,null,2), 'utf8')
for (let i=0;i<queries.length;i++) {
  const q = queries[i]
  const payload = { ...payloadBase, message: q }
  const ctl = new AbortController();
  setTimeout(()=>ctl.abort(), 90000)
  const item = { index:i+1, query:q }
  try {
    const res = await fetch('http://127.0.0.1:3000/api/agents/precise-sourcing/chat', {
      method:'POST', headers:{'Content-Type':'application/json', Authorization:'Bearer dev'}, body: JSON.stringify(payload), signal: ctl.signal,
    })
    item.httpStatus = res.status
    const txt = await res.text()
    if (res.ok) {
      const j = JSON.parse(txt)
      const d = j?.data || {}
      const e = d?.evidence || {}
      const db = Array.isArray(e.suppliers)?e.suppliers:[]
      const rag = Array.isArray(e.kbHits)?e.kbHits:[]
      const web = Array.isArray(e.webHits)?e.webHits:[]
      const ragNames = [...new Set(rag.flatMap(x=>[...(Array.isArray(x.supplierCandidates)?x.supplierCandidates:[]),...(Array.isArray(x._supplierCandidates)?x._supplierCandidates:[]) ]).filter(Boolean))]
      const webNames = [...new Set(web.flatMap(x=>[...(Array.isArray(x.supplierCandidates)?x.supplierCandidates:[]),...(Array.isArray(x._supplierCandidates)?x._supplierCandidates:[]) ]).filter(Boolean))]
      item.metrics = { dbHits: db.length, ragHits: rag.length, webHits: web.length, ragSupplierCount: ragNames.length, webSupplierCount: webNames.length }
      item.samples = { db: db.slice(0,5).map(x=>x.companyName||x.company_name||x.name||''), rag: ragNames.slice(0,8), web: webNames.slice(0,8) }
      item.webTool = d?.queryStatements?.web || {}
      item.answerHead = String(d?.answer || '').slice(0, 500)
    } else {
      item.error = txt.slice(0,1200)
    }
  } catch (err) {
    item.error = String(err?.name || '') + ':' + String(err?.message || err)
  }
  out.push(item)
  save()
  console.log('done', i+1, item.httpStatus || item.error)
}
save()
