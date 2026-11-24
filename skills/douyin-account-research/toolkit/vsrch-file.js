// vsrch-file.js — run video searches for every line in a UTF-8 keyword file.
// Avoids Windows PowerShell 5.1 GBK argument/env mangling entirely.
//   node vsrch-file.js keywords.txt
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] || join(HERE, 'keywords.txt');
const kws = readFileSync(file, 'utf8')
  .split(/\r?\n/)
  .map((s) => s.trim())
  .filter((s) => s && !s.startsWith('#'));

console.log(`keywords from ${file}: ${kws.length}`);
kws.forEach((k, i) => console.log(`  ${i + 1}. ${k}`));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const kw of kws) {
  console.log(`\n################ ${kw} ################`);
  await new Promise((resolve) => {
    const child = spawn(process.execPath, [join(HERE, 'click-search.js')], {
      env: { ...process.env, DSH_KW: kw },
      stdio: 'inherit',
    });
    child.on('exit', resolve);
  });
  await sleep(7000);
}
console.log('\nall searches complete');
