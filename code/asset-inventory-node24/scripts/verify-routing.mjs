const BASE_URL = process.env.VERIFY_BASE_URL || 'http://127.0.0.1:3000'
const AUTH_TOKEN = process.env.VERIFY_AUTH_TOKEN || 'dev'
const MODEL = process.env.VERIFY_MODEL || 'gpt-5.4'

const testCases = [
  {
    name: 'identity',
    message: '你是谁',
    expectDirect: true,
    expectWebEnrich: false,
  },
  {
    name: 'math',
    message: '1+1等于几',
    expectDirect: true,
    expectWebEnrich: false,
  },
  {
    name: 'weekday',
    message: '今天是星期几',
    expectDirect: true,
    expectWebEnrich: false,
  },
  {
    name: 'complex-web',
    message: '帮我找比亚迪IGBT供应商，并给出公开网页线索',
    expectDirect: false,
    expectWebEnrich: true,
  },
  {
    name: 'complex-db-kb',
    message: '查询宁德时代热管理相关供应商，优先数据库和知识库',
    expectDirect: false,
    expectWebEnrich: true,
  },
]

function isDirectIntent(intent) {
  return String(intent || '').trim() === 'direct_answer'
}

async function postJson(path, body) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${AUTH_TOKEN}`,
    },
    body: JSON.stringify(body),
  })
  const json = await response.json().catch(() => ({}))
  return { response, json }
}

async function runChatCase(test) {
  const started = Date.now()
  const { response, json } = await postJson('/api/agents/precise-sourcing/chat', {
    message: test.message,
    model: MODEL,
    selectedTools: ['db_chat', 'local_kb', 'web_search'],
    enablePostEnrichment: false,
    temperature: 0.2,
  })
  const data = json?.data || {}
  const intent = String(data?.intent || '')
  const direct = isDirectIntent(intent)
  const pass = response.ok && direct === test.expectDirect
  return {
    type: 'chat',
    name: test.name,
    message: test.message,
    status: response.status,
    latencyMs: Date.now() - started,
    intent,
    expectDirect: test.expectDirect,
    pass,
    answerPreview: String(data?.answer || '').replace(/\s+/g, ' ').slice(0, 80),
  }
}

async function runStreamCase(test) {
  const response = await fetch(`${BASE_URL}/api/agents/precise-sourcing/chat-stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${AUTH_TOKEN}`,
    },
    body: JSON.stringify({
      message: test.message,
      model: MODEL,
      selectedTools: ['db_chat', 'local_kb', 'web_search'],
      enablePostEnrichment: false,
      fastWebAsync: true,
      temperature: 0.2,
    }),
  })
  if (!response.ok || !response.body) {
    return {
      type: 'stream',
      name: test.name,
      status: response.status,
      expectWebEnrich: test.expectWebEnrich,
      sawWebEnrich: false,
      finalIntent: '',
      pass: false,
    }
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let sawWebEnrich = false
  let finalIntent = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const blocks = buffer.split('\n\n')
    buffer = blocks.pop() || ''
    for (const block of blocks) {
      const lines = block.split('\n')
      const eventLine = lines.find((line) => line.startsWith('event:'))
      const dataLine = lines.find((line) => line.startsWith('data:'))
      const eventName = eventLine ? eventLine.slice(6).trim() : ''
      let data = {}
      try {
        data = JSON.parse(dataLine ? dataLine.slice(5).trim() : '{}')
      } catch {
        data = {}
      }
      if (eventName === 'heartbeat' && String(data?.message || '').includes('开始WEB后台补全')) {
        sawWebEnrich = true
      }
      if (eventName === 'final') {
        finalIntent = String(data?.intent || '')
      }
    }
  }
  return {
    type: 'stream',
    name: test.name,
    status: response.status,
    expectWebEnrich: test.expectWebEnrich,
    sawWebEnrich,
    finalIntent,
    pass: sawWebEnrich === test.expectWebEnrich,
  }
}

async function checkHealth() {
  const response = await fetch(`${BASE_URL}/api/health`)
  return response.ok
}

async function main() {
  const healthy = await checkHealth().catch(() => false)
  if (!healthy) {
    console.error(`[verify-routing] 服务不可用：${BASE_URL}/api/health`)
    process.exit(1)
  }
  const chatResults = []
  for (const test of testCases) {
    chatResults.push(await runChatCase(test))
  }
  const streamTargets = [testCases[0], testCases[3], testCases[4]]
  const streamResults = []
  for (const test of streamTargets) {
    streamResults.push(await runStreamCase(test))
  }
  const allResults = [...chatResults, ...streamResults]
  for (const row of allResults) {
    console.log(`[${row.type}] ${row.name} | pass=${row.pass} | status=${row.status}${row.intent ? ` | intent=${row.intent}` : ''}${row.finalIntent ? ` | final=${row.finalIntent}` : ''}`)
  }
  const failed = allResults.filter((x) => !x.pass)
  if (failed.length > 0) {
    console.error(`\n[verify-routing] 失败 ${failed.length} 项`)
    process.exit(2)
  }
  console.log(`\n[verify-routing] 全部通过：${allResults.length} 项`)
}

main().catch((error) => {
  console.error('[verify-routing] 异常:', error?.message || error)
  process.exit(1)
})
