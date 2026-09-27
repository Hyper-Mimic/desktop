const {app} = require('electron');
const settings = require('./settings');
const UpdateWindow = require('./windows/update');
const packageJSON = require('../package.json');
const privilegedFetch = require('./fetch');

const currentVersion = packageJSON.version;
const URL = 'https://hypermimic.netlify.app/desktop/version.json';

/**
 * Determines whether the update checker is even allowed to be enabled
 * in this build of the app.
 * @returns {boolean}
 */
const isUpdateCheckerAllowed = () => {
  if (process.env.TW_DISABLE_UPDATE_CHECKER) {
    return false;
  }

  // When running from source (npm run electron:start) there is no packaging step to inject
  // tw_update into package.json, so allow it explicitly to keep the update flow testable
  // during development.
  if (!app.isPackaged) {
    return true;
  }

  // Must be enabled in package.json
  return !!packageJSON.tw_update;
};

const checkForUpdates = async () => {
  if (!isUpdateCheckerAllowed() || settings.updateChecker === 'never') {
    return;
  }

  const json = await privilegedFetch.json(URL);
  const latestStable = json.latest;
  const latestUnstable = json.latest_unstable;
  const oldestSafe = json.oldest_safe;

  // Imported lazily as it takes about 10ms to import
  const semverLt = require('semver/functions/lt');

  // Security updates can not be ignored.
  if (semverLt(currentVersion, oldestSafe)) {
    UpdateWindow.updateAvailable(currentVersion, latestStable, true);
    return;
  }

  if (settings.updateChecker === 'security') {
    // Nothing further to check
    return;
  }

  const latest = settings.updateChecker === 'unstable' ? latestUnstable : latestStable;
  const now = Date.now();
  const ignoredUpdate = settings.ignoredUpdate;
  const ignoredUpdateUntil = settings.ignoredUpdateUntil * 1000;
  if (ignoredUpdate === latest && now < ignoredUpdateUntil) {
    // This update was ignored
    return;
  }

  if (semverLt(currentVersion, latest)) {
    UpdateWindow.updateAvailable(currentVersion, latest, false);
  }
};

/**
 * Manually check for updates, used by the "Check for Updates" button in desktop settings.
 * Unlike the automatic check on startup, this:
 *  - ignores `settings.updateChecker === 'never'` because the user explicitly asked
 *  - ignores the "remind me later" / "ignore this update" record
 * It still respects the build-level switch (TW_DISABLE_UPDATE_CHECKER / package.json tw_update).
 * If an update is found, the update window is opened immediately.
 * @returns {Promise<{
 *   status: 'update-available' | 'up-to-date' | 'disabled' | 'error',
 *   currentVersion: string,
 *   latestVersion?: string,
 *   isSecurity?: boolean,
 *   error?: string
 * }>}
 */
const checkForUpdatesManually = async () => {
  if (!isUpdateCheckerAllowed()) {
    return {
      status: 'disabled',
      currentVersion
    };
  }

  let json;
  try {
    json = await privilegedFetch.json(URL);
  } catch (error) {
    return {
      status: 'error',
      currentVersion,
      error: `${error}`
    };
  }

  const latestStable = json.latest;
  const latestUnstable = json.latest_unstable;
  const oldestSafe = json.oldest_safe;

  // Imported lazily as it takes about 10ms to import
  const semverLt = require('semver/functions/lt');

  // Security updates take priority
  if (semverLt(currentVersion, oldestSafe)) {
    UpdateWindow.updateAvailable(currentVersion, latestStable, true);
    return {
      status: 'update-available',
      currentVersion,
      latestVersion: latestStable,
      isSecurity: true
    };
  }

  // 'security' and 'never' both fall back to the stable channel for a manual check
  const latest = settings.updateChecker === 'unstable' ? latestUnstable : latestStable;
  if (semverLt(currentVersion, latest)) {
    UpdateWindow.updateAvailable(currentVersion, latest, false);
    return {
      status: 'update-available',
      currentVersion,
      latestVersion: latest,
      isSecurity: false
    };
  }

  return {
    status: 'up-to-date',
    currentVersion,
    latestVersion: latestStable
  };
};

/**
 * @param {string} version
 * @param {Date} until
 */
const ignoreUpdate = async (version, until) => {
  settings.ignoredUpdate = version;
  settings.ignoredUpdateUntil = Math.floor(until.getTime() / 1000);
  await settings.save();
};

module.exports = {
  isUpdateCheckerAllowed,
  checkForUpdates,
  checkForUpdatesManually,
  ignoreUpdate
};
