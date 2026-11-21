import SettingsStore from 'scratch-gui/src/addons/settings-store-singleton.js';

/**
 * Reports the editor's resolved colours to the main process so standalone windows can match.
 *
 * custom-editor-theme writes `--customEditorTheme-*` on <html> and only its own stylesheet reads
 * them; none of that reaches another BrowserWindow. Rather than duplicating the addon's whole
 * palette in every window, resolve a handful of colours here and let src-main/theme.js push them
 * out (title bar overlay + a few CSS variables).
 *
 * Colours are read from computed styles, not from the addon's settings: that also covers the
 * default theme, accent presets, dark mode and any other addon that tints the menu bar. When the
 * addon is not loaded, the GUI's own theme variables (--ui-secondary, --text-primary,
 * --menu-bar-background) are used, so the standalone windows always get a complete palette.
 */

let probe = null;
let lastSerialized = '';

/** Custom properties keep their literal value (`#ffffff0d`, `var(...)`), so resolve via CSS. */
const toHex = (value) => {
    if (typeof value !== 'string' || !value.trim()) return null;
    if (!probe) {
        probe = document.createElement('span');
        probe.style.position = 'absolute';
        probe.style.left = '-9999px';
        probe.style.visibility = 'hidden';
        probe.style.pointerEvents = 'none';
        document.body.appendChild(probe);
    }
    probe.style.color = '';
    probe.style.color = value.trim();
    if (!probe.style.color) return null;
    const computed = getComputedStyle(probe).color;
    const match = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/.exec(computed);
    if (!match) return null;
    // A fully transparent colour is not a background to copy -- fall through to the next source.
    if (match[4] !== undefined && Number(match[4]) === 0) return null;
    return `#${match.slice(1, 4)
        .map(part => Math.min(255, Number(part)).toString(16).padStart(2, '0'))
        .join('')}`;
};

const isDark = (hex) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return (0.2126 * r) + (0.7152 * g) + (0.0722 * b) < 128;
};

const collect = () => {
    const root = getComputedStyle(document.documentElement);
    // custom-editor-theme's variables live on <html> as inline style (see addons/api.js
    // updateCssVariables). The GUI's own theme variables live there too (lib/themes/guiHelpers.js).
    // Disabling the addon can leave its variables behind, so check the enabled state instead of
    // just reading whatever is on <html>: that is what makes on/off switches apply instantly.
    const addonEnabled = SettingsStore.getAddonEnabled('custom-editor-theme');
    const readVar = name => (addonEnabled ? root.getPropertyValue(`--customEditorTheme-${name}`).trim() : '');
    const guiVar = name => toHex(root.getPropertyValue(name).trim());
    const menuBar = document.querySelector('[class*="menu-bar_menu-bar_"]');
    const menuBarStyle = menuBar ? getComputedStyle(menuBar) : null;
    const menuBarBackground = menuBarStyle && toHex(menuBarStyle.backgroundColor);
    const menuBarForeground = menuBarStyle && toHex(menuBarStyle.color);

    const titleBar = toHex(readVar('menuBar')) || menuBarBackground || null;
    const titleBarText = toHex(readVar('menuBar-text')) || menuBarForeground || null;

    // When custom-editor-theme is not loaded, fall back to the GUI's own palette: --ui-secondary
    // for the page and --text-primary for text. Those are set by the GUI theme manager, so
    // light/dark mode works. The popup windows always get a full palette, never their hard-coded
    // white/orange defaults.
    const background = toHex(readVar('page')) || guiVar('--ui-secondary') || '#ffffff';
    const text = toHex(readVar('page-text')) || guiVar('--text-primary') || '#000000';
    // The popup borders use custom-editor-theme's "主题强调色" = the accentColor setting
    // (--customEditorTheme-accentColor). Its separate "accent" setting is the dark BACKGROUND of
    // accent-coloured panels, not a border colour -- using it made the borders dark instead of
    // the theme colour. --looks-secondary is the GUI's equivalent when the addon is off (and in
    // dark mode), while --menu-bar-background is not: the dark GUI theme overrides it with
    // #333333.
    const accent = toHex(readVar('accentColor')) || guiVar('--looks-secondary') ||
        guiVar('--menu-bar-background') || menuBarBackground || '#4c97ff';

    return {
        titleBar,
        titleBarText,
        background,
        text,
        accent,
        dark: isDark(background)
    };
};

const report = () => {
    const preload = window.EditorPreload;
    if (!preload || typeof preload.reportEditorTheme !== 'function') return;
    const theme = collect();
    const serialized = JSON.stringify(theme);
    if (serialized === lastSerialized) return;
    lastSerialized = serialized;
    preload.reportEditorTheme(theme);
};

const initEditorThemeSync = () => {
    report();
    // The menu bar mounts with the GUI, and addon settings (including the custom properties) are
    // applied asynchronously. Re-read after those have settled.
    setTimeout(report, 400);
    setTimeout(report, 1500);
    // Custom properties are written as inline style on <html>; a colour change, a preset, dark
    // mode or the addon being toggled all change that attribute. Root class changes cover the
    // GUI theme manager. Call report() directly -- no requestAnimationFrame or timer: this window
    // is in the background while the user edits colours from a standalone window, and a
    // background rAF never fires (timers are throttled too). MutationObserver callbacks still
    // run in the background, so the new colours reach the main process immediately.
    new MutationObserver(report).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['style', 'class']
    });
    // Enabling / disabling custom-editor-theme (or changing one of its colours) from the addon
    // settings window does not necessarily rewrite <html>'s style: when the addon is disabled its
    // custom properties can simply be left behind. These events fire as soon as the settings store
    // is synced, and collect() checks the enabled state, so both directions apply instantly.
    // Defer by one microtask: the addon runner reacts to these same events and rewrites the
    // custom properties, so reading the DOM after the listeners have run gives the new colours.
    const reportSoon = () => Promise.resolve().then(report);
    SettingsStore.addEventListener('addon-changed', reportSoon);
    SettingsStore.addEventListener('setting-changed', reportSoon);
    // The addon settings window writes the same localStorage; 'storage' fires here even while
    // this window is not focused, and covers the gap before the CSS variables are re-applied.
    window.addEventListener('storage', report);
    // Refocusing the editor after changing a theme elsewhere picks up anything the observer
    // missed (e.g. a theme change that only re-mounted the GUI subtree).
    document.addEventListener('visibilitychange', report);
    // Pure fallback for changes that touch neither <html> nor localStorage. The JSON comparison
    // in report() means no IPC is sent unless a colour really changed.
    setInterval(report, 3000);
};

export {
    initEditorThemeSync
};
