import fs from 'fs'
const payload = {
  message: '帮我搜索比亚迪、东风、奇瑞的配套供应商',
  selectedTools: ['db_chat','local_kb','web_search'],
  kbIds: ['kb-1777456851339-410de6'],
  selectedDbTables: ['main.supplier_profiles','main.gas_supplier_profiles','main.gas_suppliers'],
  topK: 20,
  dbTopK: 30,
  finalTopN: 10,
  executionMode: 'fast',
  model: 'gpt-5.4'
}
const res = await fetch('http://127.0.0.1:3000/api/agents/precise-sourcing/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer dev' },
  body: JSON.stringify(payload)
})
const txt = await res.text()
fs.writeFileSync('tmp_precise_verify_response.json', txt, 'utf8')
console.log(res.status)
console.log(txt.slice(0, 1200))
