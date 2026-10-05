import React from 'react';
import {connect} from 'react-redux';
import PropTypes from 'prop-types';
import {
  openLoadingProject,
  closeLoadingProject,
  openInvalidProjectModal
} from 'scratch-gui/src/reducers/modals';
import {
  requestProjectUpload,
  setProjectId,
  defaultProjectId,
  onFetchedProjectData,
  onLoadedProject,
  requestNewProject
} from 'scratch-gui/src/reducers/project-state';
import {
  setFileHandle,
  setUsername,
  setProjectError
} from 'scratch-gui/src/reducers/tw';
import {setPlayer} from 'scratch-gui/src/reducers/mode';
import MenuBar from 'scratch-gui/src/components/menu-bar/menu-bar.jsx';
import SBFileUploaderHOC from 'scratch-gui/src/lib/sb-file-uploader-hoc.jsx';
import {showOpenFilePicker, showSaveFilePicker, WrappedFileHandle} from './filesystem-api.js';
import {setStrings} from '../prompt/prompt.js';
import WindowControls from './window-controls.jsx';
import styles from './gui.css';

let mountedOnce = false;

/**
 * @param {string} filename
 * @returns {string}
 */
const getDefaultProjectTitle = (filename) => {
  const match = filename.match(/([^/\\]+)\.sb[2|3]?$/);
  if (!match) return filename;
  return match[1];
};

const handleClickAddonSettings = (search) => {
  EditorPreload.openAddonSettings(typeof search === 'string' ? search : null);
};

const handleClickNewWindow = () => {
  EditorPreload.openNewWindow();
};

const handleClickPackager = () => {
  EditorPreload.openPackager();
};

const handleClickDesktopSettings = () => {
  EditorPreload.openDesktopSettings();
};

const handleClickPrivacy = () => {
  EditorPreload.openPrivacy();
};

const handleClickAbout = () => {
  EditorPreload.openAbout();
};

const handleClickSourceCode = () => {
  window.open('https://github.com/Hyper-Mimic');
};

const securityManager = {
  // Everything not specified here falls back to the scratch-gui security manager

  // Managed by Electron main process:
  canReadClipboard: () => true,
  canNotify: () => true,

  // Does not work in Electron:
  canGeolocate: () => false
};

const USERNAME_KEY = 'tw:username';
const DEFAULT_USERNAME = 'player';

/**
 * Menu bar shown above the stage while the GUI is in player mode.
 *
 * The desktop app mounts scratch-gui's library entry (src/index.js -> containers/gui.jsx), so it
 * never renders playground/render-interface.jsx -- the website's shell whose isHomepage branch
 * hosts the project-view menu bar. In player mode scratch-gui only draws the stage
 * (components/gui/gui.jsx isPlayerOnly branch), which on its own is a dead end.
 *
 * MenuBar is scratch-gui's connected default export, so it brings its own "See inside" handler
 * (menu-bar.jsx mapDispatchToProps: onClickSeeInside -> dispatch(setPlayer(false))). All this has
 * to supply is enableSeeInside plus the desktop-specific callbacks. menu-bar.jsx suppresses the
 * "See Project Page" button while isPlayerOnly so enableSeeInside actually gets a chance to
 * render.
 */
const ProjectViewMenuBar = ({messages, onClickAbout, onStartSelectingFileUpload}) => (
  <div className={styles.projectViewMenuBar}>
    <MenuBar
      canChangeLanguage
      canChangeTheme
      canEditTitle
      // Renders the "File" dropdown (menu-bar.jsx canManageFiles gate). The desktop's own native
      // menu bar only exists on macOS (src-main/menu-bar.js Menu.setApplicationMenu(null)
      // elsewhere), so on Windows/Linux this is the only way to reach new / save / open.
      canManageFiles
      enableSeeInside
      showOpenFilePicker={showOpenFilePicker}
      showSaveFilePicker={showSaveFilePicker}
      onClickAbout={onClickAbout}
      onClickAddonSettings={handleClickAddonSettings}
      onClickDesktopSettings={handleClickDesktopSettings}
      onClickNewWindow={handleClickNewWindow}
      onClickPackager={handleClickPackager}
      onStartSelectingFileUpload={onStartSelectingFileUpload}
    />
  </div>
);

ProjectViewMenuBar.propTypes = {
  messages: PropTypes.object.isRequired,
  onClickAbout: PropTypes.array.isRequired,
  onStartSelectingFileUpload: PropTypes.func
};

// "Load from computer" is wired through SBFileUploaderHOC, which normally wraps
// containers/gui.jsx and injects onStartSelectingFileUpload into the MenuBar that
// components/gui/gui.jsx renders. This menu bar is a separate instance outside that subtree, so
// the same HOC is applied here to get the same behavior instead of reimplementing the file-open
// state machine (requestProjectUpload -> load -> onLoadedProject -> setFileHandle).
const ProjectViewMenuBarWithFileUpload = SBFileUploaderHOC(ProjectViewMenuBar);

/**
 * The window's own title bar controls, shown when "merge the menu bar into the window title bar" is
 * on. The main process then builds the window with titleBarStyle: 'hidden' and no overlay, so
 * nothing is drawn by the OS and these have to be.
 *
 * They are ordinary DOM rather than a titleBarOverlay specifically because the overlay is painted by
 * the OS at a fixed size: with Ctrl+=/- the menu bar they sit on grows and shrinks while the overlay
 * buttons would not. Being DOM, they follow the zoom for free.
 *
 * The class on <html> is what makes scratch-gui's menu-bar.css turn the bar into a drag region and
 * reserve room for these; it cannot be a React-driven style because the rule targets <html>.
 *
 * The controls' height has to follow the menu bar's, which addons change: editor-compact shrinks it
 * from 3rem to 2rem. A ResizeObserver measures the bar and publishes the height as a CSS variable,
 * which is what window-controls.css sizes itself from.
 *
 * Rendered from here rather than from gui.jsx so that it is inside AppStateHOC, i.e. inside the
 * IntlProvider that the buttons' labels need.
 */
class MergedTitleBar extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      isMaximized: false,
      // Whether the merged title bar currently applies. Driven from props by syncMergedState()
      // rather than derived during render, because the <html> class it controls is a side effect.
      merged: true
    };
    this.handleMinimize = this.handleMinimize.bind(this);
    this.handleToggleMaximize = this.handleToggleMaximize.bind(this);
    this.handleClose = this.handleClose.bind(this);
  }
  componentDidMount () {
    const root = document.documentElement;
    // Persistent: the window has no OS title bar for as long as it is open, so the web content is
    // the only thing the window can be dragged by. Set here rather than in syncMergedState because it
    // must survive fullscreen, where the controls themselves step aside.
    root.classList.add('hm-custom-titlebar');
    this.syncMergedState();

    // The window may already be maximized (restored on startup), so ask rather than assume false.
    // The main process also pushes changes, which covers the user double-clicking the bar or using
    // the taskbar.
    EditorPreload.isMaximized().then(isMaximized => {
      this.setState({isMaximized});
    });
    this.unsubscribe = EditorPreload.onMaximizeChanged(isMaximized => {
      this.setState({isMaximized});
    });

    // There can be more than one menu bar (the editor's and the project view's); the controls sit on
    // whichever is topmost, so watch the first one that appears.
    this.syncTitlebarHeight = () => {
      const menuBar = document.querySelector('[class*="menu-bar_menu-bar"]');
      if (menuBar) {
        // offsetHeight is the border-box height, which is what the controls' height should match.
        root.style.setProperty('--hm-titlebar-height', `${menuBar.offsetHeight}px`);
        setTitlebarColors(menuBar);
      }
    };
    this.menuBarObserver = new ResizeObserver(this.syncTitlebarHeight);

    // The GUI renders on the next tick, so the bar may not exist yet on the first frame. Retry a
    // bounded number of times: an unbounded requestAnimationFrame loop would spin forever.
    let attempts = 0;
    const attach = () => {
      if (this.unmounting) {
        return;
      }
      const menuBar = document.querySelector('[class*="menu-bar_menu-bar"]');
      if (menuBar) {
        this.menuBarObserver.observe(menuBar);
        this.syncTitlebarHeight();
        return;
      }
      if (++attempts < 60) {
        this.attachFrame = requestAnimationFrame(attach);
      }
    };
    attach();

    // Recolouring the menu bar does not resize it, so the ResizeObserver stays quiet. Two more
    // sources can change it and both have to be covered, because the custom-editor-theme addon is
    // loaded from upstream at runtime and its mechanism is not visible from here:
    //   - the theme system writes colour variables onto <html> (lib/themes/guiHelpers.js), so
    //     attribute changes on <html> cover light/dark/high-contrast and accent switches;
    //   - an addon may instead inject or replace a <style> element, so subtree changes in <head>
    //     cover that.
    // setTitlebarColors only writes when the answer changed, so this cannot feed itself.
    const recolour = () => {
      const menuBar = document.querySelector('[class*="menu-bar_menu-bar"]');
      if (menuBar) {
        setTitlebarColors(menuBar);
      }
    };
    this.rootObserver = new MutationObserver(recolour);
    this.rootObserver.observe(root, {
      attributes: true,
      attributeFilter: ['class', 'style', 'theme']
    });
    this.headObserver = new MutationObserver(recolour);
    this.headObserver.observe(document.head, {childList: true, subtree: true});
  }
  componentDidUpdate (prevProps) {
    if (prevProps.isFullScreen !== this.props.isFullScreen) {
      this.syncMergedState();
    }
  }
  /**
   * Turn the merged title bar on or off, according to whether it makes sense right now.
   *
   * Two classes are involved, and they mean different things:
   *
   *   - hm-custom-titlebar: this window has no OS title bar at all, because the setting is on. It is
   *     set once and never toggled at runtime, since that would mean rebuilding the window. This is
   *     what gates "there is nothing to drag the window by except the web content".
   *   - hm-titlebar-merged: the window controls are being drawn right now, which additionally
   *     requires the menu bar to be the thing at the top of the window. Editor fullscreen is the
   *     exception: the stage draws its own full-width control bar over the top strip
   *     (components/stage-header/stage-header.css .stage-header-wrapper-overlay is position:fixed
   *     with top/left/right: 0), with its settings and exit-fullscreen buttons at the right end,
   *     exactly where the window controls sit. So the controls step aside there -- but the stage's
   *     bar becomes the drag region instead, so the window is still movable.
   */
  syncMergedState () {
    const root = document.documentElement;
    const merged = !this.props.isFullScreen;
    root.classList.toggle('hm-titlebar-merged', merged);
    // The controls and the space reserved for them in menu-bar.css both mirror in RTL locales, and
    // they live outside the GUI subtree that carries dir="rtl" (components/gui/gui.jsx puts it on
    // its own pageWrapper Box), so <html> has to carry the signal for the stylesheet to see.
    root.classList.toggle('hm-rtl', !!this.props.isRtl);
    this.setState({merged});
  }
  componentWillUnmount () {
    this.unmounting = true;
    if (this.attachFrame !== undefined) {
      cancelAnimationFrame(this.attachFrame);
    }
    if (this.menuBarObserver) {
      this.menuBarObserver.disconnect();
    }
    if (this.rootObserver) {
      this.rootObserver.disconnect();
    }
    if (this.headObserver) {
      this.headObserver.disconnect();
    }
    document.documentElement.classList.remove('hm-titlebar-merged');
    document.documentElement.classList.remove('hm-custom-titlebar');
    document.documentElement.classList.remove('hm-rtl');
    for (const name of Object.keys(TITLEBAR_WASHES.light)) {
      document.documentElement.style.removeProperty(name);
    }
    document.documentElement.style.removeProperty('--hm-titlebar-height');
    lastGlyph = null;
    lastWash = null;
    if (this.unsubscribe) {
      this.unsubscribe();
    }
  }
  handleMinimize () {
    EditorPreload.minimizeWindow();
  }
  handleToggleMaximize () {
    // The glyph flips when the main process reports the new state, so nothing to do here.
    EditorPreload.toggleMaximizeWindow();
  }
  handleClose () {
    EditorPreload.closeWindow();
  }
  render () {
    if (!this.state.merged) {
      return null;
    }
    return (
      <WindowControls
        isMaximized={this.state.isMaximized}
        onMinimize={this.handleMinimize}
        onToggleMaximize={this.handleToggleMaximize}
        onClose={this.handleClose}
        onDoubleClick={this.handleToggleMaximize}
      />
    );
  }
}

MergedTitleBar.propTypes = {
  isFullScreen: PropTypes.bool,
  isRtl: PropTypes.bool
};

/**
 * Publish the window controls' colours as CSS variables on <html>, derived from the menu bar they
 * share a row with.
 *
 * The glyph colour is simply the menu bar's own computed text colour, so the buttons match it under
 * any configuration. The computed value is what makes this work where reading a variable does not:
 * scratch-gui's menu bar sets `color: var(--menu-bar-foreground)`, but the custom-editor-theme addon
 * overrides it on the element with `color: var(--customEditorTheme-menuBar-text)` and never touches
 * that variable. getComputedStyle resolves whichever one won, so both paths are covered without
 * knowing which addon is active.
 *
 * The hover washes are a separate concern: they have to contrast with the menu bar's *background*,
 * not match its text, and CSS cannot branch on a colour's lightness — there is no "is this colour
 * light" selector. The theme flag is not a substitute either, since a custom accent can be pale on
 * the light theme and the high-contrast theme inverts things outright. So the rendered background is
 * measured and the wash direction picked from that.
 *
 * These are variables rather than a pair of theme-class rules on purpose: keying the washes off
 * classes such as html.hm-titlebar-dark made them (0,3,1), which outranked the close button's own
 * :hover rule and cost it the red. As variables the rules stay at (0,2,0) and source order decides.
 *
 * getComputedStyle is used throughout rather than reading the CSS variables directly, because those
 * hold unresolved values like `var(--looks-secondary)`.
 *
 * @param {Element} menuBar the rendered menu bar element
 */
const TITLEBAR_WASHES = {
  light: {
    '--hm-titlebar-wash': 'rgba(0, 0, 0, 0.08)',
    '--hm-titlebar-wash-active': 'rgba(0, 0, 0, 0.16)'
  },
  dark: {
    '--hm-titlebar-wash': 'rgba(255, 255, 255, 0.16)',
    '--hm-titlebar-wash-active': 'rgba(255, 255, 255, 0.26)'
  }
};

let lastGlyph = null;
let lastWash = null;

const setTitlebarColors = (menuBar) => {
  const computed = getComputedStyle(menuBar);

  if (computed.color !== lastGlyph) {
    lastGlyph = computed.color;
    document.documentElement.style.setProperty('--hm-titlebar-glyph', computed.color);
  }

  const match = computed.backgroundColor && computed.backgroundColor.match(/^rgba?\(([^)]+)\)/);
  let isLight = true;
  if (match) {
    const parts = match[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    const [r, g, b] = parts;
    if (parts.length >= 3 && [r, g, b].every(Number.isFinite)) {
      // Rec. 601 luma, the usual "is this light" weighting. Mid-grey at 0.5 is the crossover.
      const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      isLight = luma > 0.5;
    }
  }
  // Only write when the answer changed: this runs from a MutationObserver on <html>'s style
  // attribute, and writing identical values can still queue another record.
  const next = isLight ? 'light' : 'dark';
  if (next === lastWash) {
    return;
  }
  lastWash = next;
  for (const [name, value] of Object.entries(TITLEBAR_WASHES[next])) {
    document.documentElement.style.setProperty(name, value);
  }
};

const DesktopHOC = function (WrappedComponent) {
  class DesktopComponent extends React.Component {
    constructor (props) {
      super(props);
      this.state = {
        title: ''
      };
      this.handleUpdateProjectTitle = this.handleUpdateProjectTitle.bind(this);
      this.handleSeeInside = this.handleSeeInside.bind(this);
      this.handleKeyDown = this.handleKeyDown.bind(this);

      // Changing locale always re-mounts this component
      const stateFromMain = EditorPreload.setLocale(this.props.locale);
      this.messages = stateFromMain.strings;
      setStrings({
        ok: this.messages['prompt.ok'],
        cancel: this.messages['prompt.cancel']
      });

      const storedUsername = localStorage.getItem(USERNAME_KEY);
      if (typeof storedUsername === 'string') {
        this.props.onSetReduxUsername(storedUsername);
      } else {
        this.props.onSetReduxUsername(DEFAULT_USERNAME);
      }
    }
    componentDidMount () {
      EditorPreload.setExportForPackager(() => this.props.vm.saveProjectSb3('arraybuffer')
        .then((buffer) => ({
          name: this.state.title,
          data: buffer
        })));

      // Escape leaves the project view, same as the button. The main process only handles Escape
      // for fullscreen and popups, so the player-mode shortcut has to live here.
      document.addEventListener('keydown', this.handleKeyDown);

      // This component is re-mounted when the locale changes, but we only want to load
      // the initial project once.
      if (mountedOnce) {
        return;
      }
      mountedOnce = true;

      this.props.onLoadingStarted();
      (async () => {
        // Note that 0 is a valid ID and does mean there is a file open
        const id = await EditorPreload.getInitialFile();
        if (id === null) {
          this.props.onHasInitialProject(false, this.props.loadingState);
          this.props.onLoadingCompleted();
          return;
        }

        this.props.onHasInitialProject(true, this.props.loadingState);
        const {name, type, data} = await EditorPreload.getFile(id);

        await this.props.vm.loadProject(data);
        this.props.onLoadingCompleted();
        this.props.onLoadedProject(this.props.loadingState, true);

        const title = getDefaultProjectTitle(name);
        if (title) {
          this.setState({
            title
          });
        }

        if (type === 'file' && name.endsWith('.sb3')) {
          this.props.onSetFileHandle(new WrappedFileHandle(id, name));
        }
      })().catch(error => {
        console.error(error);

        this.props.onShowErrorModal(error);
        this.props.onLoadingCompleted();
        this.props.onLoadedProject(this.props.loadingState, false);
        this.props.onHasInitialProject(false, this.props.loadingState);
        this.props.onRequestNewProject();
      });
    }
    componentDidUpdate (prevProps, prevState) {
      if (this.props.projectChanged !== prevProps.projectChanged) {
        EditorPreload.setChanged(this.props.projectChanged);
      }

      if (this.state.title !== prevState.title) {
        document.title = this.state.title;
      }

      if (this.props.fileHandle !== prevProps.fileHandle) {
        if (this.props.fileHandle) {
          EditorPreload.openedFile(this.props.fileHandle.id);
        } else {
          EditorPreload.closedFile();
        }
      }

      if (this.props.reduxUsername !== prevProps.reduxUsername) {
        localStorage.setItem(USERNAME_KEY, this.props.reduxUsername);
      }

      if (this.props.isFullScreen !== prevProps.isFullScreen) {
        EditorPreload.setIsFullScreen(this.props.isFullScreen);
      }
    }
    componentWillUnmount () {
      document.removeEventListener('keydown', this.handleKeyDown);
    }
    handleUpdateProjectTitle (newTitle) {
      this.setState({
        title: newTitle
      });
    }
    handleSeeInside () {
      this.props.onSetIsPlayerOnly(false);
    }
    handleKeyDown (e) {
      if (e.key === 'Escape' && this.props.isPlayerOnly) {
        this.handleSeeInside();
      }
    }
    /**
     * Whether this window was actually built with the OS title bar hidden.
     *
     * Read from the main process rather than from the stored setting: the setting is only applied
     * when the window is constructed, and toggling it rebuilds the window, so the two always agree
     * here — but asking is the honest way to know what this window is actually showing, and it also
     * keeps the platform check (Windows/Linux only) in one place.
     *
     * @returns {boolean}
     */
    isMenuBarInTitleBarActive () {
      const state = EditorPreload.getTitlebarState();
      return !!(state && state.active && state.supported);
    }
    render() {
      const {
        locale,
        loadingState,
        projectChanged,
        fileHandle,
        isPlayerOnly,
        reduxUsername,
        onFetchedInitialProjectData,
        onHasInitialProject,
        onLoadedProject,
        onLoadingCompleted,
        onLoadingStarted,
        onRequestNewProject,
        onSetFileHandle,
        onSetIsPlayerOnly,
        onSetReduxUsername,
        onShowErrorModal,
        vm,
        ...props
      } = this.props;
      const aboutMenu = [
        {
          title: this.messages['in-app-about.desktop-settings'],
          onClick: handleClickDesktopSettings
        },
        {
          title: this.messages['in-app-about.privacy'],
          onClick: handleClickPrivacy
        },
        {
          title: this.messages['in-app-about.about'],
          onClick: handleClickAbout
        },
        {
          title: this.messages['in-app-about.source-code'],
          onClick: handleClickSourceCode
        },
      ];
      const gui = (
        <WrappedComponent
          projectTitle={this.state.title}
          onUpdateProjectTitle={this.handleUpdateProjectTitle}
          onClickAddonSettings={handleClickAddonSettings}
          onClickNewWindow={handleClickNewWindow}
          onClickPackager={handleClickPackager}
          onClickAbout={aboutMenu}
          onClickDesktopSettings={handleClickDesktopSettings}
          securityManager={securityManager}
          {...props}
        />
      );
      return (
        <React.Fragment>
          {isPlayerOnly ? (
            // scratch-gui's player-only branch (components/gui/gui.jsx) renders a bare
            // <StageWrapper> and relies on the website's outer layout
            // (playground/interface.css .container > .center { margin: auto }) to center it. The
            // desktop's #app is position:absolute at 100%x100% with no such wrapper, so without
            // this the stage sits in the top-left corner at its natural size while
            // .stage-header-wrapper (position:absolute; right:0) anchors to the far right of the
            // window. Reproduce that layout here, with the project-view menu bar on top.
            <div
              className={styles.projectViewContainer}
              // This menu bar is a sibling of the GUI, not inside it, and in player mode the GUI
              // renders a bare <StageWrapper> with no pageWrapper at all -- so nothing below this
              // point carries the dir attribute. scratch-gui picks direction by attribute, not by
              // the light/dark theme or the browser's locale: components/gui/gui.jsx puts
              // dir={isRtl ? 'rtl' : 'ltr'} on its own pageWrapper Box, and roughly 50 stylesheets
              // key off it (components/button/button.css [dir="ltr"] .icon { margin-right } being
              // the one that puts a gap between a button's icon and its label). Without it here the
              // See inside icon butts straight against the text.
              dir={this.props.isRtl ? 'rtl' : 'ltr'}
            >
              <ProjectViewMenuBarWithFileUpload
                messages={this.messages}
                onClickAbout={aboutMenu}
                // Must be passed to the HOC wrapper, not just to MenuBar: it is the HOC that calls
                // this.props.showOpenFilePicker (sb-file-uploader-hoc.jsx createFileObjects).
                // Without it the HOC falls back to its defaultProps, the Chromium File System
                // Access API, and hands a raw FileSystemFileHandle to onSetFileHandle. The desktop
                // then calls EditorPreload.openedFile(fileHandle.id) on it (desktop-hoc
                // componentDidUpdate), which throws on the missing id and aborts the commit -- the
                // project silently never loads. The outer HOC instance gets this prop as an ownProp
                // from src-renderer-webpack/editor/gui/gui.jsx.
                showOpenFilePicker={showOpenFilePicker}
              />
              <div className={styles.projectViewStageRow}>{gui}</div>
            </div>
          ) : gui}
          {this.isMenuBarInTitleBarActive() ? (
            <MergedTitleBar
              isFullScreen={this.props.isFullScreen}
              isRtl={this.props.isRtl}
            />
          ) : null}
        </React.Fragment>
      );
    }
  }

  DesktopComponent.propTypes = {
    locale: PropTypes.string.isRequired,
    loadingState: PropTypes.string.isRequired,
    projectChanged: PropTypes.bool.isRequired,
    fileHandle: PropTypes.shape({
      id: PropTypes.string.isRequired
    }),
    isFullScreen: PropTypes.bool.isRequired,
    isPlayerOnly: PropTypes.bool.isRequired,
    reduxUsername: PropTypes.string.isRequired,
    onFetchedInitialProjectData: PropTypes.func.isRequired,
    onHasInitialProject: PropTypes.func.isRequired,
    onLoadedProject: PropTypes.func.isRequired,
    onLoadingCompleted: PropTypes.func.isRequired,
    onLoadingStarted: PropTypes.func.isRequired,
    onRequestNewProject: PropTypes.func.isRequired,
    onSetFileHandle: PropTypes.func.isRequired,
    onSetIsPlayerOnly: PropTypes.func.isRequired,
    onSetReduxUsername: PropTypes.func.isRequired,
    onShowErrorModal: PropTypes.func.isRequired,
    vm: PropTypes.shape({
      loadProject: PropTypes.func.isRequired
    }).isRequired
  };

  const mapStateToProps = state => ({
    locale: state.locales.locale,
    isRtl: state.locales.isRtl,
    loadingState: state.scratchGui.projectState.loadingState,
    isFullScreen: state.scratchGui.mode.isFullScreen,
    isPlayerOnly: state.scratchGui.mode.isPlayerOnly,
    projectChanged: state.scratchGui.projectChanged,
    fileHandle: state.scratchGui.tw.fileHandle,
    reduxUsername: state.scratchGui.tw.username,
    vm: state.scratchGui.vm
  });

  const mapDispatchToProps = dispatch => ({
    onLoadingStarted: () => dispatch(openLoadingProject()),
    onLoadingCompleted: () => dispatch(closeLoadingProject()),
    onHasInitialProject: (hasInitialProject, loadingState) => {
      if (hasInitialProject) {
        return dispatch(requestProjectUpload(loadingState));
      }
      return dispatch(setProjectId(defaultProjectId));
    },
    onFetchedInitialProjectData: (projectData, loadingState) => dispatch(onFetchedProjectData(projectData, loadingState)),
    onLoadedProject: (loadingState, loadSuccess) => {
      return dispatch(onLoadedProject(loadingState, /* canSave */ false, loadSuccess));
    },
    onRequestNewProject: () => dispatch(requestNewProject(false)),
    onSetFileHandle: fileHandle => dispatch(setFileHandle(fileHandle)),
    onSetIsPlayerOnly: isPlayerOnly => dispatch(setPlayer(isPlayerOnly)),
    onSetReduxUsername: username => dispatch(setUsername(username)),
    onShowErrorModal: error => {
      dispatch(setProjectError(error));
      dispatch(openInvalidProjectModal());
    }
  });

  return connect(
    mapStateToProps,
    mapDispatchToProps
  )(DesktopComponent);
};

export default DesktopHOC;
