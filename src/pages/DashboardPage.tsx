import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api as axios } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import styles from './Dashboard.module.css'

export default function DashboardPage() {
  const { user, token, logout } = useAuth()
  const navigate = useNavigate()

  const [generatedKey, setGeneratedKey] = useState('')
  const [generatedSessionId, setGeneratedSessionId] = useState('')
  const [enterKey, setEnterKey] = useState('')
  const [error, setError] = useState('')
  const [activeSessionId, setActiveSessionId] = useState('')
  const [showTooltip, setShowTooltip] = useState(false)

  // Auto-show tooltip after 1.2s, hide after 6s, then re-appear every 18s
  useEffect(() => {
    const show = () => setShowTooltip(true)
    const hide = () => setShowTooltip(false)

    const firstShow  = setTimeout(show, 1200)
    const firstHide  = setTimeout(hide, 7200)
    const interval   = setInterval(() => {
      setShowTooltip(true)
      setTimeout(hide, 6000)
    }, 18000)

    return () => {
      clearTimeout(firstShow)
      clearTimeout(firstHide)
      clearInterval(interval)
    }
  }, [])
  const [loadingGenerate, setLoadingGenerate] = useState(false)
  const [loadingConnect, setLoadingConnect] = useState(false)
  const [copied, setCopied] = useState(false)

  // On mount, check if user already has an active game and show rejoin banner
  useEffect(() => {
    if (!token) return
    axios
      .get('/api/game/active', { headers: { Authorization: `Bearer ${token}` } })
      .then(({ data }) => {
        if (data.sessionId) setActiveSessionId(data.sessionId)
      })
      .catch(() => {})
  }, [token])

  async function generateKey() {
    setError('')
    setActiveSessionId('')
    setLoadingGenerate(true)
    try {
      const { data } = await axios.post(
        '/api/game/generate-key',
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      )
      // Show the key — do NOT navigate yet so user can copy it first
      setGeneratedKey(data.connectionKey)
      setGeneratedSessionId(data.sessionId)
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Failed to generate key'
      const existingId = err.response?.data?.sessionId
      setError(msg)
      if (existingId) setActiveSessionId(existingId)
    } finally {
      setLoadingGenerate(false)
    }
  }

  async function connectWithKey() {
    if (!enterKey.trim()) return
    setError('')
    setActiveSessionId('')
    setLoadingConnect(true)
    try {
      const { data } = await axios.post(
        '/api/game/connect',
        { connectionKey: enterKey.trim() },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      navigate(`/game/${data.sessionId}`)
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Failed to connect'
      const existingId = err.response?.data?.sessionId
      setError(msg)
      if (existingId) setActiveSessionId(existingId)
    } finally {
      setLoadingConnect(false)
    }
  }

  function copyKey() {
    navigator.clipboard.writeText(generatedKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function enterGameRoom() {
    navigate(`/game/${generatedSessionId}`)
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.logo}>Relationship Game</h1>
        <div className={styles.userInfo}>
          <div className={styles.notifWrap}>
            <button
              className={styles.notifBtn}
              onClick={() => { setShowTooltip(false); navigate('/reviews') }}
            >
              🔔
            </button>
            {showTooltip && (
              <div
                className={styles.tooltip}
                onClick={() => { setShowTooltip(false); navigate('/reviews') }}
              >
                <span className={styles.tooltipEmoji}>💬</span>
                <strong>Share your opinion!</strong>
                <span className={styles.tooltipSub}>Tap here to rate &amp; review the game</span>
                <span className={styles.tooltipCta}>👆 Click me!</span>
              </div>
            )}
          </div>
          <span>👤 {user?.username}</span>
          <button className={styles.logoutBtn} onClick={logout}>Logout</button>
        </div>
      </header>

      <main className={styles.main}>
        <h2 className={styles.welcome}>Welcome back, <span>{user?.username}</span>!</h2>
        <p className={styles.desc}>Start a new game or join a friend's game.</p>

        {/* Active game banner — always visible if user has an ongoing game */}
        {activeSessionId && !error && (
          <div className={styles.activeGameBanner}>
            <span>You have an active game in progress!</span>
            <button
              className={styles.rejoinBtn}
              onClick={() => navigate(`/game/${activeSessionId}`)}
            >
              Rejoin Game →
            </button>
          </div>
        )}

        {error && (
          <div className={styles.errorBox}>
            <p>{error}</p>
            {activeSessionId && (
              <button
                className={styles.rejoinBtn}
                onClick={() => navigate(`/game/${activeSessionId}`)}
              >
                Rejoin your active game →
              </button>
            )}
          </div>
        )}

        <div className={styles.grid}>
          {/* HOST GAME */}
          <div className={styles.card}>
            <div className={styles.cardIcon}>🃏</div>
            <h3 className={styles.cardTitle}>Host a Game</h3>
            <p className={styles.cardDesc}>
              Generate a key, copy it, and share it with your opponent.
            </p>

            {!generatedKey ? (
              <button
                className={styles.primaryBtn}
                onClick={generateKey}
                disabled={loadingGenerate}
              >
                {loadingGenerate ? 'Generating...' : 'Generate Connection Key'}
              </button>
            ) : (
              <>
                <p className={styles.keyLabel}>Your connection key — share this!</p>
                <div className={styles.keyDisplay}>
                  <span className={styles.keyText}>{generatedKey}</span>
                  <button className={styles.copyBtn} onClick={copyKey}>
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <button className={styles.enterBtn} onClick={enterGameRoom}>
                  Enter Game Room →
                </button>
                <button
                  className={styles.newKeyBtn}
                  onClick={() => { setGeneratedKey(''); setGeneratedSessionId(''); }}
                >
                  Generate new key
                </button>
              </>
            )}
          </div>

          {/* JOIN GAME */}
          <div className={styles.card}>
            <div className={styles.cardIcon}>🔗</div>
            <h3 className={styles.cardTitle}>Join a Game</h3>
            <p className={styles.cardDesc}>
              Enter the connection key your opponent shared with you.
            </p>
            <input
              className={styles.keyInput}
              type="text"
              placeholder="Enter key (e.g. A3F7K2)"
              value={enterKey}
              onChange={e => setEnterKey(e.target.value.toUpperCase())}
              maxLength={6}
            />
            <button
              className={styles.primaryBtn}
              onClick={connectWithKey}
              disabled={loadingConnect || enterKey.trim().length < 6}
            >
              {loadingConnect ? 'Connecting...' : 'Connect'}
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}
