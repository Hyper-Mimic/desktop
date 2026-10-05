// Electron ships confirm() and prompt() by default, but for some reason they break can window focus, for example.
// Thus we reimplement our own.

const {dialog} = require('electron');
const {translate} = require('./l10n');
const {APP_NAME} = require('./brand');

/**
 * @param {Electron.BrowserWindow} window
 * @param {string} message
 */
const alert = (window, message) => {
  dialog.showMessageBoxSync(window, {
    title: APP_NAME,
    message: '' + message,
    buttons: [
      translate('prompt.ok')
    ],
    noLink: true
  });
};

/**
 * @param {Electron.BrowserWindow} window
 * @param {string} message
 * @returns {boolean}
 */
const confirm = (window, message) => {
  const result = dialog.showMessageBoxSync(window, {
    title: APP_NAME,
    message: '' + message,
    buttons: [
      translate('prompt.ok'),
      translate('prompt.cancel')
    ],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  });
  return result === 0;
};

/**
 * The prompt shown when unsaved work is about to be lost.
 *
 * It has two callers and has to look identical to both, but they cannot make the call the same way:
 * closing a window reaches this from inside the renderer's will-prevent-unload handler, where a
 * synchronous dialog has to be deferred with a timeout to avoid breaking window focus on Windows
 * (see windows/editor.js), while recreating a window runs from an async IPC handler and can simply
 * await the asynchronous dialog. So the shared part is the options, not the call.
 *
 * Button 0 is "stay" and button 1 is "leave"; both are also what pressing escape and pressing enter
 * pick, so an accidental keypress can never discard work.
 *
 * @returns {Electron.MessageBoxOptions}
 */
const getUnsavedChangesOptions = () => ({
  title: APP_NAME,
  type: 'info',
  buttons: [
    translate('unload.stay'),
    translate('unload.leave')
  ],
  cancelId: 0,
  defaultId: 0,
  message: translate('unload.message'),
  detail: translate('unload.detail'),
  noLink: true
});

module.exports = {
  alert,
  confirm,
  getUnsavedChangesOptions
};
