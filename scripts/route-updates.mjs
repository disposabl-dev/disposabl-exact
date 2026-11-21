#!/usr/bin/env bun
// Classify the pinned Exact deploy dry-run against current installed cohorts.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const platforms = ['android', 'ios'];
const nativeReason = /^(?:its binary predates these native sources: |[^;]+: (?:sources\.|surfaceCalls\.|gpuSurfaces\.|appleRasterIcons\.|executors\.|hatches\.|appleUses\.|androidUses\.|androidExtensions\.|androidPermissions\.|hermesBytecode\b|typescriptRuntime\b|javascriptGrants\b|grantCeiling \((?!unknown baked grants)))/;

function splitReasons(text) {
  const parts = []; let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') depth = Math.max(0, depth - 1);
    else if (text[i] === ';' && depth === 0) { parts.push(text.slice(start, i).trim()); start = i + 1; }
  }
  parts.push(text.slice(start).trim());
  return parts.filter(Boolean);
}

const generatedNoise = new Set(['host', 'minimumOS', 'app/.exact/shells/Cargo.toml', 'app/.exact/shells/apple/Cargo.toml', 'app/.exact/shells/android/Cargo.toml', 'exact/host/apple/Sources/ExactCore/GeneratedBatch.swift', 'exact/host/apple/Sources/ExactCore']);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
export function onlyOtherPlatformManifestChanged(before, after, platform) {
  const a = structuredClone(before), b = structuredClone(after);
  const other = platform === 'android' ? 'ios' : 'android';
  if (a.host) delete a.host[other];
  if (b.host) delete b.host[other];
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}
const generatedFiles = new Set(['.cargo/config.toml', '.stamp.json', 'Cargo.lock', 'Cargo.toml', 'rust-toolchain.toml', ...['android','apple','linux','web','windows'].flatMap(platform => [`${platform}/Cargo.toml`, `${platform}/build.rs`, `${platform}/src/lib.rs`, `${platform}/src/main.rs`])]);
export function generatedSnapshotOnly(changes) {
  return Array.isArray(changes) && changes.length > 0 && changes.every(change => {
    const prefix = 'app A  apps/apps/.exact/shells/';
    return typeof change === 'string' && change.startsWith(prefix) && generatedFiles.has(change.slice(prefix.length));
  });
}
export function route(table, bases, verified, expectedSha, safeGenerated = {}, allowGeneratedSnapshot = false) {
  if (!table || table.dryRun !== true || !Array.isArray(table.rows) || table.snapshot?.commit !== expectedSha || (table.snapshot?.dirty && !(allowGeneratedSnapshot && generatedSnapshotOnly(table.snapshot.changes)))) throw Error('Dry-run snapshot is missing, dirty, or differs from the requested commit');
  if (table.channel !== 'prod') throw Error('Unexpected deploy channel');
  const streams = table.rows.filter(r => r.kind === 'stream');
  for (const row of streams) {
    if (row.action === 'unavailable') throw Error(`Stream unavailable: ${row.platform ?? '?'} ${row.reason ?? ''}`);
    if (row.head && (!verified.has(row.compatibilityId) || row.head.unusable)) throw Error(`Invalid or unauthenticated head: ${row.compatibilityId}`);
  }
  const result = {};
  for (const platform of platforms) {
    const id = bases?.[platform]?.compatibilityId;
    if (!id) { result[platform] = { action: 'native', reason: 'No current installed base' }; continue; }
    const rows = streams.filter(r => r.platform === platform && r.compatibilityId === id);
    if (rows.length !== 1 || !rows[0].head || !verified.has(id)) throw Error(`Current ${platform} stream is missing or unauthenticated`);
    const row = rows[0];
    const binaries = table.rows.filter(r => r.kind === 'binary' && r.platform === platform && r.compatibilityId === id);
    if (binaries.length > 1) throw Error(`Multiple current ${platform} binary rows`);
    const pending = binaries[0]?.pendingInputs;
    if (pending !== undefined && (!Array.isArray(pending) || pending.some(item => typeof item !== 'string' || !item))) throw Error(`Malformed ${platform} pending native inputs`);
    const materialPending = pending?.filter(item => !(Array.isArray(safeGenerated[platform]) && safeGenerated[platform].includes(item) && generatedNoise.has(item))) ?? [];
    if (row.action === 'bundle' || row.action === 'current') {
      result[platform] = materialPending.length
        ? { action: 'native', updateAction: row.action, compatibilityId: id, pendingInputs: materialPending }
        : { action: row.action, compatibilityId: id };
      continue;
    }
    if (row.action !== 'binary') throw Error(`Unexpected ${platform} action ${row.action}`);
    const reasons = splitReasons(row.reason ?? '').filter(x => !/^a new APK: EXACT_UPDATE_TRUST=production bun exact\.mjs android --release \(--bundle for the store\)$/.test(x));
    if (!reasons.length || reasons.some(reason => !nativeReason.test(reason))) throw Error(`Cannot prove ${platform} needs a native build: ${row.reason ?? 'missing reason'}`);
    result[platform] = { action: 'native', compatibilityId: id, reason: row.reason };
  }
  return result;
}

async function main() {
  const [tableFile, basesFile, originDir, manifestFile, sha] = process.argv.slice(2);
  if (!tableFile || !basesFile || !originDir || !manifestFile || !/^[0-9a-f]{40}$/.test(sha ?? '') || !process.env.EXACT) throw Error('Usage: EXACT=<pinned checkout> bun route-updates.mjs <dry-run.json> <bases.json> <origin-dir> <app.json> <commit-sha>');
  const table = JSON.parse(await readFile(tableFile, 'utf8'));
  const bases = JSON.parse(await readFile(basesFile, 'utf8'));
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  if (!Object.keys(manifest.deploy?.signing?.keys ?? {}).length) throw Error('No trusted signing keys configured');
  const { inspectHead } = await import(pathToFileURL(resolve(process.env.EXACT, 'scripts/deploy-heads.mjs')).href);
  const app = { id: manifest.app?.id ?? manifest.id, displayName: manifest.app?.name ?? manifest.name, manifest };
  const verified = new Set();
  for (const row of table.rows ?? []) {
    if (row.kind !== 'stream' || !row.head) continue;
    if (!/^[0-9a-f]{32,64}$/.test(row.compatibilityId ?? '') || row.channel !== 'prod') throw Error('Invalid stream identity');
    const bytes = await readFile(join(originDir, '.exact', row.channel, row.compatibilityId, 'exact.json'));
    if (createHash('sha256').update(bytes).digest('hex') !== row.head.sha256) throw Error(`Head changed since dry-run: ${row.compatibilityId}`);
    const admission = inspectHead({ bytes }, app, { channel: row.channel, compatibilityId: row.compatibilityId });
    if (!admission.usable || !admission.authenticated) throw Error(`Invalid head ${row.compatibilityId}: ${admission.problem ?? 'not authenticated'}`);
    verified.add(row.compatibilityId);
  }
  const safeGenerated = {};
  for (const platform of platforms) {
    const baseSha = bases?.[platform]?.sourceSha;
    if (!baseSha) continue;
    if (!/^[0-9a-f]{40}$/.test(baseSha) || !process.env.GITHUB_WORKSPACE) throw Error(`Invalid ${platform} base source SHA`);
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', baseSha, sha], { cwd: process.env.GITHUB_WORKSPACE, stdio: 'ignore' });
      const changed = execFileSync('git', ['diff', '--name-only', '-z', baseSha, sha, '--', 'apps/apps'], { cwd: process.env.GITHUB_WORKSPACE }).toString().split('\0').filter(Boolean);
      const baseline = bases[platform].baselinePendingInputs;
      if (baseline !== undefined && (!Array.isArray(baseline) || baseline.some(item => typeof item !== 'string'))) throw Error(`Invalid ${platform} baseline`);
      const safeFiles = changed.every(path => ['apps/apps/app.contract', 'apps/apps/app.ts', 'apps/apps/app.json'].includes(path));
      let safeManifest = true;
      if (changed.includes('apps/apps/app.json')) {
        const manifestAt = revision => JSON.parse(execFileSync('git', ['show', `${revision}:apps/apps/app.json`], { cwd: process.env.GITHUB_WORKSPACE, encoding: 'utf8' }));
        safeManifest = onlyOtherPlatformManifestChanged(manifestAt(baseSha), manifestAt(sha), platform);
      }
      if (safeFiles && safeManifest) safeGenerated[platform] = baseline ?? [];
    } catch { throw Error(`Cannot prove ${platform} source history`); }
  }
  let allowGeneratedSnapshot = false;
  if (table.snapshot?.dirty) {
    if (!process.env.GITHUB_WORKSPACE || !generatedSnapshotOnly(table.snapshot.changes)) throw Error('Snapshot contains unexpected uncommitted files');
    try { execFileSync('git', ['diff', '--quiet', 'HEAD', '--'], {cwd: process.env.GITHUB_WORKSPACE, stdio:'ignore'}); }
    catch { throw Error('Tracked source files are modified'); }
    allowGeneratedSnapshot = true;
  }
  const result = route(table, bases, verified, sha, safeGenerated, allowGeneratedSnapshot);
  console.log(JSON.stringify(result));
  if (process.env.GITHUB_OUTPUT) {
    const { appendFile } = await import('node:fs/promises');
    await appendFile(process.env.GITHUB_OUTPUT, platforms.map(p => `${p}=${result[p].action === 'native'}`).join('\n') + '\n');
  }
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
