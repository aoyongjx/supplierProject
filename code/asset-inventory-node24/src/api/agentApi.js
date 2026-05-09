import { clearTokens, getAccessToken } from '../auth/token'

function buildAuthHeaders() {
  const token = getAccessToken() || import.meta.env.VITE_AUTH_TOKEN || ''
  return token ? { Authorization: `Bearer ${token}` } : {}
}

const directApiBase = (import.meta.env.VITE_API_DIRECT_BASE || 'http://localhost:3000').replace(/\/+$/, '')

async function requestWithFallback(path, init = {}) {
  const primary = async () => fetch(path, init)
  const fallback = async () => fetch(`${directApiBase}${path}`, init)
  try {
    const response = await primary()
    if (response.status === 502 || response.status === 503 || response.status === 504) return await fallback()
    return response
  } catch {
    return await fallback()
  }
}

async function parseJson(response) {
  const payload = await response.json().catch(() => ({}))
  if (response.status === 401) {
    clearTokens()
    if (window.location.pathname !== '/login') window.location.replace('/login')
    throw new Error(payload.message || '登录已失效，请重新登录')
  }
  if (!response.ok) throw new Error(payload.message || `请求失败（HTTP ${response.status}）`)
  return payload
}

export async function chatPreciseSourcingAgent(payload = {}) {
  const response = await requestWithFallback('/api/agents/precise-sourcing/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...buildAuthHeaders() },
    body: JSON.stringify(payload || {}),
  })
  const result = await parseJson(response)
  return result.data
}

export async function chatPreciseSourcingAgentStream(payload = {}, handlers = {}) {
  const { onStart, onTrace, onFinal, onError, onDone, onHeartbeat, onDelta } = handlers || {}
  const tokenHeaders = buildAuthHeaders()
  const response = await requestWithFallback('/api/agents/precise-sourcing/chat-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...tokenHeaders },
    body: JSON.stringify(payload || {}),
  })
  if (!response.ok || !response.body) {
    const payloadJson = await response.json().catch(() => ({}))
    // 流式入口失败时也降级到非流式，避免直接抛 502
    const fallback = await chatPreciseSourcingAgent(payload).catch(() => null)
    if (fallback && typeof onFinal === 'function') onFinal(fallback)
    if (typeof onDone === 'function') onDone({ ok: Boolean(fallback), degraded: true, reason: payloadJson.message || `HTTP ${response.status}` })
    if (!fallback) throw new Error(payloadJson.message || `请求失败（HTTP ${response.status}）`)
    return
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  const emit = (event, data) => {
    if (event === 'start' && typeof onStart === 'function') onStart(data)
    if (event === 'trace' && typeof onTrace === 'function') onTrace(data)
    if (event === 'delta' && typeof onDelta === 'function') onDelta(data)
    if (event === 'final' && typeof onFinal === 'function') onFinal(data)
    if (event === 'error' && typeof onError === 'function') onError(data)
    if (event === 'heartbeat' && typeof onHeartbeat === 'function') onHeartbeat(data)
    if (event === 'done' && typeof onDone === 'function') onDone(data)
  }
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const chunks = buffer.split('\n\n')
      buffer = chunks.pop() || ''
      for (const chunk of chunks) {
        const lines = chunk.split('\n')
        let eventName = 'message'
        let dataText = ''
        for (const line of lines) {
          if (line.startsWith('event:')) eventName = line.slice(6).trim()
          if (line.startsWith('data:')) dataText += line.slice(5).trim()
        }
        if (!dataText) continue
        try {
          emit(eventName, JSON.parse(dataText))
        } catch {
          emit(eventName, { raw: dataText })
        }
      }
    }
  } catch (error) {
    if (typeof onError === 'function') onError({ message: `流式连接中断：${error?.message || 'unknown error'}` })
    // 流式失败时降级到非流式，避免用户只看到 502/断流
    const fallback = await chatPreciseSourcingAgent(payload).catch(() => null)
    if (fallback && typeof onFinal === 'function') onFinal(fallback)
    if (typeof onDone === 'function') onDone({ ok: Boolean(fallback), degraded: true })
  }
}
