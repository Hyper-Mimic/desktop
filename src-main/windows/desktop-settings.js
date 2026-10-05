const fsPromises = require('fs/promises');
const {app, shell} = require('electron');
const AbstractWindow = require('./abstract');
const {translate, getStrings, getLocale} = require('../l10n');
const {APP_NAME} = require('../brand');
const settings = require('../settings');
const {isUpdateCheckerAllowed, checkForUpdatesManually} = require('../update-checker');
const RichPresence = require('../rich-presence');

class DesktopSettingsWindow extends AbstractWindow {
  constructor () {
    super();

    this.window.setTitle(`${translate('desktop-settings.title')} - ${APP_NAME}`);
    this.window.setMinimizable(false);
    this.window.setMaximizable(false);

    this.ipc.on('init', (event) => {
      event.returnValue = {
        locale: getLocale(),
        strings: getStrings(),
        settings: {
          updateCheckerAllowed: isUpdateCheckerAllowed(),
          updateChecker: settings.updateChecker,
          microphone: settings.microphone,
          camera: settings.camera,
          hardwareAcceleration: settings.hardwareAcceleration,
          backgroundThrottling: settings.backgroundThrottling,
          bypassCORS: settings.bypassCORS,
          spellchecker: settings.spellchecker,
          exitFullscreenOnEscape: settings.exitFullscreenOnEscape,
          richPresenceAvailable: RichPresence.isAvailable(),
          richPresence: settings.richPresence,
          crashDumps: settings.crashDumps,
          // Reported instead of just reading settings.menuBarInTitleBar because the editor can
          // only apply the layout if this platform supports it at all.
          menuBarInTitleBarSupported: process.platform === 'win32' || process.platform === 'linux',
          menuBarInTitleBar: settings.menuBarInTitleBar
        }
      };
    });

    this.ipc.handle('set-update-checker', async (event, updateChecker) => {
      settings.updateChecker = updateChecker;
      await settings.save();
    });

    this.ipc.handle('check-for-updates', async () => checkForUpdatesManually());

    this.ipc.handle('set-crash-dumps', async (event, crashDumps) => {
      settings.crashDumps = crashDumps;
      await settings.save();
    });

    this.ipc.handle('enumerate-media-devices', async () => {
      // Imported late due to circular dependencies
      const EditorWindow = require('./editor');
      const anEditorWindow = AbstractWindow.getWindowsByClass(EditorWindow)[0];
      if (!anEditorWindow) {
        // If you change this error message, please make sure to update desktop settings' error handling
        throw new Error('Editor must be open');
      }
      return anEditorWindow.enumerateMediaDevices();
    });

    this.ipc.handle('set-microphone', async (event, microphone) => {
      settings.microphone = microphone;
      await settings.save();
    });

    this.ipc.handle('set-camera', async (event, camera) => {
      settings.camera = camera;
      await settings.save();
    });

    this.ipc.handle('set-hardware-acceleration', async (event, hardwareAcceleration) => {
      settings.hardwareAcceleration = hardwareAcceleration;
      await settings.save();
    });

    this.ipc.handle('set-background-throttling', async (event, backgroundThrottling) => {
      settings.backgroundThrottling = backgroundThrottling;
      AbstractWindow.settingsChanged();
      await settings.save();
    });

    this.ipc.handle('set-bypass-cors', async (event, bypassCORS) => {
      settings.bypassCORS = bypassCORS;
      await settings.save();
    });

    this.ipc.handle('set-spellchecker', async (event, spellchecker) => {
      settings.spellchecker = spellchecker;
      AbstractWindow.settingsChanged();
      await settings.save();
    });

    this.ipc.handle('set-exit-fullscreen-on-escape', async (event, exitFullscreenOnEscape) => {
      settings.exitFullscreenOnEscape = exitFullscreenOnEscape;
      await settings.save();
    });

    this.ipc.handle('set-rich-presence', async (event, richPresence) => {
      settings.richPresence = richPresence;
      if (richPresence) {
        RichPresence.enable();
      } else {
        RichPresence.disable();
      }
      await settings.save();
    });

    this.ipc.handle('set-menu-bar-in-title-bar', async (event, menuBarInTitleBar) => {
      const supported = process.platform === 'win32' || process.platform === 'linux';
      if (menuBarInTitleBar && !supported) {
        return {recreated: 0, skipped: 0, unsupported: true};
      }

      const wasEnabled = settings.menuBarInTitleBar;
      settings.menuBarInTitleBar = !!menuBarInTitleBar;
      await settings.save();

      if (wasEnabled === settings.menuBarInTitleBar) {
        // Nothing actually changed, so don't disturb the user's windows.
        return {recreated: 0, skipped: 0, unsupported: false};
      }

      // titleBarStyle / titleBarOverlay are BrowserWindow constructor options, so the change only
      // takes effect on a new window. Recreate them now instead of making the user restart, and
      // re-open whatever file each one had. Windows with unsaved changes are skipped (recreate()
      // returns false) so that toggling this can never lose work; the caller reports how many were
      // left alone so the settings page can tell the user to save and try again.
      //
      // Imported late due to circular dependencies: windows/editor.js requires this file.
      const EditorWindow = require('./editor');
      const editorWindows = AbstractWindow.getWindowsByClass(EditorWindow);
      let recreated = 0;
      let skipped = 0;
      for (const editorWindow of editorWindows) {
        if (editorWindow.recreate()) {
          recreated++;
        } else {
          skipped++;
        }
      }
      return {recreated, skipped, unsupported: false};
    });

    this.ipc.handle('open-user-data', async () => {
      shell.showItemInFolder(app.getPath('userData'));
    });

    this.ipc.handle('open-crash-dumps', async () => {
      const crashDumps = app.getPath('crashDumps');
      // folder may not exist yet if setting was just turned on but app not restarted yet
      await fsPromises.mkdir(crashDumps, {
        recursive: true
      });
      shell.showItemInFolder(crashDumps);
    });

    this.loadURL('tw-desktop-settings://./desktop-settings.html');
  }

  getDimensions () {
    return {
      width: 550,
      height: 500
    };
  }

  getPreload () {
    return 'desktop-settings';
  }

  isPopup () {
    return true;
  }

  static show () {
    const window = AbstractWindow.singleton(DesktopSettingsWindow);
    window.show();
  }
}

module.exports = DesktopSettingsWindow;
