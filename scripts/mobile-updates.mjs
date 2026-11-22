// GitHub Actions runs this from the Exact app directory.
import { execFileSync } from 'node:child_process';
import { createHash, createPrivateKey, createPublicKey, hkdfSync, sign } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [command, platform] = process.argv.slice(2);
if (!['configure', 'deliver', 'seed'].includes(command) || !['ios', 'android'].includes(platform))
  throw Error('expected configure|deliver|seed ios|android');

const env = process.env;
const { EXACT, EXACT_REF, EXACT_PR_NUMBER, GITHUB_REPOSITORY, GITHUB_SHA, CONVEX_ORIGIN } = env;
if (!EXACT || !/^[a-f0-9]{40}$/.test(EXACT_REF) || !GITHUB_REPOSITORY ||
    !/^[a-f0-9]{40}$/.test(GITHUB_SHA) || !/^wss:\/\/[^/]+$/.test(CONVEX_ORIGIN))
  throw Error('Missing pinned SDK, commit, repository or Convex deployment origin');

const manifest = JSON.parse(readFileSync('app.json', 'utf8'));
if (!/^\d+(?:\.\d+){1,2}$/.test(manifest.version)) throw Error('Set a numeric native version in app.json');
env.EXACT_VERSION = manifest.version;
const secret = Buffer.from(env.EXACT_UPDATE_SEED || '', 'base64');
delete env.EXACT_UPDATE_SEED;
if (secret.length !== 32) throw Error('Set EXACT_UPDATE_SEED to a base64-encoded 32-byte key for this environment');

// A different native source tree needs its own baseline even when Exact computes
// the same runtime ABI. Bind it to the signed key so old installs keep their feed.
const iconPaths = new Set(manifest.icons?.map(icon => icon.src));
const nativeFiles = execFileSync('git', ['ls-tree', '-rz', 'HEAD', '--', '.']).toString().split('\0')
  .filter(row => {
    if (!row) return false;
    const path = row.split('\t')[1];
    if (iconPaths.has(path)) return true;
    return !/^(?:assets|deck)\//.test(path) && !/\.(?:ts|contract|md)$/.test(path);
  });
const generation = createHash('sha256').update(JSON.stringify([
  GITHUB_REPOSITORY, EXACT_PR_NUMBER || 'production', platform, CONVEX_ORIGIN,
  EXACT_REF, manifest.version, nativeFiles,
])).digest();
const keyBytes = Buffer.from(hkdfSync('sha256', secret, generation, 'exact-updates-v1', 32));
secret.fill(0);
const privateKey = createPrivateKey({
  key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), keyBytes]),
  type: 'pkcs8', format: 'der',
});
keyBytes.fill(0);
const publicKey = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
manifest.deploy = { ...manifest.deploy,
  store: { ...manifest.deploy.store, [platform]: 'A' },
  channels: { prod: 'appdrop' },
  signing: { key: 'mobile', keys: { mobile: publicKey } },
};
writeFileSync('app.json', JSON.stringify(manifest, null, 2) + '\n');
if (command === 'configure') {
  appendFileSync(env.GITHUB_ENV, 'EXACT_VERSION=' + manifest.version + '\n');
  process.exit(0);
}

const [{ resolveApp, readBuilds, classifyArtifacts }, { openOrigin, channelOrigin },
  { streams, streamCandidates, publishStream, defaultRelease }, { canonicalBytes }] = await Promise.all(
  ['app', 'origin', 'publisher', 'deploy-signing'].map(name => import(resolve(EXACT, 'scripts', name + '.mjs'))));
const app = resolveApp(process.cwd());
const signer = {
  keyId: 'mobile', publicKey,
  signBytes: bytes => sign(null, bytes, privateKey),
  sign: head => ({ keyId: 'mobile', ed25519: sign(null, canonicalBytes(head), privateKey).toString('base64') }),
};
const origin = openOrigin(channelOrigin(app.manifest, 'prod'));
origin.useSigner(signer);
const names = await origin.list('.exact/prod');
if (!Array.isArray(names)) throw Error('AppDrop returned an invalid stream listing');
function native(reason) {
  if (command === 'seed') throw Error('Built binary cannot establish its update stream: ' + reason);
  appendFileSync(env.GITHUB_OUTPUT, platform + '_native=true\n');
  console.log(platform + ' needs a binary: ' + reason);
}
if (command === 'deliver' && !names.length) {
  native('first build of this native version');
  process.exit(0);
}
const builds = command === 'seed' ? readBuilds(app).filter(b => b.trust === 'production' && b.compat.inputs.platform === platform) : [];
if (command === 'seed' && !builds.length) throw Error('Missing production build receipt for ' + platform);
const found = await streams(origin, app, 'prod', { platforms: [platform], builds });
const selected = command === 'seed' ? found.filter(s => builds.some(b => b.compat.id === s.stream.compatibilityId)) : found;
const publishTools = env.EXACT_PUBLISH_TOOLS;
const tools = publishTools ? { graph: resolve(publishTools, 'exact-bake'), typescript: resolve(publishTools, 'exact-js-bake') } : null;
// The Linux publisher uses the same pinned native inputs as the builder. The SDK
// compares evidence against workspace paths; reading that evidence needs no Cargo.
const workspace = app.generated ? resolve(app.dir, '.exact/shells') : app.workspace;
const candidateApp = Object.create(app, { workspace: { value: workspace } });
const candidates = await streamCandidates(candidateApp, origin, selected, { ...env, EXACT_UPDATE_TRUST: 'production' }, { tools });
const compatible = [];
for (const update of candidates) {
  if (update.reason) {
    if (update.needsBinary) continue;
    throw Error(update.reason);
  }
  if (update.note) throw Error(update.note);
  if (update.superseded?.length) continue;
  const checked = classifyArtifacts(update.build, update.row.receipt, { id: signer.keyId, public: publicKey });
  if (!checked.bundle) {
    if (checked.missing.every(reason => checked.needsBinary?.includes(reason))) continue;
    throw Error(checked.missing.join('; '));
  }
  // SDK-generated shell paths differ between the Linux publisher and iOS builder.
  // The signing scope already binds the actual SDK and every tracked native app input.
  const changed = update.build.pendingInputs.filter(path =>
    !(app.generated && /^(?:app\/\.exact\/shells|workspace)\/(?:Cargo\.(?:lock|toml)|rust-toolchain\.toml|(?:android|apple|web|linux|windows)\/(?:Cargo\.toml|build\.rs|src\/(?:main|lib)\.rs))$/.test(path)) &&
    !['exact/host/apple/Sources/ExactCore/GeneratedBatch.swift', 'exact/host/apple/Sources/ExactCore'].includes(path));
  if (changed.length) {
    console.log('Changed native inputs:', changed.join(', '));
    continue;
  }
  compatible.push(update);
}
if (!compatible.length) {
  native('the installed runtime cannot apply this change');
} else {
  for (const update of compatible) {
    const result = await publishStream({ origin, ...update, app, signer,
      release: defaultRelease(GITHUB_SHA),
      snapshot: { id: GITHUB_SHA, commit: GITHUB_SHA, dirty: false }, opts: {}, log: () => {} });
    console.log(platform, result.action, 'sequence', result.seq, origin.describe(), update.row.compatibilityId);
  }
  if (command === 'deliver') appendFileSync(env.GITHUB_OUTPUT, platform + '_native=false\n');
}
