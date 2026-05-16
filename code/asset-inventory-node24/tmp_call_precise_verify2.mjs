import fs from 'fs'
const payload = {
  message: '帮我搜索比亚迪、东风、奇瑞的配套供应商',
  selectedTools: ['db_chat','local_kb','web_search'],
  kbIds: ['kb-1777456851339-410de6'],
  selectedDbTables: ['main.supplier_profiles','main.gas_supplier_profiles','main.gas_suppliers'],
  topK: 8,
  dbTopK: 20,
  finalTopN: 8,
  executionMode: 'fast',
  model: 'gpt-5.4'
}
const ctl = new AbortController();
setTimeout(() => ctl.abort(), 180000)
const res = await fetch('http://127.0.0.1:3000/api/agents/precise-sourcing/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer dev' },
  body: JSON.stringify(payload),
  signal: ctl.signal,
})
const txt = await res.text()
fs.writeFileSync('tmp_precise_verify_response2.json', txt, 'utf8')
console.log(res.status)
const j = JSON.parse(txt)
const e = j?.data?.evidence || {}
console.log('db', Array.isArray(e.suppliers)?e.suppliers.length:0, 'rag', Array.isArray(e.kbHits)?e.kbHits.length:0, 'web', Array.isArray(e.webHits)?e.webHits.length:0)
console.log('web provider', j?.data?.queryStatements?.web?.effectiveSearchTool, j?.data?.queryStatements?.web?.provider)
