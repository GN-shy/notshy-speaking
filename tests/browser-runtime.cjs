const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
let playwright;
try{playwright=require('playwright');}
catch{
 const bundled=process.env.NOTSHY_PLAYWRIGHT_PATH||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
 playwright=require(bundled);
}
const candidates=[process.env.NOTSHY_BROWSER_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
module.exports={chromium:playwright.chromium,browserExecutable:candidates.find(file=>fs.existsSync(file))};
