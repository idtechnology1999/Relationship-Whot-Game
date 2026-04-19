import { createContext, useContext, useState, ReactNode } from 'react'
import { api as axios } from '../lib/api'

interface AuthUser {
  id: string
  email: string
  username: string
}

interface AuthContextType {
  user: AuthUser | null
  token: string | null
  login: (token: string, user: AuthUser) => void
  logout: () => void
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(
    () => localStorage.getItem('rg_token')
  )
  const [user, setUser] = useState<AuthUser | null>(() => {
    const stored = localStorage.getItem('rg_user')
    return stored ? JSON.parse(stored) : null
  })

  function login(newToken: string, newUser: AuthUser) {
    localStorage.setItem('rg_token', newToken)
    localStorage.setItem('rg_user', JSON.stringify(newUser))
    setToken(newToken)
    setUser(newUser)
  }

  function logout() {
    const t = localStorage.getItem('rg_token')
    if (t) {
      // Fire-and-forget — abandon any active/waiting session so user can start fresh
      axios.post('/api/game/abandon', {}, { headers: { Authorization: `Bearer ${t}` } }).catch(() => {})
    }
    localStorage.removeItem('rg_token')
    localStorage.removeItem('rg_user')
    setToken(null)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, token, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
