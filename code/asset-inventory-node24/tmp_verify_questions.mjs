import fs from 'fs'
const qs = [
'筛选动力电池/电芯相关供应商，返回企业名称、主营产品、质量体系、数据来源。',
'筛选电驱电控相关供应商，返回企业名称、配套客户信息、认证信息、来源链接。',
'筛选IGBT/功率半导体相关供应商，返回企业名称、产品类别、认证信息、联系方式与来源。',
'筛选具备IATF16949或ISO9001认证的汽车零部件供应商，返回企业名称、认证信息、主营产品、来源。',
'筛选有配套客户记录的传感器相关供应商，返回企业名称、配套关系、主营产品、来源。',
'筛选具备生产基地信息且有认证记录的供应商，返回企业名称、生产基地、认证体系、来源。',
'筛选BMS/电池管理系统相关供应商，返回企业名称、主营产品、认证信息、来源。',
'筛选可联系（联系方式不为空）且有配套信息的供应商，返回企业名称、联系方式、配套关系、来源。'
]
const base={selectedTools:['db_chat','local_kb','web_search'],kbIds:['kb-1777456851339-410de6'],selectedDbTables:['main.supplier_profiles','main.gas_supplier_profiles','main.gas_suppliers'],topK:4,dbTopK:12,finalTopN:6,executionMode:'fast',model:'gpt-5.4'}
const out=[]
for (const q of qs){
  const ctl=new AbortController(); setTimeout(()=>ctl.abort(),70000)
  const item={q}
  try{
    const res=await fetch('http://127.0.0.1:3000/api/agents/precise-sourcing/chat',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer dev'},body:JSON.stringify({...base,message:q}),signal:ctl.signal})
    item.status=res.status
    const txt=await res.text()
    if(res.ok){
      const j=JSON.parse(txt); const e=j?.data?.evidence||{}
      const db=Array.isArray(e.suppliers)?e.suppliers.length:0
      const rag=Array.isArray(e.kbHits)?e.kbHits.length:0
      const web=Array.isArray(e.webHits)?e.webHits.length:0
      item.hits={db,rag,web}
      item.ok = db>0 && rag>0 && web>0
    } else item.err=txt.slice(0,200)
  }catch(err){ item.err=String(err?.name||'')+':'+String(err?.message||err)}
  out.push(item)
  console.log(q, JSON.stringify(item.hits||item.err))
}
fs.writeFileSync('tmp_verified_questions.json',JSON.stringify(out,null,2),'utf8')
