import fs from 'fs';
import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
Config.setPixelFormat('yuv420p');
Config.setCodec('h264');
Config.setConcurrency(2);

const linuxBrowserPath =
  '/home/dev/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell';
if (process.platform === 'linux' && fs.existsSync(linuxBrowserPath)) {
  Config.setBrowserExecutable(linuxBrowserPath);
}
