import { sleep } from 'k6';
import exec from 'k6/execution';
import { Trend, Counter } from 'k6/metrics';
import { WebSocket } from 'k6/experimental/websockets';
import { SharedArray } from 'k6/data';
import { htmlReport } from '../../lib/vendor/k6-reporter.bundle.js';
import { textSummary } from '../../lib/vendor/k6-summary.js';
import { defaultOptions } from '../../config.js';
import { selfCareLogin } from '../lib/auth.js';
import { parseCsv } from '../lib/csv.js';
import { checkStatus200 } from '../../lib/checks.js';
import { createRequestLogger } from '../../lib/requestLogger.js';
import { buildProfileOptions } from '../../lib/profiles.js';
import {
  createConversation,
  getMessages,
  chatSocketUrl,
  buildEventFrame,
  parseEventFrame,
} from './lib/liveSupport.js';

const credentials = new SharedArray('selfcare_credentials', function () {
  return parseCsv(open('../data/LoginCustomer100.csv'));
});

const MESSAGE = __ENV.MESSAGE || 'hello';
const REPLY_TIMEOUT_SECONDS = Number(__ENV.REPLY_TIMEOUT) || 60;
const REPEAT = Number(__ENV.REPEAT) || 1;

const { logRequest, getLogs } = createRequestLogger('live_support_test.js');

const { options, indexFor } = buildProfileOptions({
  listLength: credentials.length * REPEAT,
  thresholds: defaultOptions.thresholds,
});
export { options };

const chatEchoMs = new Trend('chat_echo_ms', true);
const chatAgentReplyMs = new Trend('chat_agent_reply_ms', true);
const chatAgentReplies = new Counter('chat_agent_replies');
const chatRepliesTimedOut = new Counter('chat_replies_timed_out');

export function handleSummary(data) {
  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    'reports/live_support-report.html': htmlReport(data),
    'reports/live_support-summary.txt': textSummary(data, { indent: ' ', enableColors: false }),
    'reports/summary.json': JSON.stringify(data, null, 2),
    'reports/live_support-log.json': JSON.stringify(getLogs(), null, 2),
  };
}

export default function () {
  const index = indexFor(exec, __VU, __ITER);
  const cred = credentials[index % credentials.length];

  const loginRes = selfCareLogin(cred.SID, cred.Password);
  logRequest({
    apiName: 'LOGIN',
    requestMethod: 'POST',
    url: loginRes.url,
    requestPayload: { username: cred.SID, password: cred.Password },
    statusCode: loginRes.status,
    errorMessage: loginRes.error || '',
    responseTime: loginRes.timings?.duration,
    responseBody: loginRes.body,
  });
  if (!checkStatus200(loginRes)) {
    sleep(1);
    return;
  }
  const token = loginRes.json('access_token');

  const convRes = createConversation(token);
  logRequest({
    apiName: 'CHAT_CREATE_CONVERSATION',
    requestMethod: 'POST',
    url: convRes.url,
    requestPayload: { channel: 'SELF_CARE' },
    statusCode: convRes.status,
    errorMessage: convRes.error || '',
    responseTime: convRes.timings?.duration,
    responseBody: convRes.body,
  });
  let conversationId;
  try {
    conversationId = checkStatus200(convRes) ? convRes.json('id') : null;
  } catch {
    conversationId = null;
  }
  if (!conversationId) {
    sleep(1);
    return;
  }

  const msgsRes = getMessages(token, conversationId);
  logRequest({
    apiName: 'CHAT_GET_MESSAGES',
    requestMethod: 'GET',
    url: msgsRes.url,
    statusCode: msgsRes.status,
    errorMessage: msgsRes.error || '',
    responseTime: msgsRes.timings?.duration,
    responseBody: msgsRes.body,
  });
  checkStatus200(msgsRes);

  const wsUrl = chatSocketUrl({ sid: cred.SID, displayName: cred.SID, conversationId });
  const ws = new WebSocket(wsUrl);

  let sent = false;
  let sentAt = null;
  let echoed = false;
  let gotAgentReply = false;
  let agentReplyBody = '';
  let wsError = '';

  // Handshake mirrors the browser: server sends "0{...}", client answers "40", server confirms "40{sid}",
  // then the client emits its chat:message with ack id 0.
  ws.onmessage = (event) => {
    const data = String(event.data);
    if (__ENV.WS_DEBUG === 'true') console.log(`WS recv: ${data.slice(0, 200)}`);

    if (data.startsWith('0') && !sent) {
      ws.send('40');
      return;
    }
    if (data.startsWith('40') && !sent) {
      sent = true;
      sentAt = Date.now();
      ws.send(buildEventFrame('chat:message', { conversationId, content: MESSAGE, type: 'TEXT' }, 0));
      return;
    }
    if (data === '2') {
      ws.send('3');
      return;
    }
    if (data.includes('system:error')) {
      wsError = data;
      ws.close();
      return;
    }

    const frame = parseEventFrame(data);
    if (!frame || frame.event !== 'chat:message' || !frame.payload || !frame.payload.sender) return;
    const { sender, content } = frame.payload;

    if (sender.type === 'CUSTOMER' && content === MESSAGE && !echoed) {
      echoed = true;
      chatEchoMs.add(Date.now() - sentAt);
    } else if (sender.type === 'AGENT' && !gotAgentReply) {
      gotAgentReply = true;
      agentReplyBody = data;
      chatAgentReplyMs.add(Date.now() - sentAt);
      chatAgentReplies.add(1);
      ws.close();
    }
  };

  ws.onerror = (event) => {
    wsError = wsError || JSON.stringify(event);
  };

  // k6 delivers WebSocket events only while the iteration yields to the event loop, so the wait is a timer,
  // not a blocking sleep loop (a loop here never sees the reply and always times out).
  const timeoutId = setTimeout(() => {
    if (!gotAgentReply) {
      chatRepliesTimedOut.add(1);
      ws.close();
    }
  }, REPLY_TIMEOUT_SECONDS * 1000);

  ws.onclose = () => {
    clearTimeout(timeoutId);
    logRequest({
      apiName: 'CHAT_WS_MESSAGE',
      requestMethod: 'WS',
      url: wsUrl,
      requestPayload: { conversationId, content: MESSAGE, type: 'TEXT' },
      statusCode: gotAgentReply ? 200 : wsError ? 0 : 504,
      errorMessage: wsError,
      responseTime: sentAt && gotAgentReply ? Date.now() - sentAt : null,
      responseBody: agentReplyBody,
    });
  };
}
