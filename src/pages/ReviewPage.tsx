import { useState, useEffect, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api as axios } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import styles from './Review.module.css'

const ICON_OPTIONS = ['😊', '😄', '🎮', '🃏', '🏆', '🤩', '😎', '👑', '🔥', '💯']

interface Review {
  _id: string
  username: string
  icon: string
  rating: number
  comment: string
  createdAt: string
}

function StarRating({ value, onChange }: { value: number; onChange?: (n: number) => void }) {
  const [hovered, setHovered] = useState(0)
  return (
    <div className={styles.stars}>
      {[1, 2, 3, 4, 5].map(n => (
        <span
          key={n}
          className={[styles.star, (hovered || value) >= n ? styles.starActive : ''].join(' ')}
          onMouseEnter={() => onChange && setHovered(n)}
          onMouseLeave={() => onChange && setHovered(0)}
          onClick={() => onChange?.(n)}
          style={{ cursor: onChange ? 'pointer' : 'default' }}
        >
          ★
        </span>
      ))}
    </div>
  )
}

export default function ReviewPage() {
  const { user, token } = useAuth()
  const navigate = useNavigate()

  const [reviews, setReviews] = useState<Review[]>([])
  const [icon, setIcon]       = useState('😊')
  const [rating, setRating]   = useState(0)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError]     = useState('')

  useEffect(() => {
    fetchReviews()
  }, [])

  async function fetchReviews() {
    try {
      const { data } = await axios.get('/api/reviews')
      setReviews(data.reviews)
    } catch { /* silently fail */ }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (rating === 0) { setError('Please select a star rating'); return }
    if (!comment.trim()) { setError('Please write a comment'); return }
    setError('')
    setSubmitting(true)
    try {
      await axios.post(
        '/api/reviews',
        { icon, rating, comment },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      setSuccess(true)
      setComment('')
      setRating(0)
      fetchReviews()
      setTimeout(() => setSuccess(false), 3000)
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to submit review')
    } finally {
      setSubmitting(false)
    }
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-NG', {
      year: 'numeric', month: 'short', day: 'numeric',
    })
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate('/dashboard')}>← Back</button>
        <h1 className={styles.title}>Player Reviews</h1>
        <span />
      </header>

      <div className={styles.layout}>

        {/* SUBMIT FORM */}
        <section className={styles.formSection}>
          <h2 className={styles.sectionTitle}>Share Your Experience</h2>
          <p className={styles.sectionHint}>Tell us what you think about the Whot Relationship Game</p>

          <div className={styles.iconPicker}>
            <p className={styles.iconLabel}>Choose your icon:</p>
            <div className={styles.iconGrid}>
              {ICON_OPTIONS.map(ic => (
                <button
                  key={ic}
                  className={[styles.iconBtn, ic === icon ? styles.iconBtnActive : ''].join(' ')}
                  onClick={() => setIcon(ic)}
                  type="button"
                >
                  {ic}
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={handleSubmit} className={styles.form}>
            <div>
              <p className={styles.iconLabel}>Your rating:</p>
              <StarRating value={rating} onChange={setRating} />
            </div>

            <textarea
              className={styles.textarea}
              placeholder="What do you love about the game? Any suggestions?"
              value={comment}
              onChange={e => setComment(e.target.value)}
              maxLength={500}
              rows={4}
            />
            <p className={styles.charCount}>{comment.length}/500</p>

            {error   && <p className={styles.error}>{error}</p>}
            {success && <p className={styles.successMsg}>Review submitted! Thank you.</p>}

            <button className={styles.submitBtn} type="submit" disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit Review'}
            </button>
          </form>
        </section>

        {/* REVIEWS LIST */}
        <section className={styles.listSection}>
          <h2 className={styles.sectionTitle}>What Players Say</h2>
          {reviews.length === 0 && (
            <p className={styles.empty}>No reviews yet — be the first!</p>
          )}
          <div className={styles.reviewList}>
            {reviews.map(r => (
              <div key={r._id} className={styles.reviewCard}>
                <div className={styles.reviewHeader}>
                  <span className={styles.reviewIcon}>{r.icon}</span>
                  <div>
                    <p className={styles.reviewUsername}>{r.username}</p>
                    <p className={styles.reviewDate}>{formatDate(r.createdAt)}</p>
                  </div>
                  <div className={styles.reviewRating}>
                    <StarRating value={r.rating} />
                  </div>
                </div>
                <p className={styles.reviewComment}>{r.comment}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
