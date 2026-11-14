'use strict';
/*
 * Atölye Yazıcı servisi (Windows) — Bambu Lab yazıcıyı ev ağından (LAN) izler ve
 * durumu + biten baskıları Supabase'teki Atölye Defteri veritabanına yazar.
 * Claude'a bağlı değildir; bilgisayar açıkken arka planda çalışır.
 * (Mac'teki atolye-yazici eklentisinin yazıcı tarafı aynen kullanıldı.)
 * Dış bağımlılığı yoktur; yalnızca Node'un kendi modüllerini kullanır.
 *
 *  - Yazıcıyı ağda kendisi bulur (SSDP); IP elle de verilebilir.
 *  - MQTT (8883, TLS) ile durumu SADECE OKUR; yazıcıya komut göndermez
 *    (tek istisna: "durumunu gönder" anlamına gelen pushall isteği).
 *  - Biten baskıları ~/.atolye-yazici/state.json dosyasına yazar.
 *  - Filament gramını, yazıcıdaki .3mf dosyasından (FTPS 990) okumayı dener.
 */
const tls = require('tls'), net = require('net'), dgram = require('dgram'), fs = require('fs'),
  os = require('os'), path = require('path'), zlib = require('zlib'), crypto = require('crypto');

const VERSION = '1.0.0';
const AYAR_FILE = path.join(__dirname, 'ayarlar.json');
let AYAR = {}; try { AYAR = JSON.parse(fs.readFileSync(AYAR_FILE, 'utf8')); } catch (e) {}
const a = k => String(AYAR[k] == null ? '' : AYAR[k]).trim();
const CFG = {
  ip: a('yaziciIp'),
  serial: a('seriNo').toUpperCase().replace(/[^0-9A-Z]/g, ''),
  code: a('erisimKodu'),
  mqttPort: 8883, ftpPort: 990,
  dir: path.join(os.homedir(), '.atolye-yazici-servis'),
  discovery: true, ftp: AYAR.ftp !== false,
  sbUrl: a('supabaseUrl').replace(/\/+$/, ''), sbKey: a('supabaseKey'), token: a('anahtar'),
  device: a('cihaz') || os.hostname(),
  port: +AYAR.port || 47611,
};
const LOG_FILE = path.join(CFG.dir, 'servis.log');
const log = (...x) => {
  const line = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' ' + x.join(' ') + '\n';
  try { fs.mkdirSync(CFG.dir, { recursive: true }); const st = fs.existsSync(LOG_FILE) ? fs.statSync(LOG_FILE) : null; if (st && st.size > 1e6) fs.renameSync(LOG_FILE, LOG_FILE + '.1'); fs.appendFileSync(LOG_FILE, line); } catch (e) {}
  try { process.stdout.write(line); } catch (e) {}
};
const MODELS = { N1: 'A1 mini', N2S: 'A1', C11: 'P1P', C12: 'P1S', C13: 'X1E', 'BL-P001': 'X1 Carbon', 'BL-P002': 'X1', O1D: 'H2D' };

/* ---------- Kalıcı kayıt ---------- */
let DB = { v: 1, init: false, jobs: [], cur: null, lastKey: '' };
const STATE_FILE = path.join(CFG.dir, 'state.json');
try {
  const j = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  if (j && Array.isArray(j.jobs)) DB = { v: 1, init: !!j.init, jobs: j.jobs, cur: j.cur || null, lastKey: j.lastKey || '' };
} catch (e) {}
let saveT = null;
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    try {
      fs.mkdirSync(CFG.dir, { recursive: true });
      if (DB.jobs.length > 500) DB.jobs = DB.jobs.slice(-500);
      const tmp = STATE_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(DB));
      fs.renameSync(tmp, STATE_FILE);
    } catch (e) { log('kayit yazilamadi:', e.message); }
  }, 300);
}

/* ---------- Ağda yazıcı bulma (SSDP) ---------- */
const FOUND = new Map();
function parseSsdp(txt, from) {
  if (!/bambulab/i.test(txt)) return;
  const h = k => { const m = new RegExp('^' + k + ':\\s*(.+)$', 'im').exec(txt); return m ? m[1].trim() : ''; };
  const serial = h('USN').toUpperCase().replace(/[^0-9A-Z]/g, ''), loc = h('Location');
  const ip = /^\d+\.\d+\.\d+\.\d+$/.test(loc) ? loc : (from && from.address) || '';
  if (!serial || !ip) return;
  const isNew = !FOUND.has(serial);
  FOUND.set(serial, { ip, serial, model: h('DevModel\\.bambu\\.com'), name: h('DevName\\.bambu\\.com'), seen: Date.now() });
  if (isNew) { log('yazici bulundu:', ip); if (!M.sock && !M.connected) { clearTimeout(M.timer); M.timer = setTimeout(connectMqtt, 200); } }
}
function startDiscovery() {
  if (!CFG.discovery) return;
  for (const port of [2021, 1990]) {
    try {
      const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      s.on('message', (msg, r) => { try { parseSsdp(msg.toString('utf8'), r); } catch (e) {} });
      s.on('error', () => { try { s.close(); } catch (e) {} });
      s.bind(port, () => {
        try { s.addMembership('239.255.255.250'); } catch (e) {}
        try {
          const q = Buffer.from('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 3\r\nST: urn:bambulab-com:device:3dprinter:1\r\n\r\n');
          s.send(q, port, '239.255.255.250', () => {});
        } catch (e) {}
      });
      s.unref();
    } catch (e) {}
  }
}
function target() {
  let f = null;
  if (CFG.serial && FOUND.has(CFG.serial)) f = FOUND.get(CFG.serial);
  else if (CFG.ip) f = [...FOUND.values()].find(x => x.ip === CFG.ip) || null;
  else if (!CFG.serial) f = [...FOUND.values()].sort((a, b) => b.seen - a.seen)[0] || null;
  return { ip: CFG.ip || (f && f.ip) || '', serial: CFG.serial || (f && f.serial) || '', model: f ? f.model : '', name: f ? f.name : '' };
}

/* ---------- MQTT (asgari istemci) ---------- */
const str = s => { const b = Buffer.from(String(s), 'utf8'), l = Buffer.alloc(2); l.writeUInt16BE(b.length); return Buffer.concat([l, b]); };
const varint = n => { const o = []; do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; o.push(d); } while (n > 0); return Buffer.from(o); };
const pkt = (h, body) => Buffer.concat([Buffer.from([h]), varint(body.length), body]);

const M = { sock: null, connected: false, buf: Buffer.alloc(0), err: null, lastMsg: 0, serial: '', ip: '', model: '', name: '', retry: 5000, timer: null, ping: null, push: null, subAt: 0 };
let P = {};               // yazıcının birleştirilmiş son durumu
let lastUpdate = 0;

function schedule(ms) { clearTimeout(M.timer); M.timer = setTimeout(connectMqtt, ms || M.retry); M.retry = Math.min(60000, Math.round(M.retry * 1.6)); }
function drop(err) {
  if (err) M.err = err;
  M.connected = false;
  clearInterval(M.ping); clearInterval(M.push);
  const s = M.sock; M.sock = null; M.buf = Buffer.alloc(0);
  if (s) { try { s.removeAllListeners(); s.on('error', () => {}); s.destroy(); } catch (e) {} }
  schedule();
}
function connectMqtt() {
  clearTimeout(M.timer);
  if (M.sock) return;
  if (!CFG.code) { M.err = { code: 'no_code', msg: 'Erişim kodu girilmemiş.' }; return; }
  const t = target();
  if (!t.ip) { M.err = { code: 'no_printer', msg: 'Yazıcı ağda bulunamadı. Yazıcı açık ve aynı Wi-Fi ağında mı? Gerekirse IP adresini eklenti ayarına yaz.' }; schedule(8000); return; }
  M.ip = t.ip; M.model = t.model; M.name = t.name;
  let sock;
  try { sock = tls.connect({ host: t.ip, port: CFG.mqttPort, rejectUnauthorized: false }); }
  catch (e) { M.err = { code: 'unreachable', msg: e.message }; schedule(); return; }
  M.sock = sock;
  sock.setTimeout(20000);
  sock.on('timeout', () => drop({ code: 'unreachable', msg: 'Yazıcı yanıt vermiyor (' + t.ip + ').' }));
  sock.on('error', e => drop({ code: 'unreachable', msg: 'Yazıcıya bağlanılamadı (' + t.ip + '): ' + (e.code || e.message) }));
  sock.on('close', () => { if (M.sock === sock) drop(M.connected ? { code: 'unreachable', msg: 'Bağlantı koptu, yeniden deneniyor.' } : null); });
  sock.on('secureConnect', () => {
    let cn = '';
    try { cn = String((sock.getPeerCertificate().subject || {}).CN || '').toUpperCase(); } catch (e) {}
    M.serial = t.serial || (/^[0-9A-Z]{12,20}$/.test(cn) ? cn : '');
    if (!M.serial) return drop({ code: 'no_serial', msg: 'Yazıcının seri numarası öğrenilemedi. Eklenti ayarına seri numarasını yaz.' });
    const id = 'atolye-' + crypto.randomBytes(4).toString('hex');
    sock.write(pkt(0x10, Buffer.concat([str('MQTT'), Buffer.from([4, 0xC2, 0, 60]), str(id), str('bblp'), str(CFG.code)])));
  });
  sock.on('data', onData);
}
function onData(chunk) {
  M.buf = M.buf.length ? Buffer.concat([M.buf, chunk]) : chunk;
  for (;;) {
    if (M.buf.length < 2) return;
    let mult = 1, len = 0, i = 1, d;
    do {
      if (i >= M.buf.length) return;
      if (i > 4) return drop({ code: 'unreachable', msg: 'Beklenmeyen yanıt.' });
      d = M.buf[i++]; len += (d & 127) * mult; mult *= 128;
    } while (d & 128);
    if (M.buf.length < i + len) return;
    const h = M.buf[0], body = M.buf.subarray(i, i + len);
    M.buf = Buffer.from(M.buf.subarray(i + len));
    try { handle(h, body); } catch (e) { log('paket hatasi:', e.message); }
    if (!M.sock) return;
  }
}
function pushall() {
  if (!M.sock || !M.connected) return;
  M.sock.write(pkt(0x30, Buffer.concat([str('device/' + M.serial + '/request'), Buffer.from(JSON.stringify({ pushing: { sequence_id: '0', command: 'pushall' } }))])));
}
function handle(h, body) {
  const type = h >> 4, sock = M.sock;
  if (type === 2) {                       // CONNACK
    const rc = body[1];
    if (rc !== 0) return drop({ code: rc === 4 || rc === 5 ? 'auth' : 'unreachable', msg: rc === 4 || rc === 5 ? 'Erişim kodu kabul edilmedi. Yazıcı ekranındaki kodu eklenti ayarına yeniden yaz.' : 'Yazıcı bağlantıyı reddetti (kod ' + rc + ').' });
    M.connected = true; M.err = null; M.retry = 5000; M.subAt = Date.now();
    sock.setTimeout(100000);
    sock.write(pkt(0x82, Buffer.concat([Buffer.from([0, 1]), str('device/' + M.serial + '/report'), Buffer.from([0])])));
    pushall();
    M.ping = setInterval(() => {
      if (!M.sock) return;
      try { M.sock.write(Buffer.from([0xC0, 0])); } catch (e) {}
      if (!M.lastMsg && Date.now() - M.subAt > 25000 && !M.err) M.err = { code: 'no_data', msg: 'Yazıcıya bağlanıldı ama durum bilgisi gelmiyor. Seri numarasını eklenti ayarına yazmayı dene.' };
    }, 30000);
    M.push = setInterval(pushall, 5 * 60000);
    log('baglandi:', M.ip);
  } else if (type === 3) {                // PUBLISH
    const qos = (h >> 1) & 3, tl = body.readUInt16BE(0);
    let off = 2 + tl;
    if (qos) { const pid = body.subarray(off, off + 2); off += 2; if (qos === 1) sock.write(Buffer.concat([Buffer.from([0x40, 2]), pid])); }
    onReport(body.subarray(off));
  } else if (type === 9) {                // SUBACK
    if (body[2] === 0x80) drop({ code: 'no_serial', msg: 'Yazıcı bu seri numarasını kabul etmedi. Eklenti ayarındaki seri numarasını kontrol et.' });
  }
}
function onReport(payload) {
  let j; try { j = JSON.parse(payload.toString('utf8')); } catch (e) { return; }
  const p = j && j.print;
  if (!p || typeof p !== 'object') return;
  if (p.command && p.command !== 'push_status') return;
  Object.assign(P, p);
  M.lastMsg = lastUpdate = Date.now();
  if (M.err && M.err.code === 'no_data') M.err = null;
  try { track(); } catch (e) { log('izleme hatasi:', e.message); }
}

/* ---------- Baskı izleme ---------- */
const ACTIVE = ['RUNNING', 'PAUSE', 'PREPARE', 'SLICING'];
const num = v => { const n = +v; return isFinite(n) ? n : 0; };
function jobName() {
  return String(P.subtask_name || '').trim() || path.basename(String(P.gcode_file || '')).replace(/\.gcode(\.3mf)?$|\.3mf$/i, '') || '';
}
function jobKey() {
  const ids = [P.job_id, P.subtask_id, P.task_id].map(x => String(x == null ? '' : x)).filter(x => x && x !== '0');
  if (ids.length) return 'j' + ids[0];
  const nm = jobName(), gs = String(P.gcode_start_time || '');
  return nm ? 'n' + nm + (gs && gs !== '0' ? '@' + gs : '') : '';
}
function plateIdx() { const m = /plate_(\d+)/i.exec(String(P.gcode_file || '')); return m ? +m[1] : 0; }
function finalize(cur, result, now, approx) {
  const j = {
    id: cur.id, key: cur.key, name: cur.name, startedAt: cur.startedAt, endedAt: now,
    durationSec: Math.max(0, Math.round((now - cur.startedAt) / 1000)),
    approx: !!(approx || cur.approxStart), result, errorCode: num(P.print_error) || 0,
    grams: cur.meta ? cur.meta.grams : null, predSec: cur.meta ? cur.meta.predSec : null,
    filaments: cur.meta ? cur.meta.filaments : null, lastPct: cur.pct || 0,
  };
  DB.jobs.push(j); DB.lastKey = cur.key; DB.cur = null; save(); setTimeout(() => sync(true), 1500);
  log('baski bitti:', j.name, result);
  if (!cur.meta) fetchMeta(cur.name, cur.file, cur.plate).then(m => { if (m) { j.grams = m.grams; j.predSec = m.predSec; j.filaments = m.filaments; save(); setTimeout(() => sync(true), 500); } });
}
function track() {
  const st = String(P.gcode_state || '').toUpperCase();
  if (!st) return;
  const now = Date.now(), key = jobKey(), first = !DB.init;
  if (ACTIVE.includes(st) && key) {
    if (DB.cur && DB.cur.key !== key) finalize(DB.cur, 'unknown', now, true);
    if (!DB.cur) {
      const pct = num(P.mc_percent), rem = num(P.mc_remaining_time), gs = num(P.gcode_start_time);
      let startedAt = now, approxStart = false;
      if (gs > 1e9 && gs * 1000 <= now + 60000 && now - gs * 1000 < 14 * 864e5) startedAt = gs * 1000;
      else if (pct > 2 && pct < 100 && rem > 0) { startedAt = now - Math.round(rem * pct / (100 - pct)) * 60000; approxStart = true; }
      DB.cur = { key, id: key[0] === 'j' ? key : key + '#' + Math.round(startedAt / 60000), name: jobName() || 'Baskı', startedAt, approxStart, file: String(P.gcode_file || ''), plate: plateIdx(), meta: null };
      log('baski basladi:', DB.cur.name);
      const c = DB.cur;
      fetchMeta(c.name, c.file, c.plate).then(m => { if (m && DB.cur === c) { c.meta = m; save(); } });
    }
    DB.cur.pct = num(P.mc_percent); DB.cur.rem = num(P.mc_remaining_time); DB.cur.seen = now;
    if (jobName()) DB.cur.name = jobName();
    DB.init = true; save();
  } else if (st === 'FINISH' || st === 'FAILED') {
    if (DB.cur && (DB.cur.key === key || !key)) finalize(DB.cur, st === 'FINISH' ? 'ok' : 'failed', now, false);
    else {
      if (DB.cur) finalize(DB.cur, 'unknown', now, true);
      if (key && key !== DB.lastKey && !DB.jobs.some(j => j.key === key)) {
        if (first) { DB.lastKey = key; }      // kurulumdan önce bitmiş baskıyı aktarma
        else {
          // Bilgisayar kapalıyken bitmiş baskı: başlangıç/bitiş saati kesin değil.
          const gs = num(P.gcode_start_time), startedAt = gs > 1e9 && gs * 1000 < now ? gs * 1000 : now;
          const c = { key, id: key[0] === 'j' ? key : key + '#' + Math.round(now / 60000), name: jobName() || 'Baskı', startedAt, approxStart: true, file: String(P.gcode_file || ''), plate: plateIdx(), meta: null, pct: num(P.mc_percent) };
          finalize(c, st === 'FINISH' ? 'ok' : 'failed', now, true);
          const j = DB.jobs[DB.jobs.length - 1]; j.late = true; j.durationSec = 0;
        }
      }
    }
    DB.init = true; save();
  } else if (st === 'IDLE') {
    if (DB.cur) finalize(DB.cur, 'unknown', now, true);
    if (!DB.init) { DB.init = true; save(); }
  }
}

/* ---------- Yazıcıdaki .3mf'ten gram ve tahmini süre (FTPS, elinden geleni yapar) ---------- */
const FTP = { busy: false, last: null };
function ftpFetch(host, paths) {
  return new Promise(resolve => {
    let done = false, ctrl = null, buf = '', waiter = null, closed = false;
    const lines = [];
    const finish = v => { if (done) return; done = true; clearTimeout(killer); try { ctrl && ctrl.destroy(); } catch (e) {} resolve(v); };
    const killer = setTimeout(() => finish({ error: 'timeout' }), 90000);
    const wake = () => { if (waiter) { const w = waiter; waiter = null; w(); } };
    const reply = async () => {
      const t0 = Date.now();
      while (!lines.length) {
        if (closed) throw new Error('closed');
        if (Date.now() - t0 > 20000) throw new Error('timeout');
        await new Promise(r => { waiter = r; setTimeout(r, 500); });
      }
      return lines.shift();
    };
    const cmd = c => { ctrl.write(c + '\r\n'); return reply(); };
    (async () => {
      try {
        ctrl = tls.connect({ host, port: CFG.ftpPort, rejectUnauthorized: false });
        ctrl.setEncoding('utf8');
        ctrl.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1); if (/^\d{3}( |$)/.test(l)) lines.push(l); } wake(); });
        ctrl.on('error', () => { closed = true; wake(); });
        ctrl.on('close', () => { closed = true; wake(); });
        let r = await reply();
        if (!r.startsWith('220')) throw new Error('greeting ' + r.slice(0, 3));
        r = await cmd('USER bblp');
        if (r.startsWith('331')) r = await cmd('PASS ' + CFG.code);
        if (!r.startsWith('230')) throw new Error('auth');
        await cmd('PBSZ 0'); await cmd('PROT P'); await cmd('TYPE I');
        for (const p of paths) {
          r = await cmd('PASV');
          const m = /(\d+),(\d+),(\d+),(\d+),(\d+),(\d+)/.exec(r);
          if (!r.startsWith('227') || !m) throw new Error('pasv');
          const port = +m[5] * 256 + +m[6];
          const raw = net.connect({ host, port });
          raw.on('error', () => {});
          ctrl.write('RETR ' + p + '\r\n');
          r = await reply();
          if (!/^1\d\d/.test(r)) { raw.destroy(); continue; }
          const data = await new Promise(res => {
            const chunks = []; let size = 0, ended = false;
            const end = v => { if (ended) return; ended = true; res(v); };
            let sess; try { sess = ctrl.getSession(); } catch (e) {}
            const d = tls.connect({ socket: raw, rejectUnauthorized: false, session: sess });
            d.on('data', c => { chunks.push(c); size += c.length; if (size > 120e6) { d.destroy(); end(null); } });
            d.on('end', () => end(Buffer.concat(chunks)));
            d.on('close', () => end(chunks.length ? Buffer.concat(chunks) : null));
            d.on('error', () => end(chunks.length ? Buffer.concat(chunks) : null));
            setTimeout(() => { try { d.destroy(); } catch (e) {} end(null); }, 60000);
          });
          try { await reply(); } catch (e) {}
          if (data && data.length > 22) return finish({ path: p, data });
        }
        try { ctrl.write('QUIT\r\n'); } catch (e) {}
        finish({ error: 'not_found' });
      } catch (e) { finish({ error: e.message || 'ftp' }); }
    })();
  });
}
function zipRead(buf, want) {
  let e = buf.length - 22; const min = Math.max(0, buf.length - 65557);
  while (e >= min && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < min) return null;
  const n = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16); const out = {};
  for (let i = 0; i < n && p + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lo = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl);
    p += 46 + nl + el + cl;
    if (!want(name) || lo + 30 > buf.length) continue;
    const start = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28), comp = buf.subarray(start, start + csize);
    try { out[name] = method === 0 ? comp : method === 8 ? zlib.inflateRawSync(comp) : null; } catch (er) { out[name] = null; }
  }
  return out;
}
function parseSlice(xml, plate) {
  const plates = [...xml.matchAll(/<plate>([\s\S]*?)<\/plate>/g)].map(m => m[1]);
  if (!plates.length) return null;
  const meta = (b, k) => { const m = new RegExp('<metadata\\s+key="' + k + '"\\s+value="([^"]*)"').exec(b); return m ? m[1] : ''; };
  const b = (plate && plates.find(x => +meta(x, 'index') === plate)) || plates[0];
  const filaments = [...b.matchAll(/<filament\b([^>]*)>/g)].map(m => {
    const a = k => { const x = new RegExp('\\b' + k + '="([^"]*)"').exec(m[1]); return x ? x[1] : ''; };
    return { type: a('type'), color: (a('color') || '').slice(0, 7), grams: Math.round(num(a('used_g')) * 100) / 100 };
  }).filter(f => f.grams > 0);
  const sum = filaments.reduce((s, f) => s + f.grams, 0);
  return { plate: +meta(b, 'index') || null, predSec: Math.round(num(meta(b, 'prediction'))), grams: Math.round((num(meta(b, 'weight')) || sum) * 100) / 100, filaments };
}
async function fetchMeta(name, file, plate) {
  if (!CFG.ftp || !M.ip || !CFG.code || FTP.busy) return null;
  FTP.busy = true;
  try {
    const cands = [];
    const add = p => { if (p && !cands.includes(p)) cands.push(p); };
    if (/\.3mf$/i.test(file || '')) { add(file.startsWith('/') ? file : '/' + file); add('/cache/' + path.basename(file)); }
    for (const n of [name]) if (n) { add('/cache/' + n + '.3mf'); add('/cache/' + n + '.gcode.3mf'); add('/' + n + '.gcode.3mf'); add('/' + n + '.3mf'); }
    const r = await ftpFetch(M.ip, cands);
    if (!r.data) { FTP.last = { at: Date.now(), ok: false, error: r.error, tried: cands.length }; return null; }
    const z = zipRead(r.data, n => /(^|\/)Metadata\/slice_info\.config$/i.test(n));
    const xml = z && Object.values(z).find(Boolean);
    const m = xml ? parseSlice(xml.toString('utf8'), plate) : null;
    FTP.last = { at: Date.now(), ok: !!m, error: m ? null : 'no_slice_info', path: r.path, bytes: r.data.length };
    return m;
  } catch (e) { FTP.last = { at: Date.now(), ok: false, error: e.message }; return null; }
  finally { FTP.busy = false; }
}

/* ---------- Araçların yanıtları ---------- */
const STATES = { RUNNING: 'printing', PAUSE: 'paused', PREPARE: 'preparing', SLICING: 'preparing', FINISH: 'finished', FAILED: 'failed', IDLE: 'idle' };
function status() {
  const now = Date.now(), st = String(P.gcode_state || '').toUpperCase(), c = DB.cur;
  const fresh = M.connected && lastUpdate && now - lastUpdate < 7 * 60000;
  let job = null;
  if (c && ACTIVE.includes(st)) {
    const rem = num(P.mc_remaining_time), pred = c.meta && c.meta.predSec;
    const endsAt = st === 'PREPARE' || st === 'SLICING' ? (rem > 0 ? lastUpdate + rem * 60000 : pred ? c.startedAt + pred * 1000 : null) : lastUpdate + rem * 60000;
    job = {
      id: c.id, name: c.name, percent: num(P.mc_percent), remainingMin: rem,
      layer: num(P.layer_num), totalLayers: num(P.total_layer_num),
      startedAt: c.startedAt, approxStart: !!c.approxStart, endsAt,
      grams: c.meta ? c.meta.grams : null, predSec: pred || null, filaments: c.meta ? c.meta.filaments : null,
    };
  }
  return {
    v: 1, version: VERSION, now,
    configured: !!CFG.code, connected: !!fresh, error: fresh ? null : (M.err || (M.connected ? { code: 'no_data', msg: 'Yazıcıdan bir süredir bilgi gelmiyor.' } : { code: 'connecting', msg: 'Yazıcıya bağlanılıyor…' })),
    printer: { model: MODELS[M.model] || M.model || '', name: M.name || '', ip: M.ip || '', serialEnd: M.serial ? M.serial.slice(-4) : '' },
    state: fresh ? (STATES[st] || 'unknown') : 'offline', raw: st, job,
    temps: fresh ? { nozzle: Math.round(num(P.nozzle_temper)), bed: Math.round(num(P.bed_temper)) } : null,
    errorCode: num(P.print_error) || 0, updatedAt: lastUpdate || null, jobsLogged: DB.jobs.length,
  };
}
function finished(args) {
  const since = num(args && args.since), limit = Math.max(1, Math.min(200, num(args && args.limit) || 50));
  const jobs = DB.jobs.filter(j => j.endedAt > since).slice(-limit).map(j => ({
    id: j.id, name: j.name, startedAt: j.startedAt, endedAt: j.endedAt, durationSec: j.durationSec, approx: !!j.approx, late: !!j.late,
    result: j.result, errorCode: j.errorCode || 0, grams: j.grams == null ? null : j.grams, predSec: j.predSec || null, filaments: j.filaments || null,
  }));
  return { v: 1, now: Date.now(), jobs };
}
function diag() {
  const keep = ['gcode_state', 'mc_percent', 'mc_remaining_time', 'layer_num', 'total_layer_num', 'subtask_name', 'gcode_file', 'job_id', 'subtask_id', 'task_id', 'gcode_start_time', 'print_type', 'print_error', 'stg_cur', 'mc_print_stage', 'nozzle_temper', 'bed_temper', 'wifi_signal', 'spd_lvl'];
  const p = {}; keep.forEach(k => { if (k in P) p[k] = P[k]; });
  return {
    version: VERSION, node: process.version, platform: process.platform, dataDir: CFG.dir,
    config: { hasCode: !!CFG.code, ip: CFG.ip || null, hasSerial: !!CFG.serial, discovery: CFG.discovery, ftp: CFG.ftp },
    discovered: [...FOUND.values()].map(f => ({ ip: f.ip, model: f.model, name: f.name, serialEnd: f.serial.slice(-4), agoSec: Math.round((Date.now() - f.seen) / 1000) })),
    mqtt: { connected: M.connected, ip: M.ip, error: M.err, lastMsgAgoSec: M.lastMsg ? Math.round((Date.now() - M.lastMsg) / 1000) : null, keys: Object.keys(P).length },
    print: p, current: DB.cur, ftp: FTP.last, jobs: DB.jobs.slice(-5),
  };
}


/* ---------- Supabase'e gönderme ---------- */
const SB = { busy: false, lastOk: 0, lastErr: null, lastSig: '', lastPush: 0, sent: {} };
try { const s = JSON.parse(fs.readFileSync(path.join(CFG.dir, 'gonderilen.json'), 'utf8')); if (s && typeof s === 'object') SB.sent = s; } catch (e) {}
const jobSig = j => JSON.stringify([j.name, j.endedAt, j.durationSec, j.result, j.grams, j.filaments, j.late]);
function saveSent() { try { fs.mkdirSync(CFG.dir, { recursive: true }); fs.writeFileSync(path.join(CFG.dir, 'gonderilen.json'), JSON.stringify(SB.sent)); } catch (e) {} }
async function rpc(fn, body) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), 20000);
  try {
    const r = await fetch(CFG.sbUrl + '/rest/v1/rpc/' + fn, { method: 'POST', signal: ac.signal,
      headers: Object.assign({ apikey: CFG.sbKey, 'Content-Type': 'application/json' }, CFG.sbKey.startsWith('eyJ') ? { Authorization: 'Bearer ' + CFG.sbKey } : {}), body: JSON.stringify(body) });
    const txt = await r.text();
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + txt.slice(0, 200));
    return txt ? JSON.parse(txt) : null;
  } finally { clearTimeout(t); }
}
async function sync(force) {
  if (SB.busy || !CFG.sbUrl || !CFG.sbKey || !CFG.token) return;
  const st = status(), j = st.job;
  const sig = [st.connected, st.state, j ? j.id : '', j ? Math.floor(j.percent / 5) : '', j ? Math.round((j.endsAt || 0) / 120000) : '', st.error ? st.error.code : ''].join('|');
  const due = force || sig !== SB.lastSig || Date.now() - SB.lastPush > 60000;
  const jobs = DB.jobs.slice(-200).filter(x => SB.sent[x.id] !== jobSig(x)).slice(-60).map(x => ({
    id: x.id, name: x.name, startedAt: x.startedAt, endedAt: x.endedAt, durationSec: x.durationSec, result: x.result,
    grams: x.grams == null ? null : x.grams, predSec: x.predSec || null, filaments: x.filaments || null, late: !!x.late, approx: !!x.approx }));
  if (!due && !jobs.length) return;
  SB.busy = true;
  try {
    await rpc('printer_push', { p_token: CFG.token, p_status: st, p_jobs: jobs.length ? jobs : null, p_device: CFG.device });
    jobs.forEach(x => { const o = DB.jobs.find(y => y.id === x.id); if (o) SB.sent[x.id] = jobSig(o); });
    if (jobs.length) { saveSent(); log('buluta gonderildi:', jobs.length, 'baski'); }
    if (SB.lastErr) log('bulut baglantisi duzeldi');
    SB.lastSig = sig; SB.lastPush = SB.lastOk = Date.now(); SB.lastErr = null;
  } catch (e) {
    const m = String(e && (e.name === 'AbortError' ? 'zaman asimi' : e.message) || e);
    if (!SB.lastErr || SB.lastErr !== m) log('buluta gonderilemedi:', m);
    SB.lastErr = m;
  } finally { SB.busy = false; }
}

/* ---------- Yerel durum sayfası + tek kopya kilidi (http://127.0.0.1:47611) ---------- */
const http = require('http');
const srv = http.createServer((req, res) => {
  if (req.url === '/kapat') { res.end('Servis kapatiliyor.'); log('kapatma istegi'); setTimeout(() => process.exit(0), 300); return; }
  const body = { servis: VERSION, cihaz: CFG.device, yazici: status(), bulut: { sonBasarili: SB.lastOk ? new Date(SB.lastOk).toLocaleString('tr-TR') : null, hata: SB.lastErr },
    sonBaskilar: DB.jobs.slice(-10).reverse().map(j => ({ ad: j.name, bitis: new Date(j.endedAt).toLocaleString('tr-TR'), sonuc: j.result, gram: j.grams })) };
  res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(body, null, 2));
});
srv.on('error', e => { if (e.code === 'EADDRINUSE') { log('servis zaten calisiyor, bu kopya kapaniyor'); process.exit(0); } else log('durum sayfasi acilamadi:', e.message); });
process.on('uncaughtException', e => log('hata:', e && e.stack || e));
process.on('unhandledRejection', e => log('hata:', e && e.message || e));
srv.listen(CFG.port, '127.0.0.1', () => {
  log('Atolye Yazici servisi basladi', VERSION, '· cihaz:', CFG.device, '· durum: http://127.0.0.1:' + CFG.port);
  if (!CFG.code) log('UYARI: erisim kodu yok; kur.bat ile ayarla');
  if (!CFG.sbUrl || !CFG.token) log('UYARI: bulut ayari eksik');
  startDiscovery();
  connectMqtt();
  setInterval(() => sync(false), 15000);
  setTimeout(() => sync(true), 3000);
});
