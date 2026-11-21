const path = require('path');
const {app, session, clipboard, ipcMain, Menu, BrowserWindow} = require('electron');
const {translate} = require('./l10n');
const openExternal = require('./open-external');
const {getPalette} = require('./theme');

/**
 * Electron's native Menu cannot be coloured, so the desktop's text-selection context menu would
 * stay white no matter what theme the editor uses. Instead of Menu.popup(), the items are sent to
 * a self-contained preload script that draws them in the page with the editor's current palette.
 *
 * The preload is registered once on the default session; it runs for every window before that
 * window's own preload, so no per-window preload has to be edited. If that API is unavailable,
 * fall back to the original native menu so the feature never disappears entirely.
 */
let useNativeMenu = false;
app.whenReady().then(() => {
  try {
    session.defaultSession.registerPreloadScript({
      id: 'hm-context-menu',
      type: 'frame',
      filePath: path.resolve(__dirname, '../src-preload/hm-context-menu.js')
    });
  } catch (e) {
    useNativeMenu = true;
  }
});

let nextRequestId = 1;
/**
 * Actions are kept per request id, NOT tied to the menu DOM's lifetime. Dismissing a menu (click
 * outside, Escape, another window opening one) must not make a click that was already in flight
 * a no-op. Bounded so old entries do not accumulate.
 * @type {Map<number, {webContentsId: number, actions: Map<string, Function>}>}
 */
const menus = new Map();
const MAX_MENUS = 12;
/** @type {Electron.WebContents|null} */
let lastWebContents = null;

ipcMain.on('hm-context-menu-action', (event, payload) => {
  if (!payload) return;
  const {requestId, id} = payload;
  const senderId = event.sender.id;
  let entry = menus.get(requestId);
  if (!entry || entry.webContentsId !== senderId) {
    // A lost/mismatched request id must not make the click a no-op: fall back to the most recent
    // menu from the same window.
    for (const value of [...menus.values()].reverse()) {
      if (value.webContentsId === senderId) {
        entry = value;
        break;
      }
    }
  }
  if (!entry || entry.webContentsId !== senderId) return;
  for (const [key, value] of menus) {
    if (value === entry) {
      menus.delete(key);
      break;
    }
  }
  const action = entry.actions.get(id);
  if (!action) return;
  try {
    action();
  } catch (e) {
    // The window may have closed between right-click and action.
  }
});

// Themed DOM caption buttons (src-main/theme.js) forward their clicks through the registered
// preload. No OS titleBarOverlay is used: its hover wash cannot be themed.
ipcMain.on('hm-window-control', (event, action) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;
  switch (action) {
    case 'minimize':
      if (win.isMinimizable()) win.minimize();
      break;
    case 'maximize':
      if (win.isMaximizable()) {
        if (win.isMaximized()) win.unmaximize();
        else win.maximize();
      }
      break;
    case 'close':
      win.close();
      break;
  }
});

app.on('web-contents-created', (_event, webContents) => {
  webContents.on('context-menu', (event, params) => {
    const text = params.selectionText;
    const hasText = !!text;
    const items = [];
    const nativeItems = [];
    const actions = new Map();
    let index = 0;
    const add = (label, enabled, click, separator = false) => {
      const id = `item-${index++}`;
      items.push({id, label, enabled: !!enabled});
      nativeItems.push({label, enabled: !!enabled, click});
      if (click) actions.set(id, click);
      if (separator) {
        items.push({separator: true});
        nativeItems.push({type: 'separator'});
      }
    };

    if (params.misspelledWord) {
      for (const word of params.dictionarySuggestions) {
        add(word, true, () => webContents.replaceMisspelling(word));
      }
      add(translate('context.add-to-dictionary'), true, () => {
        webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord);
      }, true);
    }

    const url = params.linkURL;
    if (url) {
      add(translate('context.open-link'), !url.startsWith('blob:'), () => openExternal(url), true);
    }

    if (params.isEditable) {
      add(translate('context.cut'), hasText, () => {
        clipboard.writeText(text);
        webContents.cut();
      });
    }
    if (hasText || params.isEditable) {
      add(translate('context.copy'), hasText, () => clipboard.writeText(text));
    }
    if (params.isEditable) {
      add(translate('context.paste'), true, () => webContents.paste());
    }

    if (items.length === 0) return;

    if (useNativeMenu) {
      Menu.buildFromTemplate(nativeItems).popup({
        window: BrowserWindow.getFocusedWindow(),
        frame: webContents.focusedFrame
      });
      return;
    }

    // Only another window needs to be told to hide: within the same window show() replaces the
    // old menu itself, and a hide message could arrive after the new menu was drawn.
    if (lastWebContents && lastWebContents !== webContents && !lastWebContents.isDestroyed()) {
      lastWebContents.send('hm-hide-context-menu');
    }
    lastWebContents = webContents;

    const requestId = nextRequestId++;
    menus.set(requestId, {webContentsId: webContents.id, actions});
    while (menus.size > MAX_MENUS) {
      menus.delete(menus.keys().next().value);
    }
    webContents.send('hm-show-context-menu', {
      requestId,
      items,
      x: params.x,
      y: params.y,
      // Resolved by editor-theme-sync.js / src-main/theme.js: GUI theme colours when
      // custom-editor-theme is off, the addon's palette when it is on. Read at right-click time,
      // so the menu always uses the current theme.
      theme: getPalette()
    });
  });
});
