import fs from 'fs'
const j = JSON.parse(fs.readFileSync('tmp_precise_verify_response.json','utf8'))
const d = j?.data || {}
const e = d?.evidence || {}
const db = Array.isArray(e.suppliers)? e.suppliers : []
const rag = Array.isArray(e.kbHits)? e.kbHits : []
const web = Array.isArray(e.webHits)? e.webHits : []
const ragNames = [...new Set(rag.flatMap(x => [...(Array.isArray(x.supplierCandidates)?x.supplierCandidates:[]), ...(Array.isArray(x._supplierCandidates)?x._supplierCandidates:[]) ]).filter(Boolean))]
const webNames = [...new Set(web.flatMap(x => [...(Array.isArray(x.supplierCandidates)?x.supplierCandidates:[]), ...(Array.isArray(x._supplierCandidates)?x._supplierCandidates:[]) ]).filter(Boolean))]
console.log(JSON.stringify({
  dbHits: db.length,
  ragHits: rag.length,
  webHits: web.length,
  dbSample: db.slice(0,5).map(x=>x.companyName||x.company_name||x.name),
  ragSupplierCount: ragNames.length,
  ragSample: ragNames.slice(0,5),
  webSupplierCount: webNames.length,
  webSample: webNames.slice(0,5)
}, null, 2))
