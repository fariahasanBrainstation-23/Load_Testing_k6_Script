import http from 'k6/http';
import { SELFCARE_BASE_URL } from '../../../config.js';

function authHeaders(token) {
  return { 'Content-Type': 'application/json', Platform: 'WEB_SELF_CARE', Authorization: `Bearer ${token}` };
}

export function createConversation(token) {
  const url = `${SELFCARE_BASE_URL}/myrace-superapp/api/v1/superapp/chat/conversations`;
  return http.post(url, JSON.stringify({ channel: 'SELF_CARE' }), { headers: authHeaders(token) });
}

export function getMessages(token, conversationId) {
  const url = `${SELFCARE_BASE_URL}/myrace-superapp/api/v1/superapp/chat/conversations/${conversationId}/messages`;
  return http.get(url, { headers: authHeaders(token) });
}

// `token` is the SID itself (not the JWT), matching the captured browser WebSocket URL.
export function chatSocketUrl({ sid, displayName, conversationId }) {
  const wsBase = SELFCARE_BASE_URL.replace(/^https/, 'wss');
  const query = [
    ['role', 'customer'],
    ['token', sid],
    ['displayName', displayName],
    ['conversationId', conversationId],
    ['EIO', '4'],
    ['transport', 'websocket'],
  ]
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return `${wsBase}/ws/socket.io/?${query}`;
}

// Socket.IO event with ack id, e.g. buildEventFrame('chat:message', {...}, 0) -> '420["chat:message",{...}]'
export function buildEventFrame(event, payload, ackId) {
  return `42${ackId}${JSON.stringify([event, payload])}`;
}

// Parses a Socket.IO event frame ('42' or '42<ackId>' followed by a JSON array). Returns { event, payload } or null.
export function parseEventFrame(data) {
  const match = /^42\d*(\[[\s\S]*\])$/.exec(data);
  if (!match) return null;
  try {
    const [event, payload] = JSON.parse(match[1]);
    return { event, payload };
  } catch {
    return null;
  }
}
