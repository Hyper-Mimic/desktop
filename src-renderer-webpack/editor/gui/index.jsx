import React from 'react';
import ReactDOM from 'react-dom';
import GUI from './gui.jsx';
// HyperMimic's core editor features (the advanced settings modal's switches -- unified
// scrollbars, window-modal, workspace toolbox, comment markdown editor, context menu style,
// palette style, ...). The website entry applies them from scratch-gui's
// src/playground/render-interface.jsx, which this bundle never imports: we mount the *library*
// entry (see gui.jsx). Without this the settings modal renders but nothing reads the settings.
import {initHyperMimic} from 'scratch-gui/src/lib/hypermimic-init.js';

import './media-device-chooser-impl.js';
import '../prompt/prompt.js';

initHyperMimic();

const appTarget = document.getElementById('app');
document.body.classList.add('tw-loaded');
GUI.setAppElement(appTarget);

ReactDOM.render(<GUI />, appTarget);

require('./addons');

EditorPreload.getAdvancedCustomizations().then(({userscript, userstyle}) => {
  if (userstyle) {
    const style = document.createElement('style');
    style.textContent = userstyle;
    document.body.appendChild(style);
  }

  if (userscript) {
    const script = document.createElement('script');
    script.textContent = userscript;
    document.body.appendChild(script);
  }
});
