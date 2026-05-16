import fs from 'fs'
const qs = [
'帮我搜索比亚迪、东风、奇瑞的配套供应商',
'帮我搜索比亚迪、奇瑞的动力电池配套供应商',
'帮我搜索比亚迪、东风的IGBT功率半导体配套供应商',
'帮我搜索东风、奇瑞的传感器配套供应商'
]
const base={selectedTools:['db_chat','local_kb','web_search'],kbIds:['kb-1777456851339-410de6'],selectedDbTables:['main.supplier_profiles','main.gas_supplier_profiles','main.gas_suppliers'],topK:5,dbTopK:15,finalTopN:8,executionMode:'fast',model:'gpt-5.4'}
const out=[]
for (const q of qs){
  const ctl=new AbortController(); setTimeout(()=>ctl.abort(),260000)
  const item={q}
  try{
    const res=await fetch('http://127.0.0.1:3000/api/agents/precise-sourcing/chat',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer dev'},body:JSON.stringify({...base,message:q}),signal:ctl.signal})
    item.status=res.status
    const txt=await res.text()
    if(res.ok){
      const j=JSON.parse(txt); const e=j?.data?.evidence||{}
      item.hits={db:Array.isArray(e.suppliers)?e.suppliers.length:0, rag:Array.isArray(e.kbHits)?e.kbHits.length:0, web:Array.isArray(e.webHits)?e.webHits.length:0}
      item.webTool=j?.data?.queryStatements?.web?.effectiveSearchTool || ''
    } else item.err=txt.slice(0,200)
  }catch(err){ item.err=String(err?.name||'')+':'+String(err?.message||err)}
  out.push(item)
  console.log(JSON.stringify(item))
}
fs.writeFileSync('tmp_verified_short_queries.json',JSON.stringify(out,null,2),'utf8')
