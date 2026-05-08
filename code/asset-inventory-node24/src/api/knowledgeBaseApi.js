import { clearTokens, getAccessToken } from '../auth/token'

function buildAuthHeaders() {
  const token = getAccessToken() || import.meta.env.VITE_AUTH_TOKEN || ''
  return token ? { Authorization: `Bearer ${token}` } : {}
}

const directApiBaseRaw = String(import.meta.env.VITE_API_DIRECT_BASE || '').trim()
const directApiBase = directApiBaseRaw.replace(/\/+$/, '')

function shouldUseDirectFallback() {
  if (!directApiBase) return false
  try {
    const current = new URL(window.location.origin)
    const direct = new URL(directApiBase)
    return current.origin !== direct.origin
  } catch {
    return false
  }
}

async function requestWithFallback(path, init = {}) {
  const primary = async () => fetch(path, init)
  const fallback = async () => fetch(`${directApiBase}${path}`, init)
  const enableFallback = shouldUseDirectFallback()
  try {
    const response = await primary()
    if (enableFallback && response.status === 502) return await fallback()
    return response
  } catch {
    if (enableFallback) return await fallback()
    throw new Error('知识库请求失败：主服务不可达')
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

export async function fetchKnowledgeBases() {
  const response = await requestWithFallback('/api/knowledge-bases', { headers: buildAuthHeaders() })
  const result = await parseJson(response)
  return Array.isArray(result.data) ? result.data : []
}

export async function createKnowledgeBase(payload) {
  const response = await requestWithFallback('/api/knowledge-bases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...buildAuthHeaders() },
    body: JSON.stringify(payload || {}),
  })
  const result = await parseJson(response)
  return result.data
}

export async function updateKnowledgeBase(kbId, payload) {
  const response = await requestWithFallback(`/api/knowledge-bases/${encodeURIComponent(String(kbId))}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...buildAuthHeaders() },
    body: JSON.stringify(payload || {}),
  })
  const result = await parseJson(response)
  return result.data
}

export async function uploadKnowledgeBaseFile(kbId, payload) {
  const response = await requestWithFallback(`/api/knowledge-bases/${encodeURIComponent(String(kbId))}/documents/file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...buildAuthHeaders() },
    body: JSON.stringify(payload || {}),
  })
  const result = await parseJson(response)
  return result.data
}

export async function addKnowledgeBaseWebPage(kbId, url) {
  const response = await requestWithFallback(`/api/knowledge-bases/${encodeURIComponent(String(kbId))}/documents/web`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...buildAuthHeaders() },
    body: JSON.stringify({ url }),
  })
  const result = await parseJson(response)
  return result.data
}

export async function mcpSearch(payload) {
  const response = await requestWithFallback('/api/mcp-services/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...buildAuthHeaders() },
    body: JSON.stringify(payload || {}),
  })
  const result = await parseJson(response)
  return result.data
}

export async function addKnowledgeBaseText(kbId, payload) {
  const response = await requestWithFallback(`/api/knowledge-bases/${encodeURIComponent(String(kbId))}/documents/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...buildAuthHeaders() },
    body: JSON.stringify(payload || {}),
  })
  const result = await parseJson(response)
  return result.data
}

export async function retryKnowledgeBaseDocument(kbId, docId) {
  const response = await requestWithFallback(`/api/knowledge-bases/${encodeURIComponent(String(kbId))}/documents/${encodeURIComponent(String(docId))}/retry`, {
    method: 'POST',
    headers: buildAuthHeaders(),
  })
  const result = await parseJson(response)
  return result.data
}

export async function deleteKnowledgeBaseDocument(kbId, docId) {
  const response = await requestWithFallback(`/api/knowledge-bases/${encodeURIComponent(String(kbId))}/documents/${encodeURIComponent(String(docId))}`, {
    method: 'DELETE',
    headers: buildAuthHeaders(),
  })
  const result = await parseJson(response)
  return result.data
}

export async function previewKnowledgeBaseDocument(kbId, docId) {
  const response = await requestWithFallback(`/api/knowledge-bases/${encodeURIComponent(String(kbId))}/documents/${encodeURIComponent(String(docId))}/preview`, {
    method: 'GET',
    headers: buildAuthHeaders(),
  })
  const result = await parseJson(response)
  return result.data
}

export async function searchKnowledgeBase(kbId, payload) {
  const response = await requestWithFallback(`/api/knowledge-bases/${encodeURIComponent(String(kbId))}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...buildAuthHeaders() },
    body: JSON.stringify(payload || {}),
  })
  const result = await parseJson(response)
  return result.data
}
