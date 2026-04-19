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

  // Keyboard / interaction state
  const [selectedPile, setSelectedPile] = useState<1 | 2 | null>(null)
  const [selectedCardIdx, setSelectedCardIdx] = useState<number | null>(null)

  const gameStateRef = useRef<GameState | null>(null)
  const selectedPileRef = useRef<1 | 2 | null>(null)
  const selectedCardIdxRef = useRef<number | null>(null)
  const socketRef = useRef<Socket | null>(null)

  // Keep refs in sync
  gameStateRef.current    = gameState
  selectedPileRef.current = selectedPile
  selectedCardIdxRef.current = selectedCardIdx
  socketRef.current       = socket

  // Fetch room key so host can share it
  useEffect(() => {
    if (!token || !sessionId) return
    axios
      .get(`/api/game/session/${sessionId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(({ data }) => setRoomKey(data.session.connectionKey))
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
    })

    s.on('action-log', ({ player, action }: { player: string; action: string }) => {
      addLog(`${player} ${action}`)
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
          <div className={styles.overlayBox}>
            <div className={styles.overlayTitle}>
              {winner === myName ? '🎉 You Win!' : `${winner} Wins!`}
            </div>

            {/* Rematch incoming request */}
            {rematchIncoming && (
              <div className={styles.rematchRequest}>
                <p><strong>{rematchIncoming.requesterUsername}</strong> wants to play again!</p>
                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', marginTop: '0.5rem' }}>
                  <button
                    className={styles.overlayBtn}
                    style={{ background: '#00c9a7' }}
                    onClick={() => {
                      socketRef.current?.emit('respond-rematch', { sessionId: rematchIncoming.sessionId, accepted: true })
                      setRematchIncoming(null)
                    }}
                  >
                    Accept
                  </button>
                  <button
                    className={styles.overlayBtn}
                    style={{ background: '#555' }}
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
          Market: <strong>{gameState.deckCount}</strong>
        </div>
      </header>

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
