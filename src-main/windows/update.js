const AbstractWindow = require('./abstract');
const {translate, getLocale, getStrings} = require('../l10n');
const {APP_NAME} = require('../brand');
const openExternal = require('../open-external');
const privilegedFetch = require('../fetch');

const CHANGELOG_URL = 'https://hypermimic.netlify.app/desktop/changelog.json';
const DOWNLOAD_PAGE_URL = 'https://hypermimic.netlify.app/desktop/#download';
const BETA_RELEASES_URL = 'https://github.com/Hyper-Mimic/desktop/releases';

class UpdateWindow extends AbstractWindow {
  constructor (currentVersion, latestVersion, security) {
    super();

    this.window.setTitle(`${translate('update.window-title')} - ${APP_NAME}`);

    this.ipc.on('get-strings', (event) => {
      event.returnValue = {
        appName: APP_NAME,
        locale: getLocale(),
        strings: getStrings()
      };
    });

    this.ipc.on('get-info', (event) => {
      event.returnValue = {
        currentVersion,
        latestVersion,
        security
      };
    });

    this.ipc.handle('download', () => {
      this.window.destroy();

      // Go straight to the download section of the page instead of routing through the
      // update_available.html redirector.
      if (latestVersion.includes('-')) {
        // Pre-releases are only published on GitHub
        openExternal(BETA_RELEASES_URL);
      } else {
        openExternal(DOWNLOAD_PAGE_URL);
      }
    });

    const ignore = (permanently) => {
      const SECOND = 1000;
      const MINUTE = SECOND * 60;
      const HOUR = MINUTE * 60;

      let until;
      if (security) {
        // Security updates can't be ignored.
        until = new Date(0);
      } else if (permanently) {
        // 3000 ought to be enough years into the future...
        until = new Date(3000, 0, 0);
      } else {
        until = new Date();
        until.setTime(until.getTime() + (HOUR * 6));
      }

      // Imported late due to circular dependency
      const {ignoreUpdate} = require('../update-checker');
      ignoreUpdate(latestVersion, until);
    };

    this.ipc.handle('ignore', (event, permanently) => {
      this.window.destroy();
      ignore(permanently);
    });

    this.window.on('close', () => {
      ignore(false);
    });

    // The changelog has to be fetched from the main process. Pages served over the custom
    // tw-update:// scheme are non-standard, so their origin is opaque and a fetch() from the
    // renderer is a cross-origin request. The host (Netlify) sends no Access-Control-Allow-Origin
    // header, so that request fails with "TypeError: Failed to fetch". Node's https module
    // isn't subject to CORS at all.
    const changelog = privilegedFetch.json(`${CHANGELOG_URL}?version=${encodeURIComponent(latestVersion)}`)
      .then((releases) => ({success: true, releases}))
      .catch((error) => ({success: false, error: `${error}`}));

    this.ipc.handle('get-changelog', () => changelog);

    this.window.webContents.on('did-finish-load', () => {
      this.show();
    });

    this.loadURL('tw-update://./update.html');
  }

  getDimensions () {
    return {
      width: 600,
      height: 500
    };
  }

  getPreload () {
    return 'update';
  }

  isPopup () {
    return true;
  }

  static updateAvailable (currentVersion, latestVersion, isSecurity) {
    // A user can re-run the check from desktop settings, so make sure we never stack
    // multiple update windows on top of each other. destroy() emits 'closed' but not
    // 'close', so this won't mark the update as ignored.
    for (const existing of AbstractWindow.getWindowsByClass(UpdateWindow)) {
      existing.window.destroy();
    }
    return new UpdateWindow(currentVersion, latestVersion, isSecurity);
  }
}

module.exports = UpdateWindow;
