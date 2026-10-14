/* rom-import.js — browser port of timecris/tools/setup_roms.py.
 *
 * Takes the user's timecris.zip (MAME set, World TS2 Ver.B), verifies every
 * chip by size and CRC32 (matched by MAME name, else by CRC like older sets
 * that name the program ts2ver-b.N), builds timecris_main.bin (the 4 MB
 * 68EC020 program: four ROM_LOAD32_BYTE chips interleaved), and caches the
 * lot in IndexedDB so the game loads instantly on later visits.
 *
 * ROM data stays in the player's browser; nothing is uploaded anywhere.
 * Depends on: fflate (unzip), chips.json (chip table generated from setup_roms.py).
 */
'use strict';

const ROM_DB = 'arcade-roms';
const ROM_STORE = 'files';

/* ---- CRC32 (same polynomial as zlib.crc32) ---- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return ((c ^ 0xFFFFFFFF) >>> 0).toString(16).padStart(8, '0');
}

/* ---- the chip table ---- */
async function loadManifest(url = 'chips.json') {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`can't load ${url}: HTTP ${r.status}`);
  return r.json();
}

/* top-level files only, lowercase names — zips carry timecrisa/ (Ver.A, not this game) in a folder */
function topLevel(zipBytes) {
  const out = new Map();
  const entries = fflate.unzipSync(zipBytes, {
    filter: f => !f.name.includes('/') && f.originalSize < 0x1000000,
  });
  for (const [name, data] of Object.entries(entries)) out.set(name.toLowerCase(), data);
  return out;
}

/**
 * Verify a user-supplied File/Blob (zip, or a single chip file) against the manifest.
 * Returns { ok, files: Map<mameName, Uint8Array>, mainBin: Uint8Array|null, report: [{name, status}] }.
 * Mirrors setup_roms.py: match by name first, then by CRC; every chip checked by size and CRC32.
 */
async function importRoms(fileList, manifest) {
  const found = new Map();
  for (const file of fileList) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (file.name.toLowerCase().endsWith('.zip')) {
      for (const [n, d] of topLevel(bytes)) if (!found.has(n)) found.set(n, d);
    } else {
      found.set(file.name.toLowerCase(), bytes);
    }
  }
  const byCrc = new Map();
  for (const d of found.values()) {
    const c = crc32(d);
    if (!byCrc.has(c)) byCrc.set(c, d);
  }

  const files = new Map();
  const report = [];
  let ok = true;
  for (const chip of manifest.chips) {
    let d = found.get(chip.name.toLowerCase());
    if (!d || crc32(d) !== chip.crc32) d = byCrc.get(chip.crc32);
    if (!d) {
      report.push({ name: chip.name, status: `missing (by name or CRC ${chip.crc32})` });
      ok = false;
    } else if (d.length !== chip.size) {
      report.push({ name: chip.name, status: `wrong size (${d.length}, expected ${chip.size})` });
      ok = false;
    } else {
      files.set(chip.name, d);
      report.push({ name: chip.name, status: 'ok' });
    }
  }
  for (const extra of manifest.extra) {
    const d = found.get(extra.name.toLowerCase());
    if (d && d.length === extra.size) {
      files.set(extra.name, d);
      report.push({ name: extra.name, status: 'ok (optional)' });
    }
  }

  let mainBin = null;
  if (ok) {
    mainBin = new Uint8Array(manifest.mainBin.size);
    for (const part of manifest.mainBin.interleave) {
      const src = files.get(part.name);
      for (let i = 0; i < src.length; i++) mainBin[part.byte + i * 4] = src[i];
    }
  }
  return { ok, files, mainBin, report };
}

/* ---- IndexedDB cache: key "timecris/<name>" -> Uint8Array ---- */
function openRomDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(ROM_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(ROM_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/* keys are stored EXACTLY as given (e.g. 'extracted/<chip>' or 'save/<file>'),
 * under the game's prefix; mainBin may be null when only updating saves */
async function saveRoms(game, files, mainBin, mainBinName) {
  const db = await openRomDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(ROM_STORE, 'readwrite');
    const st = tx.objectStore(ROM_STORE);
    for (const [name, data] of files) st.put(data, `${game}/${name}`);
    if (mainBin) st.put(mainBin, `${game}/${mainBinName}`);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function loadRoms(game) {
  const db = await openRomDb();
  const out = await new Promise((resolve, reject) => {
    const tx = db.transaction(ROM_STORE, 'readonly');
    const st = tx.objectStore(ROM_STORE);
    const files = new Map();
    const cur = st.openCursor();
    cur.onsuccess = () => {
      const c = cur.result;
      if (!c) return resolve(files);
      if (typeof c.key === 'string' && c.key.startsWith(`${game}/`)) files.set(c.key.slice(game.length + 1), c.value);
      c.continue();
    };
    cur.onerror = () => reject(cur.error);
  });
  db.close();
  return out;
}

async function clearRoms(game) {
  const files = await loadRoms(game);
  const db = await openRomDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(ROM_STORE, 'readwrite');
    const st = tx.objectStore(ROM_STORE);
    for (const name of files.keys()) st.delete(`${game}/${name}`);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/* a set is complete when every chip file and the built main program are cached */
async function romsReady(manifest) {
  const files = await loadRoms(manifest.game);
  if (!files.has(manifest.mainBin.name)) return false;
  return manifest.chips.every(c => {
    const d = files.get(`extracted/${c.name}`);
    return d && d.length === c.size;
  });
}
