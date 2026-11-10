import { authHeaders } from './api';

/**
 * Server-Sent Events over fetch + ReadableStream. Native EventSource cannot send the Authorization and
 * x-farm-id headers the server requires (GET /api/v1/device/stream, max 5 streams per user).
 * Reconnects with backoff (2 s -> 30 s); stops for good on 401/403 (the normal request/session logic takes over)
 * and after close(). Only default ("message") events are delivered, like EventSource.onmessage.
 */
export interface StreamHandle { close(): void }

const URL_BASE = '/api/v1/device/stream';
const MIN_DELAY = 2000;
const MAX_DELAY = 30000;

export function openStream(query: Record<string, string>, onMessage: (evt: { data: string }) => void): StreamHandle {
  let closed = false;
  let ctl: AbortController | null = null;
  let retryTimer = 0;
  let delay = MIN_DELAY;
  const qs = new URLSearchParams(query).toString();

  async function run(): Promise<void> {
    if (closed) return;
    ctl = new AbortController();
    let fatal = false;
    try {
      const res = await fetch(qs ? `${URL_BASE}?${qs}` : URL_BASE, {
        headers: { Accept: 'text/event-stream', ...authHeaders() },
        cache: 'no-store',
        signal: ctl.signal,
      });
      if (res.status === 401 || res.status === 403) { fatal = true; return; }
      if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
      delay = MIN_DELAY;
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = '';
      let data: string[] = [];
      let event = '';
      const line = (l: string): void => {
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
        buf += value;
        let m: RegExpExecArray | null;
        while ((m = /\r\n|\n|\r/.exec(buf))) {
          line(buf.slice(0, m.index));
          buf = buf.slice(m.index + m[0].length);
        }
      }
    } catch {
      /* aborted by close() or a network failure: reconnect below */
    } finally {
      if (!closed && !fatal) {
        retryTimer = window.setTimeout(() => void run(), delay);
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
