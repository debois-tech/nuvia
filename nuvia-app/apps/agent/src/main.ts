import { app, BrowserWindow, ipcMain, Menu, nativeImage, powerMonitor, safeStorage, screen, Tray } from 'electron';
import { join } from 'node:path';
import type { PromptInfo } from '@nuvia/shared';
import { AgentApi, enrollDevice } from './core/api';
import { AgentStatus, AgentUi, WorkTracker } from './core/agent';
import { ActivitySampler } from './core/sampler';
import { AgentStore } from './core/store';

if (!app.requestSingleInstanceLock()) app.quit();

let tray: Tray | null = null;
let promptWin: BrowserWindow | null = null;
let enrollWin: BrowserWindow | null = null;
let tracker: WorkTracker | null = null;
let status: AgentStatus = { kind: 'stopped' };
let store: AgentStore;

const STATUS_TEXT: Record<AgentStatus['kind'], string> = {
  stopped: 'Nuvia: not tracking',
  tracking: 'Nuvia: tracking active',
  away: 'Nuvia: marked away',
  reconnecting: 'Nuvia: reconnecting',
  rejected: 'Nuvia: device not authorised',
};

// Small solid dot, so no image assets are needed. Green while tracking, grey otherwise, red on error or away.
function dot(color: string) {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  const [r, g, b] = color.match(/\w\w/g)!.map((h) => parseInt(h, 16));
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const inside = (x - 7.5) ** 2 + (y - 7.5) ** 2 <= 49;
      const i = (y * size + x) * 4;
      buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = inside ? 255 : 0;
    }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}
const COLORS: Record<AgentStatus['kind'], string> = { stopped: '888888', tracking: '1a9d4a', away: 'd9822b', reconnecting: 'd9822b', rejected: 'c0392b' };

function refreshTray() {
  if (!tray) return;
  tray.setImage(dot(COLORS[status.kind]));
  const detail = 'message' in status ? status.message : '';
  tray.setToolTip(detail ? `${STATUS_TEXT[status.kind]}. ${detail}` : STATUS_TEXT[status.kind]);
  const working = tracker?.working ?? false;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: STATUS_TEXT[status.kind], enabled: false },
      { type: 'separator' },
      { label: 'Start work', enabled: Boolean(tracker) && !working, click: () => void tracker!.startWork().catch((e) => setStatus({ kind: 'rejected', message: String(e.message ?? e) })) },
      { label: 'Stop work', enabled: working, click: () => void tracker!.stopWork() },
      { type: 'separator' },
      { label: tracker ? 'Re-enroll this device…' : 'Sign in…', click: openEnroll },
      { label: 'Quit', click: () => void (tracker?.stopWork() ?? Promise.resolve()).finally(() => app.quit()) },
    ]),
  );
}

function setStatus(s: AgentStatus) {
  status = s;
  refreshTray();
}

const ui: AgentUi = {
  setStatus,
  showPrompt(prompt: PromptInfo) {
    promptWin?.close();
    promptWin = new BrowserWindow({
      width: 380, height: 340, useContentSize: true, alwaysOnTop: true, resizable: false, minimizable: false, maximizable: false, frame: true, title: 'Are you there?',
      webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    promptWin.setAlwaysOnTop(true, 'screen-saver');
    promptWin.setMenuBarVisibility(false);
    void promptWin.loadFile(join(__dirname, 'renderer', 'prompt.html'));
    promptWin.webContents.once('did-finish-load', () => promptWin?.webContents.send('prompt', prompt));
    promptWin.on('closed', () => (promptWin = null));
  },
  hidePrompt() {
    promptWin?.close();
    promptWin = null;
  },
};

function buildTracker() {
  const creds = store.credentials();
  if (!creds) return;
  const sampler = new ActivitySampler({
    readCursor: () => screen.getCursorScreenPoint(),
    readIdleSeconds: () => powerMonitor.getSystemIdleTime(),
    now: Date.now,
  });
  tracker = new WorkTracker(new AgentApi(creds, store), sampler, ui);
}

function openEnroll() {
  if (enrollWin) return enrollWin.focus();
  enrollWin = new BrowserWindow({
    width: 420, height: 400, resizable: false, title: 'Nuvia: sign in',
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  enrollWin.setMenuBarVisibility(false);
  void enrollWin.loadFile(join(__dirname, 'renderer', 'enroll.html'));
  enrollWin.on('closed', () => (enrollWin = null));
}

// Only our own windows may drive these calls.
const fromWindow = (e: Electron.IpcMainInvokeEvent, win: BrowserWindow | null) => win !== null && e.sender === win.webContents;

ipcMain.handle('prompt:answer', async (e, promptId: string, answer?: string) => {
  if (!fromWindow(e, promptWin)) return 'Not allowed';
  return tracker ? tracker.answerPrompt(String(promptId), answer === undefined ? undefined : String(answer)) : 'Not tracking';
});

ipcMain.handle('enroll:submit', async (e, serverUrl: string, orgId: string, password: string) => {
  if (!fromWindow(e, enrollWin)) return 'Not allowed';
  try {
    if (!/^https?:\/\//.test(serverUrl)) return 'Server address must start with http:// or https://';
    await tracker?.stopWork();
    const creds = await enrollDevice(serverUrl, orgId, password, `${require('node:os').hostname()} (desktop agent)`);
    store.saveCredentials(creds);
    buildTracker();
    refreshTray();
    enrollWin?.close();
    return null;
  } catch (e: any) {
    return e?.status === 401 ? 'Wrong org ID or password.' : e?.status === 403 ? 'This account is not set up for remote tracking.' : String(e?.message ?? e);
  }
});

app.whenReady().then(() => {
  // The device secret is encrypted with the OS keychain when available.
  const cipher = safeStorage.isEncryptionAvailable()
    ? { encrypt: (p: string) => safeStorage.encryptString(p).toString('base64'), decrypt: (e: string) => safeStorage.decryptString(Buffer.from(e, 'base64')) }
    : (console.warn('OS keychain unavailable: device secret is stored unencrypted'), { encrypt: (p: string) => p, decrypt: (e: string) => e });
  store = new AgentStore(join(app.getPath('userData'), 'agent.json'), cipher);
  tray = new Tray(dot(COLORS.stopped));
  buildTracker();
  refreshTray();
  if (!tracker) openEnroll();
});

// Keep running in the tray when windows close.
app.on('window-all-closed', () => undefined);
