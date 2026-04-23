import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api as axios } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import styles from './Dashboard.module.css'

interface Partner {
  relationshipId: string
  partnerId: string
  partnerUsername: string
  myWins: number
  partnerWins: number
  totalGames: number
  clearStatus: string
  isMyRequest: boolean
  activeSessionId: string | null
  lastPlayedAt: string | null
}

export default function DashboardPage() {
  const { user, token, logout } = useAuth()
  const navigate = useNavigate()

  const [generatedKey, setGeneratedKey] = useState('')
  const [generatedSessionId, setGeneratedSessionId] = useState('')
  const [enterKey, setEnterKey] = useState('')
  const [error, setError] = useState('')
  const [partners, setPartners] = useState<Partner[]>([])
  const [showTooltip, setShowTooltip] = useState(false)
  const [activeTab, setActiveTab] = useState<'partners' | 'new'>('partners')

  useEffect(() => {
    const show = () => setShowTooltip(true)
    const hide = () => setShowTooltip(false)

    const firstShow = setTimeout(show, 1200)
    const firstHide = setTimeout(hide, 7200)
    const interval = setInterval(() => {
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

  useEffect(() => {
    if (!token) return
    fetchPartners()
  }, [token])

  async function fetchPartners() {
    try {
      const { data } = await axios.get('/api/game/partners', { headers: { Authorization: `Bearer ${token}` } })
      setPartners(data.partners || [])
    } catch {}
  }

  async function generateKey() {
    setError('')
    setLoadingGenerate(true)
    try {
      const { data } = await axios.post(
        '/api/game/generate-key',
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      )
      setGeneratedKey(data.connectionKey)
      setGeneratedSessionId(data.sessionId)
      await fetchActiveGames()
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Failed to generate key'
      setError(msg)
    } finally {
      setLoadingGenerate(false)
    }
  }

  async function connectWithKey() {
    if (!enterKey.trim()) return
    setError('')
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
      setError(msg)
    } finally {
      setLoadingConnect(false)
    }
  }

  async function continueGame(sessionId: string) {
    navigate(`/game/${sessionId}`)
  }

  async function handleClearScore(relationshipId: string) {
    try {
      await axios.post(`/api/game/clear-score/${relationshipId}`, {}, { headers: { Authorization: `Bearer ${token}` } })
      await fetchPartners()
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to update score')
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
        <p className={styles.desc}>Play with your partners or start a new game.</p>

        <div className={styles.tabsContainer}>
          <button
            className={`${styles.tab} ${activeTab === 'partners' ? styles.tabActive : ''}`}
            onClick={() => setActiveTab('partners')}
          >
            My Partners ({partners.length})
          </button>
          <button
            className={`${styles.tab} ${activeTab === 'new' ? styles.tabActive : ''}`}
            onClick={() => setActiveTab('new')}
          >
            Start New Game
          </button>
        </div>

        {activeTab === 'partners' && (
          <div className={styles.partnersSection}>
            {partners.length === 0 ? (
              <div className={styles.noPartners}>
                <div className={styles.emptyStateIcon}>👥</div>
                <p>No partners yet. Start a new game to connect with someone!</p>
              </div>
            ) : (
              <div className={styles.partnersGrid}>
                {partners.map((partner) => (
                  <div key={partner.relationshipId} className={styles.partnerCard}>
                    <div className={styles.partnerHeader}>
                      <div className={styles.partnerInfo}>
                        <span className={styles.partnerVs}>vs</span>
                        <span className={styles.partnerName}>{partner.partnerUsername}</span>
                      </div>
                      <div className={styles.scoreBox}>
                        <div className={styles.scoreTitle}>Score</div>
                        <div className={styles.scoreValue}>
                          <span className={partner.myWins > 0 ? styles.scoreUserWin : styles.scoreUser}>{partner.myWins}</span>
                          <span className={styles.scoreDivider}>-</span>
                          <span className={partner.partnerWins > 0 ? styles.scoreOpponentWin : styles.scoreOpponent}>{partner.partnerWins}</span>
                        </div>
                      </div>
                    </div>
                    <div className={styles.partnerActions}>
                      {partner.activeSessionId ? (
                        <button className={styles.continueBtn} onClick={() => continueGame(partner.activeSessionId!)}>
                          Continue Game →
                        </button>
                      ) : (
                        <button className={styles.newGameBtn} onClick={generateKey}>
                          New Game
                        </button>
                      )}
                      <button
                        className={`${styles.clearScoreBtn} ${
                          partner.clearStatus === 'pending' ? styles.clearScorePending :
                          partner.clearStatus === 'confirmed' ? styles.clearScoreConfirmed : ''
                        }`}
                        onClick={() => handleClearScore(partner.relationshipId)}
                      >
                        {partner.clearStatus === 'pending' ? (partner.isMyRequest ? 'Cancel Request' : 'Confirm Clear') :
                         partner.clearStatus === 'confirmed' ? 'Score Cleared' :
                         'Clear Score'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'new' && (
          <>
            {error && (
              <div className={styles.errorBox}>
                <p>{error}</p>
              </div>
            )}

            <div className={styles.grid}>
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
          </>
        )}
      </main>
    </div>
  )
}