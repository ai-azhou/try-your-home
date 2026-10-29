// Set CHROME_PATH to the Chrome/Chromium executable on this machine.
export const chromePath = process.env.CHROME_PATH
if (!chromePath) throw new Error('请设置 CHROME_PATH 为本机 Chrome / Chromium 可执行文件路径。')
