# HyperMimic 桌面版

[English](README.md) | 简体中文

HyperMimic 桌面应用程序。

如需下载，请访问：https://clyain.netlify.app/hm/desktop

基于 GPLv3.0 许可。详见 LICENSE 文件。

本仓库的部分内容基于 [TurboWarp/desktop](https://github.com/TurboWarp/desktop) 和 [LLK/scratch-desktop](https://github.com/LLK/scratch-desktop)。

## 网站

网站源代码位于 `Clyain/clyain.netlify.app` 仓库的 `hm/desktop` 文件夹中。

## 开发

我们使用子模块，因此请使用以下命令克隆：

```bash
git clone --recursive https://github.com/Hyper-Mimic/desktop hypermimic-desktop
```

或在克隆后执行：

```bash
git submodule init
git submodule update
```

使用以下命令安装依赖：

```bash
yarn install --frozen-lockfile
```

然后获取额外的库、打包器和扩展文件：

```bash
yarn run fetch
```

每次从 GitHub 拉取更新后，请重复上述三组命令。

由于自定义扩展存在所带来的安全要求，我们的桌面应用程序比 Scratch 的复杂得多。

- **src-main** 运行在 Electron 的主进程中。没有构建步骤；此代码按原样包含。`src-main/entrypoint.js` 是整个应用程序的入口点。
- **src-renderer-webpack** 运行在 Electron 的渲染器进程中，用于使编辑器正常工作。由 webpack 构建为 **dist-renderer-webpack**。
- **src-renderer** 也运行在 Electron 的渲染器进程中，但不使用 webpack。用于隐私政策窗口等场景。
- **src-preload** 作为预加载脚本运行在 Electron 的渲染器进程中。它们导出粘合函数，以允许渲染器和主进程以可控的方式进行通信。
- **dist-library-files** 和 **dist-extensions** 包含由 `yarn run fetch` 管理的额外静态资源。

要为开发版本构建 src-renderer-webpack 中的 webpack 部分，请运行：

```bash
yarn run webpack:compile
```

您也可以运行以下命令，以便源文件更改时立即触发重新构建：

```bash
yarn run webpack:watch
```

完成所有编译和获取后，即可打包为 Electron 应用程序。要启动开发版 Electron 实例，请运行：

```bash
yarn run electron:start
```

在 Linux 中，应用程序图标在开发版本中不会显示，但在打包版本中会正常显示。

我们发现，并排打开两个终端，一个运行 `yarn run webpack:watch`，另一个运行 `yarn run electron:start`，开发体验相当不错。您可以使用 Ctrl+R 或 Cmd+R 刷新窗口以应用渲染器文件的更改，并手动重启应用程序以应用主进程文件的更改。

## Linux 沙箱辅助程序错误

在某些 Linux 发行版上，Electron 会崩溃并显示以下消息：`The SUID sandbox helper binary was found, but is not configured correctly. Rather than run without sandboxing I'm aborting now. You need to make sure that /home/.../hypermimic-desktop/node_modules/electron/dist/chrome-sandbox is owned by root and has mode 4755.`。我们已注意到此问题在 Debian 10 及更早版本以及 Ubuntu 24.04 及更高版本上出现。

在开发过程中，您可以运行以下命令来启用非特权用户命名空间（直到重启前有效）：

```bash
# 启用非特权用户命名空间。
sudo sysctl -w kernel.unprivileged_userns_clone=1

# 阻止 AppArmor 默认禁止创建非特权用户命名空间。
# 如果您的发行版不使用 AppArmor，则可以忽略该错误。
sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
```

有一些方法可以使此设置永久生效，但我们认为您不应仅仅为了开发此应用程序而更改永久内核配置。此错误在最终的 .deb 包、Flathub 或 Snap Store 版本中不会发生。

## 最终生产就绪构建

应用程序的开发版本会比最终发布版本更大且更慢。

使用以下命令构建优化版的 webpack 部分：

```bash
yarn run webpack:prod
```

然后，要打包最终的 Electron 二进制文件，请使用我们的构建脚本 `release-automation/build.mjs`（参见 [release-automation/README.md](release-automation/README.md)）或 [electron-builder CLI](https://www.electron.build/cli)。最终构建产物保存在 `dist` 文件夹中。以下是一些直接使用 electron-builder CLI 的示例：

```bash
# 您也可以使用 electron-builder 的 CLI 进行手动构建，例如：
# Windows 安装程序
npx electron-builder --windows nsis --x64
# macOS DMG
npx electron-builder --mac dmg --universal
# Linux Debian
npx electron-builder --linux deb
```

通常，您只能在相应的操作系统上为该系统打包。

## 代码签名政策

HyperMimic 桌面版延续了 TurboWarp 桌面版的免费代码签名。

TurboWarp 桌面版使用由 [SignPath.io](https://about.signpath.io/) 提供的免费代码签名，证书由 [SignPath Foundation](https://signpath.org/) 颁发。

- 审批人：
  - [GarboMuffin](https://github.com/GarboMuffin)
- 隐私政策：https://clyain.netlify.app/hm/desktop/privacy.html

## 高级自定义

HyperMimic 桌面版允许您配置自定义 JS 和 CSS，而无需重新构建应用程序。

通过以下列表查找 HyperMimic 桌面版的数据路径，或点击右上角的“?”，然后选择“桌面设置”，再点击“打开用户数据”，并打开高亮显示的文件夹；也可参考以下列表：

- Windows（Microsoft Store 版本除外）：`%APPDATA%/hypermimic-desktop`
- Microsoft Store 版本：打开 `%LOCALAPPDATA%/Packages`，找到包含 `HyperMimicDesktop` 字样的文件夹，然后打开 `LocalCache/Roaming/hypermimic-desktop`
- macOS（Mac App Store 版本除外）：`~/Library/Application Support/hypermimic-desktop`
- Mac App Store 版本：`~/Library/Containers/org.hypermimic.desktop/Data/Library/Application Support/hypermimic-desktop`（注意：`org.hypermimic.desktop` 部分在 Finder 中可能显示为 `HyperMimic`）
- Linux（Flatpak 和 Snap 版本除外）：`~/.config/hypermimic-desktop`
- Linux（Flatpak）：`~/.var/app/org.hypermimic.HyperMimic/config/hypermimic-desktop`
- Linux（Snap）：`~/snap/hypermimic-desktop/current/.config/hypermimic-desktop`

在此文件夹中创建 `userscript.js` 文件以配置自定义 JS。创建 `userstyle.css` 文件以配置自定义 CSS。完全重启 HyperMimic 桌面版（包括所有窗口）以使更改生效。

## 卸载

参见 https://clyain.netlify.app/hm/desktop/uninstall