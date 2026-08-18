const { app, BrowserWindow, Tray, Menu, nativeImage } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8123;
const PORT_MAX = 8130;
const HOST = '127.0.0.1';
const ICON_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAUElEQVR4nKXTuw0AIAxDwczA6NTsCqJACpCv4/5eZ5rFEQrb6HhgYzhwMBTgOB14cSog4XBAw6GAhd2Ah81ABKuBKBYDGfwFsvgKILh0Jr4FlrJFqR3pBQkAAAAASUVORK5CYII=';
const SETTINGS_FILE = path.join(app.getPath('userData'), 'print-bridge-settings.json');
const LOG_FILE = path.join(app.getPath('userData'), 'logs.txt');

let settings = { printerName: null, copies: 1 };
let printerList = [];
let tray = null;
let statusWin = null;
let server = null;
let activePort = PORT;

function log(...args) {
  const line = '[' + new Date().toISOString() + '] ' + args.map(a => (a && a.stack) ? a.stack : String(a)).join(' ');
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (_) {}
  console.log(line);
}

process.on('uncaughtException', (e) => log('uncaughtException:', e));
process.on('unhandledRejection', (r) => log('unhandledRejection:', r));

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    log('second-instance: aplikasi sudah berjalan (kunci instance aktif)');
  });
}

app.setAppUserModelId('com.why.bridgeprint');

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      if (s && typeof s === 'object') settings = { ...settings, ...s };
    }
  } catch (e) { log('loadSettings:', e.message); }
}
function saveSettings() {
  try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2)); } catch (e) { log('saveSettings:', e.message); }
}

async function refreshPrinters() {
  let win = null;
  try {
    win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
    printerList = await win.webContents.getPrintersAsync();
    log('Printer ditemukan:', printerList.length);
  } catch (e) {
    log('refreshPrinters:', e.message);
    printerList = [];
  } finally {
    if (win) { try { win.destroy(); } catch (_) {} }
  }
}

async function printHTML(html, opts = {}) {
  const cleaned = String(html || '').replace(/window\.print\(\)/g, '');
  if (!cleaned.trim()) return { success: false, message: 'Konten kosong' };
  let win = null;
  try {
    win = new BrowserWindow({
      width: 800,
      height: 1100,
      show: false,
      webPreferences: { offscreen: false, backgroundThrottling: false, sandbox: true }
    });
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(cleaned));
    await new Promise(r => setTimeout(r, 800));
    const printOpts = {
      silent: true,
      printBackground: true,
      copies: Math.max(1, parseInt(opts.copies || settings.copies || 1, 10) || 1)
    };
    const device = opts.printerName || settings.printerName;
    if (device) printOpts.deviceName = device;
    const ok = await win.webContents.print(printOpts);
    return { success: !!ok, message: ok ? 'Dicetak ke printer' : 'Gagal mencetak (periksa printer)' };
  } catch (e) {
    log('printHTML:', e.message);
    return { success: false, message: e.message };
  } finally {
    setTimeout(() => { try { if (win) win.destroy(); } catch (_) {} }, 500);
  }
}

function startServer() {
  server = http.createServer(async (req, res) => {
    const send = (code, obj) => {
      res.writeHead(code, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
      });
      res.end(JSON.stringify(obj));
    };
    if (req.method === 'OPTIONS') return send(200, { ok: true });
    const url = (req.url || '').split('?')[0];

    if (req.method === 'GET' && url === '/ping') {
      return send(200, { ok: true, name: 'WhyERP Print Bridge', port: activePort, printer: settings.printerName || 'default' });
    }
    if (req.method === 'GET' && url === '/printers') {
      return send(200, { ok: true, printers: printerList.map(p => p.name) });
    }
    if (req.method === 'POST' && url === '/print') {
      let body = '';
      req.on('data', c => { body += c; if (body.length > 3e6) { body = ''; req.destroy(); } });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body || '{}');
          if (!data.html) return send(400, { ok: false, message: 'Parameter html wajib ada' });
          const r = await printHTML(data.html, data);
          return send(r.success ? 200 : 500, r);
        } catch (e) {
          return send(500, { ok: false, message: e.message });
        }
      });
      return;
    }
    return send(404, { ok: false, message: 'Endpoint tidak dikenal' });
  });

  const tryListen = (port, maxPort) => {
    server.once('error', (e) => {
      if (e.code === 'EADDRINUSE' && port < maxPort) {
        log('Port ' + port + ' terpakai, mencoba ' + (port + 1));
        tryListen(port + 1, maxPort);
      } else {
        log('Gagal menjalankan server:', e.code, e.message);
        showStatus(false);
      }
    });
    server.listen(port, HOST, () => {
      activePort = port;
      log('WhyERP Print Bridge listening on http://' + HOST + ':' + port);
      showStatus(true);
    });
  };
  tryListen(PORT, PORT_MAX);
}

function buildTrayMenu() {
  const printerItems = printerList.map(p => ({
    label: (settings.printerName === p.name ? '✓ ' : '    ') + p.name,
    click: () => {
      settings.printerName = (settings.printerName === p.name) ? null : p.name;
      saveSettings();
      rebuildTray();
    }
  }));
  if (!printerItems.length) printerItems.push({ label: '  (tidak ada printer ditemukan)', enabled: false });
  printerItems.unshift({
    label: (settings.printerName === null || settings.printerName === undefined) ? '✓ Default (sistem)' : '    Default (sistem)',
    click: () => { settings.printerName = null; saveSettings(); rebuildTray(); }
  });

  const copiesItems = [1, 2, 3, 5].map(n => ({
    label: (settings.copies === n ? '✓ ' : '    ') + n + ' salinan',
    click: () => { settings.copies = n; saveSettings(); rebuildTray(); }
  }));

  return Menu.buildFromTemplate([
    { label: 'WhyERP Print Bridge', enabled: false },
    { label: 'Port: ' + activePort + ' — siap mencetak', enabled: false },
    { label: 'Printer tujuan: ' + (settings.printerName || 'Default (sistem)'), enabled: false },
    { type: 'separator' },
    { label: 'Pilih Printer', submenu: printerItems },
    { label: 'Jumlah Salinan', submenu: copiesItems },
    { type: 'separator' },
    { label: 'Muat Ulang Daftar Printer', click: async () => { await refreshPrinters(); rebuildTray(); } },
    { type: 'separator' },
    { label: 'Buka Log', click: () => { if (fs.existsSync(LOG_FILE)) { const { shell } = require('electron'); shell.openPath(LOG_FILE); } } },
    { type: 'separator' },
    { label: 'Keluar', click: () => app.quit() }
  ]);
}

function rebuildTray() {
  if (!tray) return;
  tray.setToolTip('WhyERP Print Bridge — ' + (settings.printerName || 'printer default'));
  tray.setContextMenu(buildTrayMenu());
}

function showStatus(ok) {
  try {
    if (statusWin && !statusWin.isDestroyed()) {
      if (ok) statusWin.close();
      return;
    }
    if (ok) return;
    const html = '<html><body style="font-family:Segoe UI,Arial,sans-serif;padding:20px;background:#1e1e2e;color:#eee">' +
      '<h2>WhyERP Print Bridge</h2>' +
      '<p style="color:#f66">Gagal menjalankan server (port ' + activePort + ' terpakai?).</p>' +
      '<p>Log tersimpan di: <br><code>' + LOG_FILE + '</code></p>' +
      '<button onclick="window.close()">Tutup</button></body></html>';
    statusWin = new BrowserWindow({ width: 460, height: 280, title: 'WhyERP Print Bridge', webPreferences: { nodeIntegration: false, contextIsolation: true } });
    statusWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    statusWin.on('closed', () => { statusWin = null; });
  } catch (e) {
    log('showStatus:', e.message);
  }
}

app.whenReady().then(async () => {
  loadSettings();
  await refreshPrinters();
  try {
    tray = new Tray(nativeImage.createFromDataURL(ICON_DATA_URL));
    rebuildTray();
    tray.on('click', () => tray.popUpContextMenu());
    log('Tray icon dibuat');
  } catch (e) {
    log('Gagal membuat tray icon:', e.message);
    showStatus(false);
  }
  startServer();
  setInterval(async () => { await refreshPrinters(); rebuildTray(); }, 120000);
});

app.on('window-all-closed', () => {});
app.on('before-quit', () => {
  try { if (tray) tray.destroy(); } catch (_) {}
  try { if (statusWin && !statusWin.isDestroyed()) statusWin.destroy(); } catch (_) {}
  try { if (server) server.close(); } catch (_) {}
});
