import axios from 'axios'
import { io, Socket } from 'socket.io-client'

const BASE_URL = import.meta.env.VITE_API_URL as string

// Centralized axios instance — all HTTP requests go through here
export const api = axios.create({
  baseURL: BASE_URL,
})

// Socket instance
let socket: Socket | null = null

export function getSocket(token: string): Socket {
  if (!socket) {
    socket = io(BASE_URL, {
      auth: { token },
      autoConnect: true,
    })
  }
  return socket
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect()
    socket = null
  }
}
