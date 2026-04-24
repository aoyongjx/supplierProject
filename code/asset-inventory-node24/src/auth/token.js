const TOKEN_KEY = 'accessToken'
const REFRESH_TOKEN_KEY = 'refreshToken'

export function getAccessToken() {
  const savedToken = localStorage.getItem(TOKEN_KEY) || ''
  if (savedToken) return savedToken

  const envToken = import.meta.env.VITE_AUTH_TOKEN || ''
  if (envToken) return envToken
  return ''
}

export function setTokens({ accessToken = '', refreshToken = '' }) {
  if (accessToken) localStorage.setItem(TOKEN_KEY, accessToken)
  if (refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
}

export function clearTokens() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(REFRESH_TOKEN_KEY)
}
