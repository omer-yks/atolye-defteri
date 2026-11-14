'use strict';
// Atölye Yazıcı kurulumu: ayarları sorar, programı kalıcı klasöre kopyalar,
// Windows açılışında gizli başlatılmasını ayarlar ve şimdi başlatır.
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), readline = require('readline'), http = require('http');
const SRC = __dirname;
const DEST = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'AtolyeYazici');
const STARTUP = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const VBS = path.join(DEST, 'baslat.vbs'), LINK = path.join(STARTUP, 'AtolyeYazici.vbs');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(r => rl.question(q, x => r(String(x || '').trim())));
const get = (p, ms) => new Promise(r => { const q = http.get({ host: '127.0.0.1', port: 47611, path: p, timeout: ms || 2000 }, res => { let b = ''; res.on('data', d => b += d); res.on('end', () => r(b)); }); q.on('error', () => r(null)); q.on('timeout', () => { q.destroy(); r(null); }); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  console.log('\n=== Atolye Yazici kurulumu ===\n');
  let A = {}; try { A = JSON.parse(fs.readFileSync(path.join(fs.existsSync(path.join(DEST, 'ayarlar.json')) ? DEST : SRC, 'ayarlar.json'), 'utf8')); } catch (e) {}
  const T = JSON.parse(fs.readFileSync(path.join(SRC, 'ayarlar.json'), 'utf8'));
  A = { ...T, ...A, supabaseUrl: T.supabaseUrl, supabaseKey: T.supabaseKey, anahtar: T.anahtar };
  console.log('Yazicinin erisim kodu: yazici ekraninda Ayarlar > WLAN (ya da LAN Only) > Access Code (8 hane).');
  for (;;) {
    const c = await ask(`Erisim kodu${A.erisimKodu ? ' (degistirmek istemiyorsan Enter)' : ''}: `);
    if (!c && A.erisimKodu) break;
    if (/^[A-Za-z0-9]{6,12}$/.test(c)) { A.erisimKodu = c; break; }
    console.log('  Kod 8 haneli olmali, tekrar yaz.');
  }
  const ip = await ask(`Yazici IP adresi (bos birakirsan agda kendim bulurum${A.yaziciIp ? ', simdiki: ' + A.yaziciIp : ', Mac son olarak 192.168.31.147 gormustu'}): `);
  if (ip) A.yaziciIp = /^\d+\.\d+\.\d+\.\d+$/.test(ip) ? ip : A.yaziciIp;
  if (!A.cihaz) A.cihaz = 'Atolye ' + os.hostname();
  rl.close();
  // kopyala
  fs.mkdirSync(DEST, { recursive: true });
  await get('/kapat', 1500); await sleep(800);
  for (const f of ['servis.js', 'kur.js', 'kur.bat', 'kaldir.bat', 'durum.bat', 'OKUBENI.txt']) { try { if (path.resolve(SRC) !== path.resolve(DEST)) fs.copyFileSync(path.join(SRC, f), path.join(DEST, f)); } catch (e) {} }
  fs.writeFileSync(path.join(DEST, 'ayarlar.json'), JSON.stringify(A, null, 2));
  const node = process.execPath;
  fs.writeFileSync(VBS, `Set sh = CreateObject("WScript.Shell")\r\nsh.CurrentDirectory = "${DEST}"\r\nsh.Run """${node}"" ""${path.join(DEST, 'servis.js')}""", 0, False\r\n`);
  try { fs.mkdirSync(STARTUP, { recursive: true }); fs.copyFileSync(VBS, LINK); console.log('\n✓ Windows acilisinda kendiliginden baslayacak.'); }
  catch (e) { console.log('\n! Baslangica eklenemedi:', e.message); }
  // başlat
  try { cp.spawn('wscript.exe', [VBS], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); }
  catch (e) { cp.spawn(node, [path.join(DEST, 'servis.js')], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); }
  console.log('✓ Servis baslatildi. Yaziciya baglaniliyor (en fazla 1 dakika)...');
  console.log('  Windows Guvenlik Duvari "Node.js" icin izin sorarsa "Ozel aglar" secip izin ver.\n');
  let last = '';
  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    const b = await get('/'); if (!b) continue;
    let s; try { s = JSON.parse(b); } catch (e) { continue; }
    const y = s.yazici || {};
    if (y.connected) { console.log(`✓ Yaziciya baglandi: ${(y.printer && (y.printer.name || y.printer.model)) || ''} (${y.printer && y.printer.ip}) · durum: ${y.state}`); 
      if (s.bulut && s.bulut.sonBasarili) console.log('✓ Buluta yaziliyor (son: ' + s.bulut.sonBasarili + ')');
      else if (s.bulut && s.bulut.hata) console.log('! Buluta yazilamadi: ' + s.bulut.hata);
      console.log('\nKurulum tamam. Bu pencereyi kapatabilirsin.'); return; }
    const m = y.error && y.error.msg; if (m && m !== last) { console.log('  ' + m); last = m; }
  }
  console.log('\n! Yaziciya henuz baglanilamadi. Yazici acik ve bu bilgisayarla ayni Wi-Fi aginda mi?');
  console.log('  Servis arka planda denemeye devam ediyor. Durumu gormek icin durum.bat dosyasini ac.');
})().catch(e => { console.log('Hata:', e.message); });
