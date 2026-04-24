import { clearTokens, getAccessToken } from '../auth/token'

const API_BASE = '/api/crawl-tasks'

function buildAuthHeaders() {
  const token = getAccessToken() || import.meta.env.VITE_AUTH_TOKEN || ''
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function parseJson(response) {
  const payload = await response.json().catch(() => ({}))
  if (response.status === 401) {
    clearTokens()
    if (window.location.pathname !== '/login') {
      window.location.replace('/login')
    }
    throw new Error(payload.message || '登录已失效，请重新登录')
  }
  if (!response.ok) {
    throw new Error(payload.message || `请求失败（HTTP ${response.status}）`)
  }
  return payload
}

export async function fetchCrawlTasks({ keyword = '', status = '' } = {}) {
  const params = new URLSearchParams()
  if (keyword) params.set('keyword', keyword)
  if (status) params.set('status', status)
  const response = await fetch(`${API_BASE}?${params.toString()}`, {
    headers: {
      ...buildAuthHeaders(),
    },
  })
  const result = await parseJson(response)
  return result.data ?? []
}

export async function createCrawlTask(payload) {
  const response = await fetch(API_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...buildAuthHeaders(),
    },
    body: JSON.stringify(payload),
  })
  const result = await parseJson(response)
  return result.data
}

export async function startCrawlTask(id) {
  const response = await fetch(`${API_BASE}/${id}/start`, {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(),
    },
  })
  const result = await parseJson(response)
  return result.data
}

export async function stopCrawlTask(id) {
  const response = await fetch(`${API_BASE}/${id}/stop`, {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(),
    },
  })
  const result = await parseJson(response)
  return result.data
}

export async function retryCrawlTask(id) {
  const response = await fetch(`${API_BASE}/${id}/retry`, {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(),
    },
  })
  const result = await parseJson(response)
  return result.data
}

export async function fetchCrawlTaskDetail(id) {
  const response = await fetch(`${API_BASE}/${id}`, {
    headers: {
      ...buildAuthHeaders(),
    },
  })
  const result = await parseJson(response)
  return result.data
}

export async function fetchCrawlTaskLogs(id) {
  const response = await fetch(`${API_BASE}/${id}/logs`, {
    headers: {
      ...buildAuthHeaders(),
    },
  })
  const result = await parseJson(response)
  return result.data ?? []
}

export async function fetchCrawlTaskQuality(id) {
  const response = await fetch(`${API_BASE}/${id}/quality-report`, {
    headers: {
      ...buildAuthHeaders(),
    },
  })
  const result = await parseJson(response)
  return result.data
}
