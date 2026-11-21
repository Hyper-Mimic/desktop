const {ipcRenderer} = require('electron');

/**
 * Draws the desktop's native context menu (cut / copy / paste, spelling suggestions, links) as
 * DOM instead of an Electron Menu. Electron's native menus cannot be coloured, so the main
 * process (src-main/context-menu.js) sends the items plus the editor's resolved theme palette
 * and this builds the menu in the page. Registered for every window with
 * session.registerPreloadScript, so no per-window preload needs to know about it.
 *
 * Sandboxed preload: keep this file self-contained, only require('electron').
 */

// webContents.send reaches every frame; only the top-level one should draw a menu.
if (window.top === window) {
  const MENU_ID = 'hm-context-menu';
  const ANIM_MS = 130;
  const reduceMotion = !!(window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  let container = null;

  const removeClosingMenus = () => {
    for (const node of document.querySelectorAll('[data-hm-context-menu-closing]')) {
      node.remove();
    }
  };

  const alpha = (hex, a) => {
    const match = /^#([\da-f]{6})$/i.exec(hex || '');
    if (!match) return `rgba(128, 128, 128, ${a})`;
    const value = parseInt(match[1], 16);
    return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${a})`;
  };

  const onOutside = (e) => {
    if (container && !container.contains(e.target)) close();
  };
  const onKeyDown = (e) => {
    if (e.key === 'Escape') close();
  };

  const close = () => {
    const closing = container;
    container = null;
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onKeyDown, true);
    if (!closing) return;
    if (reduceMotion) {
      closing.remove();
      return;
    }
    // Fade out before removing. Actions already live in the main process (see context-menu.js),
    // so delaying the DOM removal cannot cancel a click that was just sent.
    closing.removeAttribute('id');
    closing.dataset.hmContextMenuClosing = 'true';
    closing.style.pointerEvents = 'none';
    closing.style.opacity = '0';
    closing.style.transform = 'translateY(-4px) scale(0.98)';
    setTimeout(() => closing.remove(), ANIM_MS);
  };

  const show = (data) => {
    close();
    // A rapid second right-click must not leave the previous menu fading out on top of the new one.
    removeClosingMenus();

    const palette = data.theme || {};
    const background = palette.background || '#ffffff';
    const foreground = palette.text || '#000000';
    const accent = palette.accent || '#4c97ff';

    container = document.createElement('div');
    container.id = MENU_ID;
    Object.assign(container.style, {
      position: 'fixed',
      top: `${data.y}px`,
      left: `${data.x}px`,
      zIndex: '2147483647',
      minWidth: '150px',
      maxWidth: '280px',
      padding: '5px',
      boxSizing: 'border-box',
      backgroundColor: background,
      color: foreground,
      border: `1px solid ${accent}`,
      borderRadius: '8px',
      // Layered shadow: a dark lift plus a soft tint of the theme accent, so it reads on both
      // light and dark backgrounds.
      boxShadow: `0 14px 40px rgba(0, 0, 0, 0.38), 0 2px 10px ${alpha(accent, 0.28)}`,
      font: '13px "Helvetica Neue", Helvetica, Arial, sans-serif',
      userSelect: 'none',
      webkitUserSelect: 'none',
      opacity: reduceMotion ? '1' : '0',
      transform: reduceMotion ? 'none' : 'translateY(-6px) scale(0.97)',
      transformOrigin: 'top left',
      transition: reduceMotion ? 'none' :
        `opacity ${ANIM_MS}ms ease-out, transform ${ANIM_MS}ms cubic-bezier(0.33, 1, 0.68, 1)`
    });

    for (const item of data.items) {
      if (item.separator) {
        const separator = document.createElement('div');
        Object.assign(separator.style, {
          height: '1px',
          margin: '4px 6px',
          backgroundColor: alpha(foreground, 0.22)
        });
        container.appendChild(separator);
        continue;
      }

      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = item.label;
      button.disabled = !item.enabled;
      Object.assign(button.style, {
        display: 'block',
        width: '100%',
        padding: '6px 10px',
        border: '0',
        borderRadius: '4px',
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        textAlign: 'left',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        cursor: item.enabled ? 'pointer' : 'default',
        opacity: item.enabled ? '1' : '0.45'
      });
      if (item.enabled) {
        button.addEventListener('mouseenter', () => {
          button.style.backgroundColor = alpha(accent, 0.22);
        });
        button.addEventListener('mouseleave', () => {
          button.style.backgroundColor = 'transparent';
        });
        // Fire on mousedown, before focus/scroll side effects can remove the element (a removed
        // button never gets a click event). `click` is a fallback for keyboard/touch activation.
        let fired = false;
        const activate = (e) => {
          if (fired) return;
          fired = true;
          e.preventDefault();
          e.stopPropagation();
          ipcRenderer.send('hm-context-menu-action', {
            requestId: data.requestId,
            id: item.id
          });
          close();
        };
        button.addEventListener('mousedown', activate);
        button.addEventListener('click', activate);
      }
      container.appendChild(button);
    }

    (document.body || document.documentElement).appendChild(container);

    // Keep the menu inside the window.
    const rect = container.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      container.style.left = `${Math.max(0, window.innerWidth - rect.width - 4)}px`;
    }
    if (rect.bottom > window.innerHeight) {
      container.style.top = `${Math.max(0, window.innerHeight - rect.height - 4)}px`;
    }

    if (!reduceMotion) {
      // Commit the initial opacity/transform before switching to the target values; otherwise
      // Chromium coalesces both into one frame and the transition never plays.
      void container.offsetWidth;
      container.style.opacity = '1';
      container.style.transform = 'translateY(0) scale(1)';
    }

    // Deferred so the mousedown that opened this menu cannot immediately dismiss it.
    setTimeout(() => {
      if (!container) return;
      document.addEventListener('mousedown', onOutside, true);
      document.addEventListener('keydown', onKeyDown, true);
    }, 0);
  };

  ipcRenderer.on('hm-show-context-menu', (event, data) => show(data));
  // A different window opened a menu; drop ours if it is still on screen.
  ipcRenderer.on('hm-hide-context-menu', () => close());
}

// The themed title bar (drawn by src-main/theme.js in the main world) cannot reach ipcRenderer.
// Forward its min/max/close clicks from here; the main process handles hm-window-control.
window.addEventListener('message', (e) => {
  if (e.source === window && e.data && e.data.type === 'hm-window-control') {
    ipcRenderer.send('hm-window-control', e.data.action);
  }
});
