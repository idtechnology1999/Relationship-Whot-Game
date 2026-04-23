import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api as axios } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { getSocket, disconnectSocket } from '../socket/socket'
import { Socket } from 'socket.io-client'
import styles from './GameRoom.module.css'

// ── Types ─────────────────────────────────────────────────────────────────────
interface Card {
  shape: string
  number: number
  id: string
}

interface GameState {
  sessionId: string
  status: string
  currentTurn: string
  turnCount: number
  deckCount: number
  pile1Top: Card | null
  pile2Top: Card | null
  pile1Count: number
  pile2Count: number
  calledShape1: string | null
  calledShape2: string | null
  pendingPickup: number
  waitingForShapeCall: boolean
  myHand: Card[]
  opponentHandCount: number
  myRole: 'host' | 'guest'
  host: { username: string }
  guest: { username: string } | null
  isMyTurn: boolean
  winnerUsername: string | null
}

// ── Constants ─────────────────────────────────────────────────────────────────
const SHAPE_SYMBOL: Record<string, string> = {
  Circle:   '●',
  Triangle: '▲',
  Cross:    '✚',
  Square:   '■',
  Star:     '★',
  Whot:     'W',
}

const SHAPE_COLOR: Record<string, string> = {
  Circle:   '#e94560',
  Triangle: '#00c9a7',
  Cross:    '#4a90d9',
  Square:   '#f7b731',
  Star:     '#a855f7',
  Whot:     '#ff8c00',
}

const SPECIAL_LABEL: Record<number, string> = {
  1:  'Hold On',
  2:  'Pick 2',
  5:  'Pick 3',
  8:  'Suspend',
  14: 'Gen. Market',
  20: 'WHOT!',
}

const SHAPES = ['Circle', 'Triangle', 'Cross', 'Square', 'Star'] as const

// ── Sound utilities ───────────────────────────────────────────────────────────
let audioCtx: AudioContext | null = null

function getAudioCtx(): AudioContext {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
  }
  if (audioCtx.state === 'suspended') audioCtx.resume()
  return audioCtx
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.28, startAt = 0) {
  try {
    const ctx = getAudioCtx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = type
    osc.frequency.value = freq
    const t = ctx.currentTime + startAt
    gain.gain.setValueAtTime(vol, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur)
    osc.start(t)
    osc.stop(t + dur)
  } catch {}
}

// Regular card flip — short swoosh
function playCardSound() {
  try {
    const ctx = getAudioCtx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(900, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(350, ctx.currentTime + 0.08)
    gain.gain.setValueAtTime(0.22, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1)
    osc.start(); osc.stop(ctx.currentTime + 0.1)
  } catch {}
}

// Special card (Pick2 / Pick5 / WHOT / Suspend / HoldOn) — dramatic hit
function playSpecialCardSound() {
  tone(220, 0.12, 'sawtooth', 0.25, 0)
  tone(440, 0.22, 'sawtooth', 0.18, 0.07)
  tone(660, 0.18, 'sine',     0.15, 0.16)
}

// Pick penalty alarm — 3 urgent beeps
function playPickAlarmSound() {
  [0, 0.19, 0.38].forEach(t => tone(880, 0.13, 'square', 0.28, t))
}

// Win jingle — ascending 5-note fanfare
function playWinJingle() {
  [523, 659, 784, 988, 1319].forEach((f, i) => {
    tone(f, 0.55, 'sine', 0.3, i * 0.13)
  })
}

// Lose sound — descending sad tones
function playLoseSound() {
  [440, 370, 311, 247].forEach((f, i) => {
    tone(f, 0.45, 'sine', 0.22, i * 0.16)
  })
}

// Lady voice — high pitch makes any installed voice sound feminine
function speakLady(text: string) {
  try {
    window.speechSynthesis.cancel()
    const utter = new SpeechSynthesisUtterance(text)
    utter.rate = 0.9
    utter.pitch = 1.7  // high pitch = feminine sound on any voice
    utter.volume = 1
    window.speechSynthesis.speak(utter)
  } catch {}
}

const SPECIAL_CARD_NUMS = new Set([1, 2, 5, 8, 14, 20])

function soundForAction(action: string) {
  const m = action.match(/played (?:General Market|\w+ (\d+))/)
  if (!m) return
  const num = m[1] ? parseInt(m[1]) : 14
  if (SPECIAL_CARD_NUMS.has(num)) playSpecialCardSound()
  else playCardSound()
}

// ── Confetti component ────────────────────────────────────────────────────────
function Confetti() {
  const pieces = Array.from({ length: 22 }, (_, i) => ({
    id: i,
    color: ['#f7b731', '#e94560', '#00c9a7', '#4a90d9', '#a855f7', '#ff8c00', '#fff'][i % 7],
    left: `${4 + (i * 4.3) % 92}%`,
    delay: `${((i * 0.17) % 1.8).toFixed(2)}s`,
    duration: `${(1.4 + (i % 5) * 0.25).toFixed(2)}s`,
    size: `${7 + (i % 4) * 3}px`,
  }))
  return (
    <div className={styles.confettiContainer} aria-hidden>
      {pieces.map(p => (
        <div
          key={p.id}
          className={styles.confettiPiece}
          style={{ left: p.left, backgroundColor: p.color, width: p.size, height: p.size, animationDelay: p.delay, animationDuration: p.duration }}
        />
      ))}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────
function CardFace({
  card,
  selected,
  dimmed,
  onClick,
}: {
  card: Card
  selected?: boolean
  dimmed?: boolean
  onClick?: () => void
}) {
  const color  = SHAPE_COLOR[card.shape] ?? '#eaeaea'
  const symbol = SHAPE_SYMBOL[card.shape] ?? card.shape[0]
  const special = SPECIAL_LABEL[card.number]
  const isWhot  = card.number === 20

  return (
    <div
      className={[
        styles.card,
        onClick  ? styles.cardClickable : '',
        selected ? styles.cardSelected  : '',
        dimmed   ? styles.cardDimmed    : '',
        isWhot   ? styles.cardWhot      : '',
      ].join(' ')}
      style={{ '--shape-color': color } as React.CSSProperties}
      onClick={onClick}
      title={special ?? `${card.shape} ${card.number}`}
    >
      <span className={styles.cardCornerTL}>{isWhot ? 'W' : card.number}</span>
      <span className={styles.cardCenter}>{symbol}</span>
      <span className={styles.cardCornerBR}>{isWhot ? 'W' : card.number}</span>
      {special && <span className={styles.cardSpecialTag}>{special}</span>}
    </div>
  )
}

function CardBack() {
  return <div className={styles.cardBack} />
}

function PileSlot({
  topCard,
  count,
  calledShape,
  pileNum,
  selected,
  onClick,
}: {
  topCard: Card | null
  count: number
  calledShape: string | null
  pileNum: 1 | 2
  selected: boolean
  onClick: () => void
}) {
  return (
    <div
      className={[styles.pileSlot, selected ? styles.pileSelected : ''].join(' ')}
      onClick={onClick}
      title={`Pile ${pileNum} — press ${pileNum} to select`}
    >
      <div className={styles.pileLabel}>
        Pile {pileNum}
        <kbd className={styles.pileKey}>{pileNum}</kbd>
      </div>
      {topCard ? (
        <CardFace card={topCard} />
      ) : (
        <div className={styles.pilePlaceholder}>—</div>
      )}
      {calledShape && (
        <div className={styles.calledShape} style={{ color: SHAPE_COLOR[calledShape] }}>
          {SHAPE_SYMBOL[calledShape]} {calledShape}
        </div>
      )}
      <div className={styles.pileCount}>{count} card{count !== 1 ? 's' : ''}</div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function GameRoomPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const { user, token } = useAuth()
  const navigate = useNavigate()

  const [socket, setSocket] = useState<Socket | null>(null)
  const [gameState, setGameState] = useState<GameState | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [error, setError] = useState('')
  const [waitingForOpponent, setWaitingForOpponent] = useState(true)
  const [roomKey, setRoomKey] = useState('')
  const [keyCopied, setKeyCopied] = useState(false)
  const [winner, setWinner] = useState<string | null>(null)
  const [connectTimeout, setConnectTimeout] = useState(false)
  const [rematchRequested, setRematchRequested] = useState(false)   // I requested rematch, waiting
  const [rematchIncoming, setRematchIncoming] = useState<{ requesterUsername: string; sessionId: string } | null>(null)
  const [rematchDeclined, setRematchDeclined] = useState(false)

  const [showScoreModal, setShowScoreModal] = useState(false)
  const [scoreData, setScoreData] = useState<{ myWins: number; partnerWins: number; clearStatus: string; isMyRequest: boolean } | null>(null)
  const [liveScore, setLiveScore] = useState<{ myWins: number; partnerWins: number }>({ myWins: 0, partnerWins: 0 })

  // Keyboard / interaction state
  const [selectedPile, setSelectedPile] = useState<1 | 2 | null>(null)
  const [selectedCardIdx, setSelectedCardIdx] = useState<number | null>(null)

  const gameStateRef = useRef<GameState | null>(null)
  const selectedPileRef = useRef<1 | 2 | null>(null)
  const selectedCardIdxRef = useRef<number | null>(null)
  const socketRef = useRef<Socket | null>(null)
  const prevPendingPickupRef = useRef<number>(0)
  const myUsernameRef = useRef<string>('')

  // Keep refs in sync
  gameStateRef.current    = gameState
  selectedPileRef.current = selectedPile
  selectedCardIdxRef.current = selectedCardIdx
  socketRef.current       = socket
  myUsernameRef.current   = user?.username ?? ''

  // Unlock Web Audio on first user interaction (browser security requirement)
  useEffect(() => {
    function unlock() {
      try {
        const ctx = getAudioCtx()
        if (ctx.state === 'suspended') ctx.resume()
      } catch {}
      document.removeEventListener('click', unlock, true)
      document.removeEventListener('keydown', unlock, true)
      document.removeEventListener('touchstart', unlock, true)
    }
    document.addEventListener('click', unlock, true)
    document.addEventListener('keydown', unlock, true)
    document.addEventListener('touchstart', unlock, true)
    return () => {
      document.removeEventListener('click', unlock, true)
      document.removeEventListener('keydown', unlock, true)
      document.removeEventListener('touchstart', unlock, true)
    }
  }, [])

  // Fetch room key and score so host can share it
  useEffect(() => {
    if (!token || !sessionId) return
    axios
      .get(`/api/game/session/${sessionId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(({ data }) => setRoomKey(data.session.connectionKey))
      .catch(() => {})
    
    axios
      .get(`/api/game/session-score/${sessionId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(({ data }) => setLiveScore({ myWins: data.myWins || 0, partnerWins: data.partnerWins || 0 }))
      .catch(() => {})
  }, [token, sessionId])

  // Socket setup
  useEffect(() => {
    if (!token || !sessionId) return
    const s = getSocket(token)
    setSocket(s)

    // Always re-emit join-game on (re)connect so the server refreshes the socket ID
    function onConnect() {
      s.emit('join-game', { sessionId })
    }
    s.on('connect', onConnect)

    // If already connected emit immediately too
    if (s.connected) {
      s.emit('join-game', { sessionId })
    }

    // Timeout — if no game-state after 6s, show retry option
    const timeoutId = setTimeout(() => {
      setConnectTimeout(true)
    }, 6000)

    s.on('game-state', (state: GameState) => {
      clearTimeout(timeoutId)
      setConnectTimeout(false)
      const prev = prevPendingPickupRef.current
      if (state.pendingPickup > prev && state.isMyTurn) {
        playPickAlarmSound()
        const n = state.pendingPickup
        setTimeout(() => speakLady(
          n === 2 ? 'Pick two cards or counter!'
          : n === 3 ? 'Pick three cards or counter!'
          : `Pick ${n} cards or counter!`
        ), 200)
      }
      prevPendingPickupRef.current = state.pendingPickup
      setGameState(state)
      if (state.guest) setWaitingForOpponent(false)
      if (state.winnerUsername) setWinner(state.winnerUsername)
    })

    s.on('player-joined', ({ username }: { username: string }) => {
      addLog(`${username} joined the game`)
      setWaitingForOpponent(false)
    })

    s.on('game-over', ({ winner: w }: { winner: string }) => {
      setWinner(w)
      const isMe = w === myUsernameRef.current
      if (isMe) {
        playWinJingle()
        setTimeout(() => speakLady('Congratulations! You win! Well done!'), 700)
      } else {
        playLoseSound()
        setTimeout(() => speakLady(`${w} wins! Better luck next time!`), 700)
      }
      axios
        .get(`/api/game/session-score/${sessionId}`, { headers: { Authorization: `Bearer ${token}` } })
        .then(({ data }) => setLiveScore({ myWins: data.myWins || 0, partnerWins: data.partnerWins || 0 }))
        .catch(() => {})
    })

    s.on('action-log', ({ player, action }: { player: string; action: string }) => {
      addLog(`${player} ${action}`)
      soundForAction(action)
      if (/general market/i.test(action)) {
        setTimeout(() => speakLady('General market! Everybody picks a card!'), 350)
      } else if (/played \w+ 2\b/.test(action)) {
        setTimeout(() => speakLady('Pick two!'), 300)
      } else if (/played \w+ 5\b/.test(action)) {
        setTimeout(() => speakLady('Pick three!'), 300)
      } else if (/WINS/i.test(action)) {
        // winner voice is handled in game-over handler
      }
    })

    s.on('player-disconnected', ({ username }: { username: string }) => {
      addLog(`⚠ ${username} disconnected`)
    })

    s.on('error', ({ message }: { message: string }) => {
      setError(message)
      setTimeout(() => setError(''), 3500)
    })

    s.on('rematch-requested', (data: { requesterUsername: string; sessionId: string }) => {
      setRematchIncoming(data)
    })

    s.on('rematch-accepted', ({ sessionId: newId }: { sessionId: string }) => {
      disconnectSocket()
      navigate(`/game/${newId}`)
    })

    s.on('rematch-declined', () => {
      setRematchRequested(false)
      setRematchDeclined(true)
    })

    s.on('score-clear-requested', ({ requesterUsername }: { requesterUsername: string }) => {
      setError(`${requesterUsername} wants to clear the score`)
      setTimeout(() => setError(''), 5000)
    })

    s.on('score-clear-sent', () => {
      addLog('Score clear request sent to opponent')
    })

    s.on('score-clear-cancelled', () => {
      addLog('Score clear request cancelled')
    })

    s.on('score-cleared', ({ confirmed }: { confirmed: boolean }) => {
      addLog(confirmed ? 'Score has been cleared!' : 'Score clear request processed')
    })

    return () => {
      clearTimeout(timeoutId)
      s.off('connect', onConnect)
      s.off('game-state')
      s.off('player-joined')
      s.off('game-over')
      s.off('action-log')
      s.off('player-disconnected')
      s.off('error')
      s.off('rematch-requested')
      s.off('rematch-accepted')
      s.off('rematch-declined')
      s.off('score-clear-requested')
      s.off('score-clear-sent')
      s.off('score-clear-cancelled')
      s.off('score-cleared')
    }
  }, [token, sessionId])

  function addLog(msg: string) {
    setLog(prev => [msg, ...prev.slice(0, 29)])
  }

  // ── Actions ────────────────────────────────────────────────────────────────
  const playCard = useCallback((cardId: string, pile: 1 | 2) => {
    socketRef.current?.emit('play-card', { sessionId, cardId, pileNum: pile })
    setSelectedCardIdx(null)
    setSelectedPile(null)
  }, [sessionId])

  const callShape = useCallback((shape: string) => {
    socketRef.current?.emit('call-shape', { sessionId, shape })
  }, [sessionId])

  const pickMarket = useCallback(() => {
    socketRef.current?.emit('pick-market', { sessionId })
    setSelectedCardIdx(null)
  }, [sessionId])

  const requestScoreClear = useCallback(() => {
    socketRef.current?.emit('request-score-clear', { sessionId })
  }, [sessionId])

  // ── Keyboard controls ──────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const gs  = gameStateRef.current
      if (!gs || !gs.isMyTurn || gs.status !== 'active') return

      // Shape call modal takes priority
      if (gs.waitingForShapeCall) return

      const hand = gs.myHand
      const pile = selectedPileRef.current
      const cidx = selectedCardIdxRef.current

      switch (e.key) {
        case '1':
          e.preventDefault()
          setSelectedPile(1)
          break
        case '2':
          e.preventDefault()
          setSelectedPile(2)
          break
        case 'ArrowLeft':
          e.preventDefault()
          setSelectedCardIdx(prev => {
            if (hand.length === 0) return null
            if (prev === null) return hand.length - 1
            return (prev - 1 + hand.length) % hand.length
          })
          break
        case 'ArrowRight':
          e.preventDefault()
          setSelectedCardIdx(prev => {
            if (hand.length === 0) return null
            if (prev === null) return 0
            return (prev + 1) % hand.length
          })
          break
        case 'Enter': {
          e.preventDefault()
          if (cidx === null) {
            setError('Select a card with ← → first')
            setTimeout(() => setError(''), 2000)
            break
          }
          if (pile === null) {
            setError('Select pile 1 or 2 first')
            setTimeout(() => setError(''), 2000)
            break
          }
          const card = hand[cidx]
          if (card) playCard(card.id, pile)
          break
        }
        case 'm':
        case 'M':
          e.preventDefault()
          pickMarket()
          break
        case 'Escape':
          setSelectedCardIdx(null)
          setSelectedPile(null)
          break
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [playCard, pickMarket])

  function copyRoomKey() {
    navigator.clipboard.writeText(roomKey)
    setKeyCopied(true)
    setTimeout(() => setKeyCopied(false), 2000)
  }

  function handleLeave() {
    disconnectSocket()
    navigate('/dashboard')
  }

  // ── Loading screen ─────────────────────────────────────────────────────────
  if (!gameState) {
    return (
      <div className={styles.loadingScreen}>
        {!connectTimeout ? (
          <>
            <div className={styles.spinner} />
            <p>Connecting to game…</p>
          </>
        ) : (
          <>
            <p style={{ color: '#e94560', fontWeight: 700 }}>Could not reach the game.</p>
            <p style={{ color: '#888', fontSize: '0.9rem' }}>Make sure the server is running.</p>
            <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
              <button
                onClick={() => { setConnectTimeout(false); socket?.emit('join-game', { sessionId }) }}
                style={{ background: '#00c9a7', color: '#000', border: 'none', borderRadius: 8, padding: '0.6rem 1.4rem', fontWeight: 700, cursor: 'pointer' }}
              >
                Retry
              </button>
              <button
                onClick={() => { disconnectSocket(); navigate('/dashboard') }}
                style={{ background: 'transparent', color: '#aaa', border: '1px solid #444', borderRadius: 8, padding: '0.6rem 1.4rem', cursor: 'pointer' }}
              >
                Back to Dashboard
              </button>
            </div>
          </>
        )}
      </div>
    )
  }

  const opponentName = gameState.myRole === 'host'
    ? gameState.guest?.username ?? 'Waiting…'
    : gameState.host.username
  const myName    = user?.username ?? ''
  const turnLabel = gameState.isMyTurn ? 'Your Turn' : `${opponentName}'s Turn`

  const showShapeModal = gameState.waitingForShapeCall && gameState.isMyTurn

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className={styles.room}>

      {/* WINNER OVERLAY */}
      {winner && (
        <div className={styles.overlay}>
          {winner === myName && <Confetti />}
          <div className={styles.overlayBox}>
            <div className={styles.winEmojis}>
              {winner === myName
                ? ['🎉', '💃', '🕺', '👏', '🎊'].map((e, i) => (
                    <span key={i} className={styles.winEmoji} style={{ animationDelay: `${i * 0.12}s` }}>{e}</span>
                  ))
                : ['💪', '🔥', '😤'].map((e, i) => (
                    <span key={i} className={styles.winEmoji} style={{ animationDelay: `${i * 0.12}s` }}>{e}</span>
                  ))
              }
            </div>
            <div className={`${styles.overlayTitle} ${winner === myName ? styles.overlayTitleWin : ''}`}>
              {winner === myName ? '🎉 You Win!' : `${winner} Wins!`}
            </div>

            {/* Rematch incoming request */}
            {rematchIncoming && (
              <div className={styles.rematchRequest}>
                <p><strong>{rematchIncoming.requesterUsername}</strong> wants to play again!</p>
                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', marginTop: '0.5rem' }}>
                  <button
                    className={styles.overlayBtn}
                    style={{ background: '#00c9a7', color: '#000', borderColor: '#00c9a7' }}
                    onClick={() => {
                      socketRef.current?.emit('respond-rematch', { sessionId: rematchIncoming.sessionId, accepted: true })
                      setRematchIncoming(null)
                    }}
                  >
                    Accept
                  </button>
                  <button
                    className={styles.overlayBtn}
                    style={{ background: '#c0392b', color: '#fff', borderColor: '#c0392b' }}
                    onClick={() => {
                      socketRef.current?.emit('respond-rematch', { sessionId: rematchIncoming.sessionId, accepted: false })
                      setRematchIncoming(null)
                    }}
                  >
                    Decline
                  </button>
                </div>
              </div>
            )}

            {/* My rematch request status */}
            {!rematchIncoming && rematchRequested && (
              <p className={styles.rematchWaiting}>Waiting for opponent to accept…</p>
            )}
            {!rematchIncoming && rematchDeclined && (
              <p className={styles.rematchWaiting} style={{ color: '#e94560' }}>Opponent declined the rematch.</p>
            )}

            {/* Buttons */}
            {!rematchIncoming && !rematchRequested && (
              <button
                className={styles.overlayBtn}
                style={{ background: '#00c9a7', color: '#000' }}
                onClick={() => {
                  socketRef.current?.emit('request-rematch', { sessionId })
                  setRematchRequested(true)
                  setRematchDeclined(false)
                }}
              >
                Play Again with {opponentName}
              </button>
            )}

            <button className={styles.overlayBtn} onClick={handleLeave}>
              Back to Dashboard
            </button>
          </div>
        </div>
      )}

      {/* SHAPE CALL MODAL */}
      {showShapeModal && (
        <div className={styles.overlay}>
          <div className={styles.overlayBox}>
            <div className={styles.overlayTitle}>Call a Shape</div>
            <p className={styles.overlayHint}>You played WHOT — choose the next shape:</p>
            <div className={styles.shapeGrid}>
              {SHAPES.map(sh => (
                <button
                  key={sh}
                  className={styles.shapeBtn}
                  style={{ '--btn-color': SHAPE_COLOR[sh] } as React.CSSProperties}
                  onClick={() => callShape(sh)}
                >
                  <span className={styles.shapeBtnSymbol}>{SHAPE_SYMBOL[sh]}</span>
                  <span>{sh}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TOP BAR */}
      <header className={styles.topBar}>
        <button className={styles.leaveBtn} onClick={handleLeave}>← Leave</button>
        <div className={styles.turnBadge} data-myturn={String(gameState.isMyTurn)}>
          {turnLabel}
        </div>
        <div className={styles.deckInfo}>
          <span className={styles.scoreBar}>
            <span className={styles.scoreBarWin}>{liveScore.myWins}</span>
            <span className={styles.scoreBarDivider}>-</span>
            <span className={styles.scoreBarLoss}>{liveScore.partnerWins}</span>
          </span>
          <button className={styles.scoreBtn} onClick={() => setShowScoreModal(true)}>
            Full Score
          </button>
        </div>
      </header>

      {/* SCORE MODAL */}
      {showScoreModal && (
        <div className={styles.scoreModal} onClick={() => setShowScoreModal(false)}>
          <div className={styles.scoreModalBox} onClick={e => e.stopPropagation()}>
            <button className={styles.scoreModalClose} onClick={() => setShowScoreModal(false)}>×</button>
            <div className={styles.scoreModalTitle}>Score</div>
            <div className={styles.scoreModalVs}>vs</div>
            <div className={styles.scoreModalNames}>
              <span className={styles.scoreModalPlayer}>{user?.username}</span>
              <span style={{ color: '#666', fontSize: '0.9rem' }}>vs</span>
              <span className={styles.scoreModalPlayer}>{opponentName}</span>
            </div>
            <div className={styles.scoreModalScore}>
              <span className={styles.scoreModalWin}>{liveScore.myWins}</span>
              <span className={styles.scoreModalDivider}>-</span>
              <span className={styles.scoreModalLoss}>{liveScore.partnerWins}</span>
            </div>
            <div className={styles.scoreModalActions}>
              <button className={`${styles.scoreModalBtn} ${styles.scoreModalBtnPrimary}`} onClick={requestScoreClear}>
                Clear Score
              </button>
              <button className={styles.scoreModalBtn} onClick={() => setShowScoreModal(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* WAITING BANNER */}
      {waitingForOpponent && (
        <div className={styles.waitingBanner}>
          <span>Waiting for opponent to join…</span>
          {roomKey && (
            <div className={styles.waitingKey}>
              <span>Key:</span>
              <strong className={styles.roomKeyText}>{roomKey}</strong>
              <button className={styles.copyKeyBtn} onClick={copyRoomKey}>
                {keyCopied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* PENDING PICKUP ALERT */}
      {gameState.pendingPickup > 0 && (
        <div className={styles.pickupBanner}>
          {gameState.isMyTurn
            ? `Pick up ${gameState.pendingPickup} cards — counter with a 2 or 5, or press M`
            : `Opponent must pick ${gameState.pendingPickup} cards`}
        </div>
      )}

      {/* ERROR BANNER */}
      {error && <div className={styles.errorBanner}>{error}</div>}

      <div className={styles.gameArea}>

        {/* OPPONENT */}
        <section className={styles.opponentArea}>
          <p className={styles.playerLabel}>
            {opponentName} — {gameState.opponentHandCount} card{gameState.opponentHandCount !== 1 ? 's' : ''}
          </p>
          <div className={styles.handRow}>
            {Array.from({ length: Math.min(gameState.opponentHandCount, 20) }).map((_, i) => (
              <CardBack key={i} />
            ))}
            {gameState.opponentHandCount === 0 && (
              <span className={styles.emptyHand}>No cards</span>
            )}
          </div>
        </section>

        {/* BOARD — two piles */}
        <section className={styles.boardArea}>
          <p className={styles.boardLabel}>Board</p>
          <div className={styles.pilesRow}>
            <PileSlot
              topCard={gameState.pile1Top}
              count={gameState.pile1Count}
              calledShape={gameState.calledShape1}
              pileNum={1}
              selected={selectedPile === 1}
              onClick={() => setSelectedPile(prev => prev === 1 ? null : 1)}
            />
            <PileSlot
              topCard={gameState.pile2Top}
              count={gameState.pile2Count}
              calledShape={gameState.calledShape2}
              pileNum={2}
              selected={selectedPile === 2}
              onClick={() => setSelectedPile(prev => prev === 2 ? null : 2)}
            />
          </div>
          <p className={styles.boardHint}>
            Click pile or press <kbd>1</kbd> / <kbd>2</kbd> to select a pile
          </p>
        </section>

        {/* MY HAND */}
        <section className={styles.myArea}>
          <p className={styles.playerLabel}>
            {myName} (You) — {gameState.myHand.length} card{gameState.myHand.length !== 1 ? 's' : ''}
          </p>
          <div className={styles.handRow}>
            {gameState.myHand.map((card, i) => (
              <CardFace
                key={card.id}
                card={card}
                selected={selectedCardIdx === i}
                dimmed={!gameState.isMyTurn}
                onClick={gameState.isMyTurn ? () => {
                  if (selectedPile !== null) {
                    playCard(card.id, selectedPile)
                  } else {
                    // Click on card without pile selected — select card + prompt
                    setSelectedCardIdx(i)
                    setError('Now select pile 1 or 2')
                    setTimeout(() => setError(''), 2000)
                  }
                } : undefined}
              />
            ))}
            {gameState.myHand.length === 0 && (
              <span className={styles.emptyHand}>No cards in hand</span>
            )}
          </div>

          {/* ACTIONS */}
          <div className={styles.actions}>
            <button
              className={styles.pickBtn}
              onClick={pickMarket}
              disabled={!gameState.isMyTurn}
              title="Pick from market (M)"
            >
              {gameState.pendingPickup > 0
                ? `Pick ${gameState.pendingPickup} from Market`
                : 'Pick from Market'}
              <kbd>M</kbd>
            </button>
          </div>

          <p className={styles.kbHint}>
            <kbd>←</kbd><kbd>→</kbd> select card &nbsp;·&nbsp;
            <kbd>1</kbd><kbd>2</kbd> select pile &nbsp;·&nbsp;
            <kbd>Enter</kbd> play &nbsp;·&nbsp;
            <kbd>M</kbd> market
          </p>
        </section>

      </div>

      {/* ACTION LOG */}
      <aside className={styles.logPanel}>
        <p className={styles.logTitle}>Game Log</p>
        <ul className={styles.logList}>
          {log.map((entry, i) => (
            <li key={i} className={styles.logEntry}>{entry}</li>
          ))}
          {log.length === 0 && <li className={styles.logEmpty}>No actions yet</li>}
        </ul>
      </aside>
    </div>
  )
}
