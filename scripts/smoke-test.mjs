// Runs every actor locally with its smoke input and asserts it produced records.
// Usage: node scripts/smoke-test.mjs [actor-name ...]
import { readdirSync, existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const wanted = process.argv.slice(2);
const actors = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(root, d.name, '.actor/actor.json')))
    .map((d) => d.name)
    .filter((n) => wanted.length === 0 || wanted.includes(n));

const results = [];
for (const name of actors) {
    const dir = join(root, name);
    const smokeInput = join(dir, 'smoke-input.json');
    if (!existsSync(smokeInput)) { results.push({ name, ok: false, reason: 'missing smoke-input.json' }); continue; }
    const storage = join(dir, 'storage');
    rmSync(join(storage, 'datasets'), { recursive: true, force: true });
    mkdirSync(join(storage, 'key_value_stores/default'), { recursive: true });
    writeFileSync(join(storage, 'key_value_stores/default/INPUT.json'), readFileSync(smokeInput));
    if (!existsSync(join(dir, 'node_modules'))) spawnSync('npm', ['install', '--silent'], { cwd: dir, stdio: 'inherit' });
    const started = Date.now();
    const run = spawnSync('node', ['src/main.js'], { cwd: dir, env: { ...process.env, APIFY_LOCAL_STORAGE_DIR: storage, CRAWLEE_STORAGE_DIR: storage, APIFY_LOG_LEVEL: 'WARNING' }, encoding: 'utf8', timeout: 10 * 60 * 1000 });
    const dsDir = join(storage, 'datasets/default');
    const files = existsSync(dsDir) ? readdirSync(dsDir).filter((f) => f.endsWith('.json')) : [];
    // Count only records with real content; an empty object means a serialization bug.
    const count = files.filter((f) => Object.keys(JSON.parse(readFileSync(join(dsDir, f), 'utf8'))).length >= 3).length;
    const min = JSON.parse(readFileSync(smokeInput, 'utf8')).__minRecords ?? 1;
    const ok = run.status === 0 && count >= min;
    results.push({ name, ok, count, min, seconds: Math.round((Date.now() - started) / 1000), reason: ok ? '' : (run.status !== 0 ? `exit ${run.status}: ${(run.stderr || run.stdout).slice(-600)}` : `only ${count} records`) });
}
console.table(results.map(({ name, ok, count, seconds }) => ({ name, ok, count, seconds })));
for (const r of results.filter((r) => !r.ok)) console.error(`FAIL ${r.name}: ${r.reason}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
