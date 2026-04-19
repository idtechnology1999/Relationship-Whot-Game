import { useState, useEffect, FormEvent } from 'react'
import { api as axios } from '../lib/api'
import styles from './Admin.module.css'

const ADMIN_USER = 'oluwaseun'
const ADMIN_PASS = 'oluwaseun'

interface Review {
  _id: string
  username: string
  icon: string
  rating: number
  comment: string
  createdAt: string
}

function StarDisplay({ value }: { value: number }) {
  return (
    <span className={styles.stars}>
      {[1, 2, 3, 4, 5].map(n => (
        <span key={n} className={n <= value ? styles.starOn : styles.starOff}>★</span>
      ))}
    </span>
  )
}

export default function AdminPage() {
  const [authed, setAuthed]       = useState(false)
  const [username, setUsername]   = useState('')
  const [password, setPassword]   = useState('')
  const [loginErr, setLoginErr]   = useState('')
  const [reviews, setReviews]     = useState<Review[]>([])
  const [loading, setLoading]     = useState(false)

  function handleLogin(e: FormEvent) {
    e.preventDefault()
    if (username === ADMIN_USER && password === ADMIN_PASS) {
      setAuthed(true)
    } else {
      setLoginErr('Invalid admin credentials')
    }
  }

  useEffect(() => {
    if (!authed) return
    setLoading(true)
    axios.get('/api/reviews')
      .then(({ data }) => setReviews(data.reviews))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [authed])

  function formatDate(iso: string) {
    return new Date(iso).toLocaleString('en-NG', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }

  const avgRating = reviews.length
    ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)
    : '–'

  if (!authed) {
    return (
      <div className={styles.loginWrap}>
        <div className={styles.loginBox}>
          <div className={styles.adminBadge}>🛡 Admin</div>
          <h1 className={styles.loginTitle}>Admin Login</h1>
          {loginErr && <p className={styles.loginErr}>{loginErr}</p>}
          <form onSubmit={handleLogin} className={styles.loginForm}>
            <input
              className={styles.input}
              type="text"
              placeholder="Username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoComplete="username"
            />
            <input
              className={styles.input}
              type="password"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            <button className={styles.loginBtn} type="submit">Login</button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.adminBadgeSmall}>🛡 Admin</span>
          <h1 className={styles.pageTitle}>User Reviews Dashboard</h1>
        </div>
        <button className={styles.logoutBtn} onClick={() => { setAuthed(false); setReviews([]) }}>
          Logout
        </button>
      </header>

      {/* Stats bar */}
      <div className={styles.statsBar}>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{reviews.length}</span>
          <span className={styles.statLabel}>Total Reviews</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{avgRating} ★</span>
          <span className={styles.statLabel}>Average Rating</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statValue}>
            {reviews.filter(r => r.rating >= 4).length}
          </span>
          <span className={styles.statLabel}>Positive (4–5 ★)</span>
        </div>
      </div>

      {/* Reviews table */}
      <div className={styles.tableWrap}>
        {loading ? (
          <p className={styles.loading}>Loading reviews…</p>
        ) : reviews.length === 0 ? (
          <p className={styles.empty}>No reviews yet.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Icon</th>
                <th>Username</th>
                <th>Rating</th>
                <th>Comment</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {reviews.map(r => (
                <tr key={r._id}>
                  <td className={styles.iconCell}>{r.icon}</td>
                  <td className={styles.usernameCell}>{r.username}</td>
                  <td><StarDisplay value={r.rating} /></td>
                  <td className={styles.commentCell}>{r.comment}</td>
                  <td className={styles.dateCell}>{formatDate(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
