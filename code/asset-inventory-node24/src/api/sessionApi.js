import { clearTokens, getAccessToken } from '../auth/token'

function buildAuthHeaders() {
  const token = getAccessToken() || import.meta.env.VITE_AUTH_TOKEN || ''
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function parseJson(response, options = {}) {
  const { redirectOn401 = true } = options
  const payload = await response.json().catch(() => ({}))
  if (response.status === 401) {
    clearTokens()
    if (redirectOn401 && window.location.pathname !== '/login') {
      window.location.replace('/login')
    }
    throw new Error(payload.message || '登录已失效，请重新登录')
  }
  if (!response.ok) {
    throw new Error(payload.message || `请求失败（HTTP ${response.status}）`)
  }
  return payload
}

export async function fetchRecentSessions(limit = 10) {
  const response = await fetch(`/api/sessions/recent?limit=${encodeURIComponent(String(limit))}`, {
    headers: buildAuthHeaders(),
  })
  const result = await parseJson(response, { redirectOn401: false })
  return result.data ?? []
}

export async function fetchSessions(params = {}) {
  const query = new URLSearchParams()
  if (params.limit) query.set('limit', String(params.limit))
  if (params.offset) query.set('offset', String(params.offset))
  const response = await fetch(`/api/sessions?${query.toString()}`, {
    headers: buildAuthHeaders(),
  })
  const result = await parseJson(response)
  return result.data ?? { total: 0, list: [] }
}

export async function fetchSessionDetail(id) {
  const response = await fetch(`/api/sessions/${encodeURIComponent(String(id))}`, {
    headers: buildAuthHeaders(),
  })
  const result = await parseJson(response)
  return result.data
}

export async function createSession(payload) {
  const response = await fetch('/api/sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...buildAuthHeaders(),
    },
    body: JSON.stringify(payload || {}),
  })
  const result = await parseJson(response)
  return result.data
}

export async function updateSession(id, payload) {
  const response = await fetch(`/api/sessions/${encodeURIComponent(String(id))}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...buildAuthHeaders(),
    },
    body: JSON.stringify(payload || {}),
  })
  const result = await parseJson(response)
  return result.data
}

export async function deleteSession(id) {
  const response = await fetch(`/api/sessions/${encodeURIComponent(String(id))}`, {
    method: 'DELETE',
    headers: buildAuthHeaders(),
  })
  const result = await parseJson(response)
  return result.data
}

export async function sendSessionMessage(id, payload) {
  const response = await fetch(`/api/sessions/${encodeURIComponent(String(id))}/message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...buildAuthHeaders(),
    },
    body: JSON.stringify(payload || {}),
  })
  const result = await parseJson(response)
  return result.data
}
