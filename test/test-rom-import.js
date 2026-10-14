// Node test for web/timecrisis/rom-import.js against the real timecrisis.zip.
// Shims the browser bits (fflate global, File), then compares the built
// main.bin byte-for-byte with the one setup_roms.py produced.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WEB = require('path').join(__dirname, '..');
global.fflate = require(path.join(WEB, 'lib/fflate.js'));

// load rom-import.js into this scope (it's a plain script, not a module)
const src = fs.readFileSync(path.join(WEB, 'timecrisis/rom-import.js'), 'utf8');
(0, eval)(src.replace("'use strict';", ''));  // indirect eval -> global scope, like a <script> tag

const manifest = JSON.parse(fs.readFileSync(path.join(WEB, 'timecrisis/chips.json'), 'utf8'));

class FakeFile {
  constructor(p) { this.name = path.basename(p); this._p = p; }
  async arrayBuffer() { const b = fs.readFileSync(this._p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }
}

(async () => {
  const zip = new FakeFile(process.env.ROM_ZIP);
  const t0 = Date.now();
  const res = await importRoms([zip], manifest);
  console.log(`import: ok=${res.ok} in ${Date.now() - t0}ms, ${res.files.size} files`);
  for (const r of res.report) if (r.status !== 'ok' && r.status !== 'ok (optional)') console.log('  !!', r.name, r.status);
  if (!res.ok) process.exit(1);

  const ref = fs.readFileSync(process.env.MAIN_BIN);
  const mine = Buffer.from(res.mainBin);
  const same = ref.equals(mine);
  console.log(`main.bin: ${mine.length} bytes, matches setup_roms.py output: ${same}`);
  console.log(`  sha256 ref  ${crypto.createHash('sha256').update(ref).digest('hex').slice(0, 16)}`);
  console.log(`  sha256 mine ${crypto.createHash('sha256').update(mine).digest('hex').slice(0, 16)}`);
  process.exit(same ? 0 : 1);
})();
