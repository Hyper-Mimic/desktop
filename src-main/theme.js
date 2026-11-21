/**
 * Shares the editor window's colours with the app's other BrowserWindows.
 *
 * The editor is the only window custom-editor-theme can paint: that addon writes
 * `--customEditorTheme-*` custom properties on the editor's <html>, and its stylesheet never
 * reaches the standalone windows (different origin, different webContents). The editor therefore
 * reports a small set of resolved hex colours (see src-renderer-webpack/editor/gui/
 * editor-theme-sync.js) over IPC; this module keeps the latest report and pushes it to every
 * popup window.
 *
 * Two things are applied:
 *  - on Windows/Linux the OS title bar is hidden entirely (no titleBarOverlay: its caption
 *    buttons cannot be themed and their hover wash stays dark on a dark bar). A real DOM title
 *    bar is injected with the title, the drag region and themed min/max/close buttons;
 *  - the popup's background / text / accent / border always follow the reported palette. When
 *    custom-editor-theme is off, the renderer reports the GUI's own theme colours instead, so
 *    the windows match the editor in both cases and never show their hard-coded white/orange
 *    chrome.
 *
 * Everything that affects layout or colour is written as INLINE STYLE by one page script rather
 * than through webContents.insertCSS. Injected stylesheets can be dropped (page reloads, CSP,
 * style-key churn) and then the title bar silently covers content again; inline styles on <html>,
 * <body>, <main> and the title bar are applied by the page itself on every load and every theme
 * change, so the result is deterministic.
 *
 * No theme module here requires windows/abstract.js on purpose: abstract.js requires this file,
 * and the cycle would break window construction. Callers pass AbstractWindow instances in.
 */

const TITLE_BAR_HEIGHT = 32;
const DEFAULT_TITLE_BAR = '#4c97ff';
const DEFAULT_TITLE_BAR_TEXT = '#ffffff';

/** @type {object|null} */
let currentTheme = null;
/** @type {WeakMap<Electron.WebContents, Promise>} */
const pendingApplies = new WeakMap();

const supportsOverlay = () => process.platform === 'win32' || process.platform === 'linux';

/** Perceived brightness of the title bar: decides whether hover washes must be light or dark. */
const isDarkHex = (hex) => {
  const match = /^#([\da-f]{6})$/i.exec(hex || '');
  if (!match) return false;
  const value = parseInt(match[1], 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return (0.2126 * r) + (0.7152 * g) + (0.0722 * b) < 128;
};

/**
 * @param {object} theme New editor theme report.
 * @returns {boolean} whether anything actually changed.
 */
const setEditorTheme = (theme) => {
  if (!theme || typeof theme !== 'object') return false;
  const next = JSON.stringify(theme);
  if (next === (currentTheme && JSON.stringify(currentTheme))) return false;
  currentTheme = theme;
  return true;
};

const getPalette = () => {
  const theme = currentTheme || {};
  return {
    titleBar: theme.titleBar || DEFAULT_TITLE_BAR,
    titleBarText: theme.titleBarText || DEFAULT_TITLE_BAR_TEXT,
    background: theme.background || '#ffffff',
    text: theme.text || '#000000',
    accent: theme.accent || DEFAULT_TITLE_BAR,
    dark: !!theme.dark
  };
};

/** Secondary rules only: links and form controls cannot be reached with inline styles. */
const buildCss = () => [
  'a {',
  '  color: var(--hm-window-accent) !important;',
  '}',
  'button, input, select, textarea {',
  '  accent-color: var(--hm-window-accent) !important;',
  '  color-scheme: inherit;',
  '}'
].join('\n');

/**
 * One self-contained page script: variables, colours, title bar and layout compensation.
 * @param {string} title the BrowserWindow's current title
 * @param {boolean} hasOverlay whether this window was built with a hidden OS title bar
 * @returns {string} JavaScript to execute in the popup
 */
const buildPageScript = (title, hasOverlay, controls = {}) => {
  const palette = getPalette();
  // Only windows that actually lost their OS title bar get the 32px. A native title bar must not
  // leave a duplicate gap: that gap is what produced the page-level scrollbar in every popup.
  const overlay = !!hasOverlay;
  const variables = {
    '--hm-window-titlebar': palette.titleBar,
    '--hm-window-titlebar-text': palette.titleBarText,
    '--hm-window-bg': palette.background,
    '--hm-window-text': palette.text,
    '--hm-window-accent': palette.accent,
    '--hm-titlebar-height': overlay ? `${TITLE_BAR_HEIGHT}px` : '0px'
  };
  const barStyles = {
    // The bar is fixed (it does not take part in layout); the 32px is reserved by the page's
    // static CSS and by the body padding below, so either mechanism alone keeps content clear.
    position: 'fixed',
    top: '0',
    left: '0',
    right: '0',
    height: 'var(--hm-titlebar-height)',
    'box-sizing': 'border-box',
    display: 'flex',
    'align-items': 'center',
    // Keep the title clear of the OS-drawn minimize / maximize / close buttons on the right.
    padding: '0 12px',
    'padding-right': '150px',
    overflow: 'hidden',
    'white-space': 'nowrap',
    'text-overflow': 'ellipsis',
    font: '12px "Helvetica Neue", Helvetica, Arial, sans-serif',
    'background-color': 'var(--hm-window-titlebar)',
    color: 'var(--hm-window-titlebar-text)',
    '-webkit-app-region': 'drag',
    'user-select': 'none',
    '-webkit-user-select': 'none',
    'z-index': '2147483647'
  };

  // The OS caption buttons are gone (no titleBarOverlay), so the DOM draws its own. Their hover
  // wash must be a LIGHT translucent colour on a dark title bar and a dark one on a light bar --
  // exactly what the editor's window-controls.css does with --hm-titlebar-wash.
  const darkBar = isDarkHex(palette.titleBar);
  const wash = darkBar ? 'rgba(255, 255, 255, 0.16)' : 'rgba(0, 0, 0, 0.12)';
  const washActive = darkBar ? 'rgba(255, 255, 255, 0.26)' : 'rgba(0, 0, 0, 0.20)';
  // Same Windows 10 styling as the editor's window-controls.css: brighter red and a white glyph.
  const closeHover = '#e81123';
  const closeActive = '#c50f1e';
  const controlDefs = [
    {
      action: 'minimize',
      enabled: controls.minimizable !== false,
      svg: '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5.5h10" stroke="currentColor" stroke-width="1"/></svg>'
    },
    {
      action: 'maximize',
      enabled: controls.maximizable !== false,
      svg: '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M0.5 0.5h9v9h-9z" fill="none" stroke="currentColor" stroke-width="1"/></svg>'
    },
    {
      action: 'close',
      enabled: true,
      svg: '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" stroke-width="1"/></svg>'
    }
  ];

  return `(() => {
  const root = document.documentElement;
  root.classList.toggle('hm-custom-titlebar', ${JSON.stringify(overlay)});
  const variables = ${JSON.stringify(variables)};
  // Inline style already outranks the page's stylesheets; no priority needed (and some Chromium
  // builds ignore the priority argument for custom properties).
  for (const name of Object.keys(variables)) root.style.setProperty(name, variables[name]);
  root.style.setProperty('color-scheme', ${JSON.stringify(palette.dark ? 'dark' : 'light')}, 'important');
  root.style.setProperty('background-color', 'var(--hm-window-bg)', 'important');

  // The page does not scroll; body is the single scroll container and begins below the fixed
  // title bar, so its scrollbar starts at the same y as the content and never crosses the bar.
  root.style.setProperty('height', '100%', 'important');
  root.style.setProperty('overflow', 'hidden', 'important');

  const body = document.body;
  if (!body) return;
  body.style.removeProperty('padding-top'); // an earlier build used padding instead of margin
  const bodyStyles = {
    'background-color': 'var(--hm-window-bg)',
    color: 'var(--hm-window-text)',
    'accent-color': 'var(--hm-window-accent)',
    'color-scheme': ${JSON.stringify(palette.dark ? 'dark' : 'light')},
    'margin-top': 'var(--hm-titlebar-height)',
    height: 'calc(100vh - var(--hm-titlebar-height))',
    'overflow-y': 'auto',
    'overflow-x': 'hidden',
    'box-sizing': 'border-box'
  };
  for (const name of Object.keys(bodyStyles)) body.style.setProperty(name, bodyStyles[name], 'important');

  // The title bar is fixed, so reserve its height on body (also in each window's static CSS).
  // Everything below it scrolls as one page -- the original window behaviour, where the border
  // moves with the content. Only content taller than the viewport produces a scrollbar.
  const main = document.querySelector('main');
  if (main) {
    main.style.setProperty('background-color', 'var(--hm-window-bg)', 'important');
    main.style.setProperty('color', 'var(--hm-window-text)', 'important');
    main.style.setProperty('border-color', 'var(--hm-window-accent)', 'important');
    main.style.setProperty('height', 'auto', 'important');
    main.style.setProperty('min-height', 'calc(100vh - var(--hm-titlebar-height))', 'important');
    // Clear the internal scroll container used by an earlier build (inline styles survive a
    // theme update on the same page).
    main.style.removeProperty('overflow-y');
  }

  // React windows (addon settings, packager, ...) mount an absolute/fixed root positioned against
  // the viewport: .container { position:absolute; top:0; height:100%; overflow:hidden } in the
  // addon settings page. Body padding does NOT move such an element, so the title bar covers
  // the top of the page even though the plain <main> windows are fine. Offset the roots too.
  const app = document.getElementById('app');
  if (app) {
    // Class names are hashed by CSS Modules, so match the substring and filter by computed
    // position: static descendants must not be resized.
    const roots = [app, ...document.querySelectorAll('#app [class*="container"]')];
    for (const el of roots) {
      const position = getComputedStyle(el).position;
      if (position === 'absolute' || position === 'fixed') {
        el.style.setProperty('top', 'var(--hm-titlebar-height)', 'important');
        el.style.setProperty('height', 'calc(100% - var(--hm-titlebar-height))', 'important');
      }
    }
  }

  let style = document.getElementById('hm-window-theme-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'hm-window-theme-style';
    document.head.appendChild(style);
  }
  style.textContent = ${JSON.stringify(buildCss())};

  let bar = document.getElementById('hm-window-titlebar');
  if (${JSON.stringify(overlay)}) {
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'hm-window-titlebar';
      body.prepend(bar);
    }
    const styles = ${JSON.stringify(barStyles)};
    for (const name of Object.keys(styles)) bar.style.setProperty(name, styles[name], 'important');

    // Keep the title in its own span so rebuilding the buttons never wipes it.
    let label = bar.querySelector('.hm-window-title-label');
    if (!label) {
      label = document.createElement('span');
      label.className = 'hm-window-title-label';
      label.style.cssText = 'flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      bar.appendChild(label);
    }
    label.textContent = ${JSON.stringify(title)};

    let controlBox = bar.querySelector('.hm-window-controls');
    if (!controlBox) {
      controlBox = document.createElement('div');
      controlBox.className = 'hm-window-controls';
      controlBox.style.cssText = 'position:absolute;top:0;right:0;height:100%;display:flex;flex:0 0 auto';
      controlBox.style.setProperty('-webkit-app-region', 'no-drag', 'important');
      bar.appendChild(controlBox);
    }
    controlBox.textContent = '';
    const defs = ${JSON.stringify(controlDefs)};
    const wash = ${JSON.stringify(wash)};
    const washActive = ${JSON.stringify(washActive)};
    const closeHover = ${JSON.stringify(closeHover)};
    const closeActive = ${JSON.stringify(closeActive)};
    for (const def of defs) {
      const button = document.createElement('div');
      button.setAttribute('role', 'button');
      button.setAttribute('aria-label', def.action);
      button.style.cssText = 'width:46px;height:100%;display:flex;align-items:center;justify-content:center;box-sizing:border-box;color:inherit;transition:background-color 100ms ease-out';
      button.style.setProperty('-webkit-app-region', 'no-drag', 'important');
      button.style.cursor = def.enabled ? 'pointer' : 'default';
      button.style.opacity = def.enabled ? '1' : '0.35';
      button.innerHTML = def.svg;
      if (def.enabled) {
        const isClose = def.action === 'close';
        button.addEventListener('mouseenter', () => {
          button.style.backgroundColor = isClose ? closeHover : wash;
          // Win10 close: white glyph for contrast against the brighter red.
          if (isClose) button.style.color = '#fff';
        });
        button.addEventListener('mousedown', () => {
          button.style.backgroundColor = isClose ? closeActive : washActive;
        });
        button.addEventListener('mouseleave', () => {
          button.style.backgroundColor = 'transparent';
          button.style.color = '';
        });
        button.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          // The registered preload forwards this to the main process (hm-window-control IPC).
          window.postMessage({type: 'hm-window-control', action: def.action}, '*');
        });
      }
      controlBox.appendChild(button);
    }
    // A hidden OS title bar loses double-click-to-maximize; restore it on the drag region.
    bar.ondblclick = (e) => {
      if (e.target.closest('.hm-window-controls')) return;
      if (${JSON.stringify(controls.maximizable !== false)}) {
        window.postMessage({type: 'hm-window-control', action: 'maximize'}, '*');
      }
    };
  } else if (bar) {
    bar.remove();
  }
})()`;
};

const applyPage = async (webContents, browserWindow) => {
  if (webContents.isDestroyed() || browserWindow.isDestroyed()) return;
  try {
    await webContents.executeJavaScript(
      buildPageScript(
        browserWindow.getTitle(),
        !!browserWindow.__hmTitleBarOverlay,
        {
          minimizable: browserWindow.isMinimizable(),
          maximizable: browserWindow.isMaximizable()
        }
      ), true
    );
  } catch (e) {
    // A page that rejected script execution, or a window closed mid-update, keeps its old colours.
  }
};

/**
 * Apply the current theme to one popup window. Safe to call repeatedly and before it has loaded.
 * @param {import('./windows/abstract')} window
 */
const applyToWindow = (window) => {
  if (!window || typeof window.isPopup !== 'function' || !window.isPopup()) return;
  const browserWindow = window.window;
  if (!browserWindow || browserWindow.isDestroyed()) return;

  const webContents = browserWindow.webContents;
  const run = () => {
    const previous = pendingApplies.get(webContents) || Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(() => applyPage(webContents, browserWindow))
      .catch(() => {});
    pendingApplies.set(webContents, next);
  };
  if (!browserWindow.__hmThemeRegistered) {
    browserWindow.__hmThemeRegistered = true;
    webContents.on('did-finish-load', run);
    webContents.on('did-navigate', run);
    // A popup can be shown after its page finished loading, and a React view may replace its
    // own styles later. Re-applying on focus is cheap (the inline styles are idempotent) and
    // guarantees the title bar and its reserved height are present whenever the user looks at it.
    browserWindow.on('focus', run);
  }
  if (!webContents.isLoading() && webContents.getURL()) {
    run();
  }
};

module.exports = {
  supportsOverlay,
  setEditorTheme,
  getPalette,
  buildCss,
  buildPageScript,
  applyToWindow
};
