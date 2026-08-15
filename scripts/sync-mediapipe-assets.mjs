/**
 * Copies the MediaPipe vision wasm runtime out of node_modules and fetches the
 * Face Landmarker model into public/, so the app loads everything from its own
 * origin. No CDN at runtime, and it works offline after the first sync.
 *
 * Runs automatically via the `predev` / `prebuild` npm scripts.
 */
import { mkdir, copyFile, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wasmSrc = join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const wasmDest = join(root, 'public/mediapipe/wasm');
const modelDest = join(root, 'public/mediapipe/face_landmarker.task');

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

async function syncWasm() {
  if (!existsSync(wasmSrc)) {
    throw new Error(`MediaPipe wasm not found at ${wasmSrc} — run \`npm install\` first.`);
  }
  await mkdir(wasmDest, { recursive: true });
  const files = await readdir(wasmSrc);
  let copied = 0;
  for (const file of files) {
    const from = join(wasmSrc, file);
    const to = join(wasmDest, file);
    // Skip if already present at the same size; these files are ~11MB each.
    if (existsSync(to)) {
      const [a, b] = await Promise.all([stat(from), stat(to)]);
      if (a.size === b.size) continue;
    }
    await copyFile(from, to);
    copied++;
  }
  console.log(`[mediapipe] wasm: ${files.length} files present (${copied} copied)`);
}

async function syncModel() {
  if (existsSync(modelDest)) {
    const { size } = await stat(modelDest);
    console.log(`[mediapipe] model: already present (${(size / 1e6).toFixed(2)} MB)`);
    return;
  }
  console.log('[mediapipe] model: downloading face_landmarker.task ...');
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`Model download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(modelDest), { recursive: true });
  await writeFile(modelDest, buf);
  console.log(`[mediapipe] model: downloaded (${(buf.length / 1e6).toFixed(2)} MB)`);
}

await syncWasm();
await syncModel();
