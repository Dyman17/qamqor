import { authHeaders } from './api';

/**
 * Server-Sent Events over fetch + ReadableStream. Native EventSource cannot send the Authorization and
 * x-farm-id headers the server requires (GET /api/v1/device/stream, max 5 streams per user).
 * Reconnects with backoff (2 s -> 30 s); stops for good only on 401 (the normal request/session logic takes over)
 * and after close(). 403 is retried at the maximum delay (a role or farm change can fix it). A 45 s silence
 * (no data and no heartbeat) aborts the connection and reconnects.
 * Only default ("message") events are delivered, like EventSource.onmessage.
 */
export interface StreamHandle { close(): void }

const URL_BASE = '/api/v1/device/stream';
const MIN_DELAY = 2000;
const MAX_DELAY = 30000;
const STALL_MS = 45000;

export function openStream(query: Record<string, string>, onMessage: (evt: { data: string }) => void): StreamHandle {
  let closed = false;
  let ctl: AbortController | null = null;
  let retryTimer = 0;
  let delay = MIN_DELAY;
  let nextDelay = 0; // one-off wait (403)
  const qs = new URLSearchParams(query).toString();

  async function run(): Promise<void> {
    if (closed) return;
    ctl = new AbortController();
    const mine = ctl;
    let fatal = false;
    let stall = 0;
    try {
      const res = await fetch(qs ? `${URL_BASE}?${qs}` : URL_BASE, {
        headers: { Accept: 'text/event-stream', ...authHeaders() },
        cache: 'no-store',
        signal: mine.signal,
      });
      if (res.status === 401) { fatal = true; return; }
      if (res.status === 403) { nextDelay = MAX_DELAY; throw new Error('stream 403'); }
      if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
      delay = MIN_DELAY;
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = '';
      let data: string[] = [];
      let event = '';
      const arm = (): void => { window.clearTimeout(stall); stall = window.setTimeout(() => mine.abort(), STALL_MS); };
      arm();
      const line = (l: string): void => {
        if (closed) return;
        if (l === '') {
          if (data.length && (event === '' || event === 'message')) {
            try { onMessage({ data: data.join('\n') }); } catch (e) { console.error('stream handler failed:', e); }
          }
          data = []; event = '';
          return;
        }
        if (l.startsWith(':')) return; // comment / heartbeat
        const i = l.indexOf(':');
        const field = i === -1 ? l : l.slice(0, i);
        let value = i === -1 ? '' : l.slice(i + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'data') data.push(value);
        else if (field === 'event') event = value;
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        arm();
        buf += value;
        let m: RegExpExecArray | null;
        while ((m = /\r\n|\n|\r/.exec(buf))) {
          // a lone CR at the very end of a chunk may be the first half of CRLF: wait for the next chunk
          if (m[0] === '\r' && m.index + 1 === buf.length) break;
          line(buf.slice(0, m.index));
          buf = buf.slice(m.index + m[0].length);
        }
      }
    } catch {
      /* aborted by close(), the stall watchdog, or a network failure: reconnect below */
    } finally {
      window.clearTimeout(stall);
      if (!closed && !fatal) {
        const wait = nextDelay || delay;
        nextDelay = 0;
        retryTimer = window.setTimeout(() => void run(), wait);
        delay = Math.min(delay * 2, MAX_DELAY);
      }
    }
  }

  void run();
  return {
    close() {
      closed = true;
      window.clearTimeout(retryTimer);
      ctl?.abort();
    },
  };
}
