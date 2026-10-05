// Very bad things happen in here!

const fsPromises = require('fs/promises');
const pathUtil = require('path');
const packageJSON = require('../package.json');

// Override https://github.com/electron-userland/electron-builder/blob/14942b70a5da79a5e36e330f64de66ec501b4ac6/packages/app-builder-lib/src/targets/LinuxTargetHelper.ts#L28-L53
// The upstream Linux file association support is not great so we'll just replace it with the one
// that we wrote by hand until we can send an upstream-ready PR.
const LinuxTargetHelper = require('app-builder-lib/out/targets/LinuxTargetHelper.js').LinuxTargetHelper;
LinuxTargetHelper.prototype.computeMimeTypeFiles = async function (...args) {
    const tempFile = await this.packager.getTempFile('.xml');
    console.log(`${packageJSON.name}: LinuxTargetHelper.prototype.computeMimeTypeFiles has been patched. mime.xml to be saved to ${tempFile}`);

    const xmlPath = pathUtil.join(__dirname, '../linux-files/org.hypermimic.HyperMimic.mime.xml');
    const rawXml = await fsPromises.readFile(xmlPath, 'utf-8');
    // The generic-icon name has to match the icon electron-builder actually installs, which is
    // named after linux.executableName (FpmTarget writes /usr/share/icons/hicolor/<size>x<size>/apps/<executableName>.png).
    // The id in the file is the rDNS app id used by Flatpak, so it never matches on its own.
    const iconName = packageJSON.build?.linux?.executableName || packageJSON.name;
    const newXml = rawXml.replace(/org\.hypermimic\.HyperMimic/g, iconName);

    // Roughly equivalent to fs-extra's outputFile (creates parent directories as needed)
    await fsPromises.mkdir(pathUtil.dirname(tempFile), {
        recursive: true
    });
    await fsPromises.writeFile(tempFile, newXml);

    return tempFile;
};
