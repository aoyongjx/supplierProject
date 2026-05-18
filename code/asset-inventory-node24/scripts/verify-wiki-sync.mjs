const baseUrl = process.env.WIKI_SYNC_BASE_URL || 'http://127.0.0.1:3000'
const authToken = process.env.WIKI_SYNC_AUTH_TOKEN || 'dev'
const timeoutMs = Number(process.env.WIKI_SYNC_TIMEOUT_MS || 120000)
const pollMs = Number(process.env.WIKI_SYNC_POLL_MS || 2000)

const tableNames = [
  'supplier_base_info',
  'knowledge_base_document',
  'crawl_info',
  'supplier_profile',
  'supply_chain_node',
  'gas_supply_chain_node',
  'supplier_profile_customer_item',
  'supplier_profile_product_case_item',
  'supplier_profile_financing_item',
  'supplier_profile_software_copyright_item',
  'supplier_profile_patent_item',
  'supplier_profile_admin_license_item',
  'supplier_profile_admin_license_gs_item',
  'supplier_profile_trade_credit_item',
  'supplier_profile_court_notice_item',
  'supplier_profile_production_base_item',
  'supplier_profile_news_item',
  'supplier_profile_equipment_item',
]

function log(text) {
  console.log(`[verify-wiki-sync] ${text}`)
}

async function run() {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${authToken}`,
  }
  const payload = {
    limit: 200,
    tableNames,
    enableEntityExtract: true,
    enableConceptExtract: true,
    enableOverview: true,
  }

  const startedAt = Date.now()
  const startRes = await fetch(`${baseUrl}/api/llm-wiki/sync/db`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })
  const startJson = await startRes.json().catch(() => ({}))
  const taskId = startJson?.data?.id
  if (!startRes.ok || !taskId) {
    throw new Error(`启动同步失败: HTTP ${startRes.status} ${JSON.stringify(startJson)}`)
  }
  log(`taskId=${taskId}`)

  let finalTask = null
  let lastLine = ''
  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, pollMs))
    const tasksRes = await fetch(`${baseUrl}/api/llm-wiki/sync-tasks?limit=20`, { headers })
    const tasksJson = await tasksRes.json().catch(() => ({}))
    const row = (Array.isArray(tasksJson?.data) ? tasksJson.data : []).find((x) => String(x.id) === String(taskId))
    if (!row) continue

    const summary = row.summary || {}
    const line = `status=${row.status} stage=${summary.stage || ''} p=${summary.stageProgress || 0} processed=${summary.processed || 0} total=${row.totalCount || summary.totalCount || 0} ins=${row.insertedCount || 0} upd=${row.updatedCount || 0}`
    if (line !== lastLine) {
      log(line)
      lastLine = line
    }

    const status = String(row.status || '')
    if (status === 'success' || status === 'failed' || status === 'cancelled') {
      finalTask = row
      break
    }
  }

  if (!finalTask) {
    throw new Error(`超时: ${timeoutMs}ms 内未结束`)
  }

  const elapsed = Date.now() - startedAt
  if (String(finalTask.status) !== 'success') {
    throw new Error(`任务失败: status=${finalTask.status}, error=${finalTask.errorMessage || ''}`)
  }
  if (elapsed > timeoutMs) {
    throw new Error(`耗时超限: ${elapsed}ms > ${timeoutMs}ms`)
  }
  const total = Number(finalTask.totalCount || 0)
  const inserted = Number(finalTask.insertedCount || 0)
  const updated = Number(finalTask.updatedCount || 0)
  if (total <= 0) {
    throw new Error(`无有效处理量: total=${total}`)
  }
  if (inserted + updated <= 0) {
    throw new Error(`新增/更新计数异常: inserted=${inserted}, updated=${updated}`)
  }

  log(`PASS elapsed=${elapsed}ms total=${total} inserted=${inserted} updated=${updated}`)
}

run().catch((error) => {
  log(`FAIL ${error.message || error}`)
  process.exitCode = 1
})
