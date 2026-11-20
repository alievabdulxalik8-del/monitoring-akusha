// Общие функции для пульта, экрана и телефона игрока.
(function () {
  'use strict';
  const SV = (window.SV = {});
  const cfg = window.SVOYA_CONFIG || {};
  SV.params = new URLSearchParams(location.search);
  // ?local=1 — тестовый режим без интернета: вкладки ОДНОГО браузера общаются напрямую (BroadcastChannel)
  SV.local = SV.params.has('local');
  SV.VALUES = [100, 200, 300, 400, 500];
  SV.BUZZ_MS = 10000; // сколько секунд принимаются нажатия
  SV.FALSE_START_MS = 1000; // блокировка за фальстарт

  SV.$ = (s, el) => (el || document).querySelector(s);
  SV.esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  SV.store = {
    get(k, def) {
      try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; }
    },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };
  SV.uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  SV.roomFromUrl = () => (SV.params.get('room') || '').replace(/\D/g, '').slice(0, 4);
  SV.pageUrl = (page, room) => {
    const u = new URL(page, location.href);
    u.search = '';
    if (room) u.searchParams.set('room', room);
    if (SV.local) u.searchParams.set('local', '1');
    return u.toString();
  };
  SV.money = (n) => (n < 0 ? '−' : '') + Math.abs(n).toLocaleString('ru-RU');

  SV.qrSvg = (text) => {
    const qr = window.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ scalable: true, margin: 2 });
  };

  // Короткий звук «кто-то нажал»
  let actx = null;
  SV.unlockAudio = () => {
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
    } catch (e) {}
    return !!actx && actx.state === 'running';
  };
  SV.beep = (kind) => {
    if (!actx) return;
    const notes = kind === 'buzz' ? [[880, 0], [1320, 0.12]] : kind === 'bad' ? [[220, 0]] : kind === 'good' ? [[660, 0], [990, 0.1], [1320, 0.2]] : [[440, 0]];
    notes.forEach(([f, t]) => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = kind === 'bad' ? 'sawtooth' : 'square';
      o.frequency.value = f;
      const t0 = actx.currentTime + t;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + (kind === 'bad' ? 0.5 : 0.18));
      o.connect(g).connect(actx.destination);
      o.start(t0);
      o.stop(t0 + 0.6);
    });
  };

  // ---------- Связь ----------
  // SV.connect(room, {key, meta, onMsg, onPresence, onStatus}) → {send(msg)}
  // Все сообщения идут одним событием 'm'; поле t — тип сообщения.
  SV.connect = function (room, o) {
    const onStatus = o.onStatus || function () {};
    if (SV.local) {
      const bc = new BroadcastChannel('svoya-igra-' + room);
      bc.onmessage = (e) => o.onMsg && o.onMsg(e.data);
      setTimeout(() => onStatus('ok'), 0);
      return { send: (m) => bc.postMessage(m), local: true };
    }
    if (!cfg.supabaseKey) {
      onStatus('nokey');
      return { send() {} };
    }
    if (!SV._client) {
      SV._client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        realtime: { params: { eventsPerSecond: 50 } },
      });
    }
    const ch = SV._client.channel('svoya-igra-' + room, {
      config: { broadcast: { self: false, ack: false }, presence: { key: o.key || SV.uid() } },
    });
    ch.on('broadcast', { event: 'm' }, ({ payload }) => o.onMsg && o.onMsg(payload));
    if (o.onPresence) ch.on('presence', { event: 'sync' }, () => o.onPresence(ch.presenceState()));
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        if (o.meta) ch.track(o.meta);
        onStatus('ok');
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        onStatus('bad');
      }
    });
    return {
      send: (m) => ch.send({ type: 'broadcast', event: 'm', payload: m }),
    };
  };

  // Не давать экрану телефона гаснуть во время игры
  SV.keepAwake = () => {
    let lock = null;
    const req = () => {
      if (!('wakeLock' in navigator) || document.hidden) return;
      navigator.wakeLock.request('screen').then((l) => (lock = l), () => {});
    };
    req();
    document.addEventListener('visibilitychange', req);
    document.addEventListener('click', () => { if (!lock || lock.released) req(); });
  };

  SV.statusText = (s) =>
    s === 'ok' ? 'связь есть' : s === 'nokey' ? 'не указан ключ Supabase (config.js)' : s === 'bad' ? 'нет связи, переподключаюсь…' : 'подключаюсь…';
})();
