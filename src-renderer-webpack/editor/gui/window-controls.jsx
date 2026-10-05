import {defineMessages, injectIntl, intlShape} from 'react-intl';
import PropTypes from 'prop-types';
import React from 'react';

import styles from './window-controls.css';

const messages = defineMessages({
  minimize: {
    defaultMessage: 'Minimize',
    description: 'Accessible name of the window minimize button in the custom title bar',
    id: 'tw.windowControls.minimize'
  },
  maximize: {
    defaultMessage: 'Maximize',
    description: 'Accessible name of the window maximize button in the custom title bar',
    id: 'tw.windowControls.maximize'
  },
  restore: {
    defaultMessage: 'Restore',
    description: 'Accessible name of the window restore button in the custom title bar, shown while maximized',
    id: 'tw.windowControls.restore'
  },
  close: {
    defaultMessage: 'Close',
    description: 'Accessible name of the window close button in the custom title bar',
    id: 'tw.windowControls.close'
  }
});

/* Windows style glyphs on a 16x16 grid, taken from the shapes the OS draws so the buttons look
   native. The maximize glyph is a hollow square, which needs fill-rule: evenodd plus an inner
   subpath -- a plain path would fill solid. fill comes from currentColor, i.e. the menu bar's
   foreground. */
const minimizePath = 'M3 8C3 7.72386 3.22386 7.5 3.5 7.5H12.5C12.7761 7.5 13 7.72386 13 8C13 8.27614 12.7761 8.5 12.5 8.5H3.5C3.22386 8.5 3 8.27614 3 8Z';

const maximizePath = 'M4.5 3C3.67157 3 3 3.67157 3 4.5V11.5C3 12.3284 3.67157 13 4.5 13H11.5C12.3284 13 13 12.3284 13 11.5V4.5C13 3.67157 12.3284 3 11.5 3H4.5ZM4.5 4H11.5C11.7761 4 12 4.22386 12 4.5V11.5C12 11.7761 11.7761 12 11.5 12H4.5C4.22386 12 4 11.7761 4 11.5V4.5C4 4.22386 4.22386 4 4.5 4Z';

const restorePath = 'M9.8 4H5.27c.193-.334.479-.606.824-.782C6.522 3 7.082 3 8.204 3h1.6c1.12 0 1.68 0 2.11.218c.376.192.682.498.874.874c.218.428.218.988.218 2.11v1.6c0 1.12 0 1.68-.218 2.11a2 2 0 0 1-.782.824v-4.53c0-.577 0-.949-.024-1.23c-.022-.272-.06-.372-.085-.422a1 1 0 0 0-.437-.437c-.05-.025-.15-.063-.422-.085a17 17 0 0 0-1.23-.024z M3 8.2c0-1.12 0-1.68.218-2.11c.192-.376.498-.682.874-.874c.428-.218.988-.218 2.11-.218h1.6c1.12 0 1.68 0 2.11.218c.376.192.682.498.874.874c.218.428.218.988.218 2.11v1.6c0 1.12 0 1.68-.218 2.11a2 2 0 0 1-.874.874c-.428.218-.988.218-2.11.218h-1.6c-1.12 0-1.68 0-2.11-.218a2 2 0 0 1-.874-.874C3 11.482 3 10.922 3 9.8z M6.2 6h1.6c.577 0 .949 0 1.23.024c.272.022.372.06.422.085c.188.096.341.249.437.437c.025.05.063.15.085.422c.023.283.024.656.024 1.23v1.6c0 .577 0 .949-.024 1.23c-.022.272-.06.372-.085.422a1 1 0 0 1-.437.437c-.05.025-.15.063-.422.085c-.283.023-.656.024-1.23.024H6.2c-.577 0-.949 0-1.23-.024c-.272-.022-.372-.06-.422-.085a1 1 0 0 1-.437-.437c-.025-.05-.063-.15-.085-.422a17 17 0 0 1-.024-1.23v-1.6c0-.577 0-.949.024-1.23c.022-.272.06-.372.085-.422c.096-.188.249-.341.437-.437c.05-.025.15-.063.422-.085C5.253 6 5.626 6 6.2 6';

const closePath = 'M2.58859 2.71569L2.64645 2.64645C2.82001 2.47288 3.08944 2.4536 3.28431 2.58859L3.35355 2.64645L8 7.293L12.6464 2.64645C12.8417 2.45118 13.1583 2.45118 13.3536 2.64645C13.5488 2.84171 13.5488 3.15829 13.3536 3.35355L8.707 8L13.3536 12.6464C13.5271 12.82 13.5464 13.0894 13.4114 13.2843L13.3536 13.3536C13.18 13.5271 12.9106 13.5464 12.7157 13.4114L12.6464 13.3536L8 8.707L3.35355 13.3536C3.15829 13.5488 2.84171 13.5488 2.64645 13.3536C2.45118 13.1583 2.45118 12.8417 2.64645 12.6464L7.293 8L2.64645 3.35355C2.47288 3.17999 2.4536 2.91056 2.58859 2.71569L2.64645 2.64645L2.58859 2.71569Z';

/**
 * The window's own minimize / maximize / close buttons.
 *
 * The desktop hides the OS title bar (BrowserWindow titleBarStyle: 'hidden', with no
 * titleBarOverlay) and draws these instead, so that they are ordinary DOM and therefore scale with
 * the page zoom along with the menu bar they sit on. See desktop-hoc.jsx for how the menu bar
 * becomes the drag region.
 *
 * Everything the OS would otherwise provide for free has to be done explicitly here: the maximized
 * glyph, double-click to maximize, and keyboard-reachable buttons.
 */
const WindowControls = ({intl, isMaximized, onMinimize, onToggleMaximize, onClose, onDoubleClick}) => {
  const maximizeLabel = intl.formatMessage(isMaximized ? messages.restore : messages.maximize);

  return (
    <div
      className={styles.windowControls}
      // The strip is a window drag region so the window can be moved by it; the buttons opt out.
      onDoubleClick={onDoubleClick}
    >
      <button
        aria-label={intl.formatMessage(messages.minimize)}
        className={styles.windowControlButton}
        onClick={onMinimize}
        title={intl.formatMessage(messages.minimize)}
        type="button"
      >
        <svg
          aria-hidden="true"
          className={styles.windowControlIcon}
          viewBox="0 0 16 16"
        >
          <path d={minimizePath} />
        </svg>
      </button>
      <button
        aria-label={maximizeLabel}
        className={styles.windowControlButton}
        onClick={onToggleMaximize}
        title={maximizeLabel}
        type="button"
      >
        <svg
          aria-hidden="true"
          className={styles.windowControlIcon}
          viewBox="0 0 16 16"
        >
          {/* evenodd + the inner subpath is what makes this a hollow square rather than a solid
              one. Both glyphs are the same shape; only the path data differs. */}
          <path
            d={isMaximized ? restorePath : maximizePath}
            fillRule="evenodd"
          />
        </svg>
      </button>
      <button
        aria-label={intl.formatMessage(messages.close)}
        className={`${styles.windowControlButton} ${styles.windowControlClose}`}
        onClick={onClose}
        title={intl.formatMessage(messages.close)}
        type="button"
      >
        <svg
          aria-hidden="true"
          className={styles.windowControlIcon}
          viewBox="0 0 16 16"
        >
          <path d={closePath} />
        </svg>
      </button>
    </div>
  );
};

WindowControls.propTypes = {
  intl: intlShape.isRequired,
  isMaximized: PropTypes.bool,
  onMinimize: PropTypes.func.isRequired,
  onToggleMaximize: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
  onDoubleClick: PropTypes.func.isRequired
};

export default injectIntl(WindowControls);
