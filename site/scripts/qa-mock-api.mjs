// QA only: a fetch() mock for /api/v1 injected into the page before it loads (no real server, no accounts created anywhere).
// Behaviour switches live on window.__mock: { role, loginError, network, empty, fail, secret }.
export function mockSource() {
  return `(() => {
  const M = window.__mock = { role: 'OWNER', loginError: null, network: false, empty: false, fail: null, online: false, calls: [] };
  const now = Date.now();
  const iso = (minAgo) => new Date(now - minAgo * 60000).toISOString();
  const farm = () => ({ id: 'farm1', name: 'Ферма Демо', timezone: 'Asia/Aqtau', workerCanEditBoundaries: false, myRole: M.role });
  const animals = () => M.empty ? [] : [
    { id: 'a1', farmId: 'farm1', name: 'Корова #0142', tag: '0142', species: 'CATTLE', penId: 'p1', collarId: 'COLLAR-01', lat: 43.6502, lng: 51.1498, accuracyM: 6, lastSeenAt: iso(3), status: 'danger' },
    { id: 'a2', farmId: 'farm1', name: 'Корова #0087', tag: '0087', species: 'CATTLE', penId: 'p1', collarId: 'COLLAR-02', lat: 43.6510, lng: 51.1520, accuracyM: 5, lastSeenAt: iso(2), status: 'ok' },
    { id: 'a3', farmId: 'farm1', name: 'Лошадь Гнедко', tag: '0231', species: 'HORSE', penId: null, collarId: null, lat: null, lng: null, accuracyM: null, lastSeenAt: null, status: 'offline' },
    { id: 'a4', farmId: 'farm1', name: 'Овца #0310', tag: '0310', species: 'SHEEP', penId: 'p1', collarId: 'COLLAR-03', lat: 43.6490, lng: 51.1535, accuracyM: 9, lastSeenAt: iso(40), status: 'offline' },
  ];
  const pens = () => M.empty ? [] : [{ id: 'p1', farmId: 'farm1', name: 'Загон «Северный»', color: '#0D4A2B', animalsCount: 3, areaHa: 12, polygon: { type: 'Polygon', coordinates: [[[51.147, 43.648], [51.156, 43.648], [51.156, 43.653], [51.147, 43.653], [51.147, 43.648]]] } }];
  const devices = () => M.empty ? [] : [
    { deviceId: 'COLLAR-01', status: 'ONLINE', animalId: 'a1', animalName: 'Корова #0142', signalRssi: -78, firmwareVersion: null, lastSeenAt: iso(3) },
    { deviceId: 'COLLAR-02', status: 'ONLINE', animalId: 'a2', animalName: 'Корова #0087', signalRssi: -91, firmwareVersion: null, lastSeenAt: iso(2) },
    { deviceId: 'COLLAR-03', status: 'OFFLINE', animalId: 'a4', animalName: 'Овца #0310', signalRssi: null, firmwareVersion: null, lastSeenAt: iso(40) },
    { deviceId: 'COLLAR-09', status: 'UNASSIGNED', animalId: null, animalName: null, signalRssi: null, firmwareVersion: null, lastSeenAt: null },
  ];
  const alerts = () => M.empty ? [] : [
    { id: 'al1', type: 'GEOFENCE_BREACH', severity: 'CRITICAL', status: 'ACTIVE', animalId: 'a1', animalName: 'Корова #0142', penName: 'Загон «Северный»', message: 'Вышла за границу загона', lat: 43.6502, lng: 51.1498, createdAt: iso(5), isRead: false },
    { id: 'al2', type: 'DEVICE_OFFLINE', severity: 'WARNING', status: 'ACTIVE', animalId: 'a4', animalName: 'Овца #0310', penName: null, message: 'Нет сигнала дольше 15 минут', lat: null, lng: null, createdAt: iso(25), isRead: true },
  ];
  const me = () => ({ user: { id: 'u1', email: 'qa@example.test', fullName: 'QA Тест' }, memberships: [{ farmId: 'farm1', farmName: 'Ферма Демо', role: M.role }] });
  let polls = 0;
  const json = (status, body, headers = {}) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
    if (!url.pathname.startsWith('/api/v1')) return realFetch(input, init);
    const path = url.pathname.slice(7), method = (init.method || 'GET').toUpperCase();
    M.calls.push(method + ' ' + path + url.search);
    if (M.network) throw new TypeError('Failed to fetch');
    if (M.fail && path.startsWith(M.fail)) return json(500, { statusCode: 500, code: 'SERVER', message: 'boom' });
    await new Promise((r) => setTimeout(r, 120));
    if (path === '/auth/login') {
      if (M.loginError === 429) return json(429, { statusCode: 429, code: 'RATE_LIMITED', message: 'rate' });
      if (M.loginError === 401) return json(401, { statusCode: 401, code: 'UNAUTHENTICATED', message: 'bad' });
      return json(200, { token: 'mock-token', ...me() });
    }
    if (path === '/auth/register') return json(409, { statusCode: 409, code: 'CONFLICT', message: 'exists' });
    if (path === '/auth/password-reset/request') return M.role === 'NOMAIL' ? json(503, { statusCode: 503, code: 'MAIL_NOT_CONFIGURED', message: 'x' }) : new Response(null, { status: 204 });
    const auth = (init.headers || {}).Authorization;
    if (!auth) return json(401, { statusCode: 401, code: 'UNAUTHENTICATED', message: 'no token' });
    if (path === '/auth/me') return json(200, me());
    if (path === '/farms' && method === 'GET') return json(200, [farm()]);
    if (path === '/animals' && method === 'GET') return json(200, animals());
    if (/^\\/animals\\/a\\d$/.test(path)) return json(200, animals().find((a) => a.id === path.split('/')[2]));
    if (/^\\/animals\\/a\\d\\/events$/.test(path)) return json(200, { alerts: alerts(), signals: { day: '2026-11-09', sound: { used: 2, limit: 5 }, vibration: { used: 1, limit: null }, impulse: { used: 0, limit: null, available: false } } });
    if (path === '/geofences') return json(200, pens());
    if (path === '/devices' && method === 'GET') return json(200, devices());
    if (path === '/devices' && method === 'POST') {
      const b = JSON.parse(init.body);
      if (b.deviceId === 'TAKEN') return json(409, { statusCode: 409, code: 'CONFLICT', message: 'exists' });
      M.secret = 'k3Xq9TfA7mZb2LwR8vNc5HdY1sPe4UgJ';
      return json(201, { collar: { deviceId: b.deviceId, status: 'OFFLINE', animalId: null, animalName: null, signalRssi: null, firmwareVersion: null, lastSeenAt: null }, deviceSecret: M.secret });
    }
    if (/^\\/devices\\/[^/]+$/.test(path) && method === 'GET') {
      const id = decodeURIComponent(path.split('/')[2]);
      const d = devices().find((x) => x.deviceId === id);
      if (d) return json(200, d);
      polls++;
      return json(200, { deviceId: id, status: polls >= 2 || M.online ? 'ONLINE' : 'OFFLINE', animalId: null, animalName: null, signalRssi: -80, firmwareVersion: null, lastSeenAt: polls >= 2 || M.online ? iso(0) : null });
    }
    if (path === '/alerts/stats') return json(200, { activeTotal: M.empty ? 0 : 2, activeBreaches: 1, offline: 1 });
    if (path === '/alerts' && method === 'GET') return json(200, alerts());
    if (/^\\/alerts\\/[^/]+\\/status$/.test(path)) return json(200, alerts()[0]);
    if (/^\\/farms\\/farm1\\/members$/.test(path)) return json(200, { members: [{ userId: 'u1', email: 'qa@example.test', fullName: 'QA Тест', role: 'OWNER' }, { userId: 'u2', email: 'w@example.test', fullName: 'Работник', role: 'WORKER' }], invitations: [{ id: 'i1', email: 'new@example.test', status: 'PENDING', expiresAt: iso(-60 * 24 * 6) }] });
    if (/^\\/farms\\/farm1\\/invitations$/.test(path) && method === 'POST') return json(201, { id: 'i2', email: 'x@example.test', status: 'PENDING', expiresAt: iso(-60), delivered: false, inviteUrl: location.origin + '/invite?token=demo' });
    if (/^\\/farms\\/farm1\\/signal-limits$/.test(path)) return json(200, [{ level: 'SOUND', dailyLimit: 5, unlimited: false }, { level: 'VIBRATION', dailyLimit: null, unlimited: true }, { level: 'IMPULSE', dailyLimit: null, unlimited: false }]);
    return json(404, { statusCode: 404, code: 'NOT_FOUND', message: path });
  };
})();`;
}
