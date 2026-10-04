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
            <div className={styles.projectViewContainer}>
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
