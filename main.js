const { app, BrowserWindow, Tray, Menu, nativeImage } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8123;
const HOST = '127.0.0.1';
const ICON_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAUElEQVR4nKXTuw0AIAxDwczA6NTsCqJACpCv4/5eZ5rFEQrb6HhgYzhwMBTgOB14cSog4XBAw6GAhd2Ah81ABKuBKBYDGfwFsvgKILh0Jr4FlrJFqR3pBQkAAAAASUVORK5CYII=';
const SETTINGS_FILE = path.join(app.getPath('userData'), 'print-bridge-settings.json');

let settings = { printerName: null, copies: 1 };
let printerList = [];
let tray = null;

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      if (s && typeof s === 'object') settings = { ...settings, ...s };
    }
  } catch (e) { console.error('loadSettings', e.message); }
}
function saveSettings() {
  try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2)); } catch (e) { console.error('saveSettings', e.message); }
}

async function refreshPrinters() {
  try {
    const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
    printerList = await win.webContents.getPrintersAsync();
    win.destroy();
  } catch (e) {
    console.error('refreshPrinters', e.message);
    printerList = [];
  }
}

async function printHTML(html, opts = {}) {
  const cleaned = String(html || '').replace(/window\.print\(\)/g, '');
  if (!cleaned.trim()) return { success: false, message: 'Konten kosong' };
  const win = new BrowserWindow({
    width: 800,
    height: 1100,
    show: false,
    webPreferences: { offscreen: false, backgroundThrottling: false, sandbox: true }
  });
  try {
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
    return { success: false, message: e.message };
  } finally {
    setTimeout(() => { try { win.destroy(); } catch (_) {} }, 500);
  }
}

function startServer() {
  const server = http.createServer(async (req, res) => {
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
      return send(200, { ok: true, name: 'WhyERP Print Bridge', port: PORT, printer: settings.printerName || 'default' });
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
  server.listen(PORT, HOST, () => console.log('WhyERP Print Bridge listening on http://' + HOST + ':' + PORT));
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
    { label: 'Port: ' + PORT + ' — siap mencetak', enabled: false },
    { label: 'Printer tujuan: ' + (settings.printerName || 'Default (sistem)'), enabled: false },
    { type: 'separator' },
    { label: 'Pilih Printer', submenu: printerItems },
    { label: 'Jumlah Salinan', submenu: copiesItems },
    { type: 'separator' },
    { label: 'Muat Ulang Daftar Printer', click: async () => { await refreshPrinters(); rebuildTray(); } },
    { type: 'separator' },
    { label: 'Keluar', click: () => app.quit() }
  ]);
}

function rebuildTray() {
  if (!tray) return;
  tray.setToolTip('WhyERP Print Bridge — ' + (settings.printerName || 'printer default'));
  tray.setContextMenu(buildTrayMenu());
}

app.whenReady().then(async () => {
  app.setAppUserModelId('com.why.bridgeprint');
  loadSettings();
  await refreshPrinters();
  tray = new Tray(nativeImage.createFromDataURL(ICON_DATA_URL));
  rebuildTray();
  tray.on('click', () => tray.popUpContextMenu());
  startServer();
});

app.on('window-all-closed', () => {});
app.on('before-quit', () => { try { if (tray) tray.destroy(); } catch (_) {} });