// Atölye Defteri — Mac masaüstü uygulaması.
// Uygulamanın kendisi internetten (GitHub Pages) yüklenir; böylece her güncelleme
// bu programı yeniden kurmadan kendiliğinden gelir.
const { app, BrowserWindow, shell, Menu, session, systemPreferences, dialog } = require('electron');
const path = require('path');

const APP_URL = 'https://omer-yks.github.io/atolye-defteri/';
const ORIGIN = new URL(APP_URL).origin;
const ALLOW = new Set(['media', 'clipboard-read', 'clipboard-sanitized-write', 'notifications', 'fullscreen']);

if (!app.requestSingleInstanceLock()) { app.quit(); }

let win = null;
const fromApp = u => typeof u === 'string' && u.startsWith(APP_URL);

async function micOK() {
  if (process.platform !== 'darwin') return true;
  const st = systemPreferences.getMediaAccessStatus('microphone');
  if (st === 'granted') return true;
  if (st === 'not-determined') return systemPreferences.askForMediaAccess('microphone');
  dialog.showMessageBox(win, {
    type: 'info', buttons: ['Sistem Ayarlarını aç', 'Tamam'], defaultId: 0,
    message: 'Mikrofon izni kapalı',
    detail: 'Sesle yazmak için Sistem Ayarları > Gizlilik ve Güvenlik > Mikrofon bölümünden “Atölye Defteri”ni aç.'
  }).then(r => { if (r.response === 0) shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'); });
  return false;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1320, height: 860, minWidth: 380, minHeight: 520,
    title: 'Atölye Defteri', backgroundColor: '#EDF1F7', show: false,
    webPreferences: { contextIsolation: true, sandbox: true, spellcheck: false }
  });
  win.once('ready-to-show', () => win.show());
  // Dış bağlantılar (ör. Gemini anahtar sayfası) varsayılan tarayıcıda açılsın
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url) && !fromApp(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (fromApp(url) || url.startsWith('file:')) return;
    e.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });
  win.webContents.on('did-fail-load', (e, code, desc, url, isMain) => {
    if (isMain && code !== -3) win.loadFile(path.join(__dirname, 'offline.html'));
  });
  win.on('closed', () => { win = null; });
  win.loadURL(APP_URL);
}

function buildMenu() {
  const t = [
    { label: 'Atölye Defteri', submenu: [
      { role: 'about', label: 'Atölye Defteri Hakkında' }, { type: 'separator' },
      { role: 'hide', label: 'Atölye Defteri’ni gizle' }, { role: 'hideOthers', label: 'Diğerlerini gizle' }, { role: 'unhide', label: 'Tümünü göster' },
      { type: 'separator' }, { role: 'quit', label: 'Atölye Defteri’nden çık' } ] },
    { label: 'Düzen', submenu: [
      { role: 'undo', label: 'Geri al' }, { role: 'redo', label: 'Yinele' }, { type: 'separator' },
      { role: 'cut', label: 'Kes' }, { role: 'copy', label: 'Kopyala' }, { role: 'paste', label: 'Yapıştır' },
      { role: 'selectAll', label: 'Tümünü seç' } ] },
    { label: 'Görünüm', submenu: [
      { label: 'Yenile', accelerator: 'CmdOrCtrl+R', click: () => win && win.loadURL(APP_URL) },
      { type: 'separator' },
      { role: 'resetZoom', label: 'Gerçek boyut' }, { role: 'zoomIn', label: 'Büyüt' }, { role: 'zoomOut', label: 'Küçült' },
      { type: 'separator' }, { role: 'togglefullscreen', label: 'Tam ekran' } ] },
    { label: 'Pencere', submenu: [ { role: 'minimize', label: 'Küçült' }, { role: 'zoom', label: 'Yakınlaştır' }, { role: 'close', label: 'Kapat' } ] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(t));
}

app.whenReady().then(() => {
  app.setAboutPanelOptions({ applicationName: 'Atölye Defteri', applicationVersion: app.getVersion(), copyright: 'for3D design' });
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler(async (wc, perm, cb, details) => {
    if (!fromApp(details.requestingUrl || wc.getURL()) || !ALLOW.has(perm)) return cb(false);
    if (perm === 'media' && (details.mediaTypes || []).includes('audio')) return cb(await micOK());
    cb(true);
  });
  ses.setPermissionCheckHandler((wc, perm, origin) => origin === ORIGIN && ALLOW.has(perm));
  buildMenu();
  createWindow();
  app.on('activate', () => { if (!win) createWindow(); else win.show(); });
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
