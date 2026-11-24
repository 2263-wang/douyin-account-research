// vsrch-batch.js — run several video searches with humane pacing.
// Keywords go through DSH_KW (env var) to avoid PowerShell's GBK argument mangling.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const KWS = (process.env.DSH_KWS || '').split('|').map((s) => s.trim()).filter(Boolean);
if (!KWS.length) { console.error('set DSH_KWS="kw1|kw2|..."'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const kw of KWS) {
  console.log(`\n########## keyword: ${kw} ##########`);
  await new Promise((resolve) => {
    const child = spawn(process.execPath, [join(HERE, 'vsrch.js')], {
      env: { ...process.env, DSH_KW: kw },
      stdio: 'inherit',
    });
    child.on('exit', resolve);
  });
  await sleep(6000); // gentle pacing
}
console.log('\nall searches done');
