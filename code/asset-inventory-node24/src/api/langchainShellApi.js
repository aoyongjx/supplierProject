import { clearTokens, getAccessToken } from '../auth/token'

function buildAuthHeaders() {
  const token = getAccessToken() || import.meta.env.VITE_AUTH_TOKEN || ''
  return token ? { Authorization: `Bearer ${token}` } : {}
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

export async function sendLangchainChat(payload) {
  const response = await fetch('/api/langchain/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...buildAuthHeaders() },
    body: JSON.stringify(payload || {}),
  })
  const result = await parseJson(response)
  return result.data
}

export async function fetchLangchainTools() {
  const response = await fetch('/api/langchain/tools', {
    method: 'GET',
    headers: { ...buildAuthHeaders() },
  })
  const result = await parseJson(response)
  return Array.isArray(result.data) ? result.data : []
}

export async function fetchLangchainModels() {
  const response = await fetch('/api/langchain/models', {
    method: 'GET',
    headers: { ...buildAuthHeaders() },
  })
  const result = await parseJson(response)
  return result.data || { platform: 'openai', models: [] }
}

export async function sendLangchainRagChat(payload) {
  const response = await fetch('/api/langchain/rag-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...buildAuthHeaders() },
    body: JSON.stringify(payload || {}),
  })
  const result = await parseJson(response)
  return result.data
}

export async function fetchLangchainSessionState(chatType = 'multi_chat') {
  const query = new URLSearchParams({ chatType: String(chatType || 'multi_chat') })
  const response = await fetch(`/api/langchain/session-state?${query.toString()}`, {
    method: 'GET',
    headers: { ...buildAuthHeaders() },
  })
  const result = await parseJson(response)
  return result.data || { sessions: [{ name: 'default', messages: [] }], currentSession: 'default' }
}

export async function saveLangchainSessionState(payload) {
  const response = await fetch('/api/langchain/session-state', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...buildAuthHeaders() },
    body: JSON.stringify(payload || {}),
  })
  const result = await parseJson(response)
  return result.data || { sessions: [{ name: 'default', messages: [] }], currentSession: 'default' }
}
