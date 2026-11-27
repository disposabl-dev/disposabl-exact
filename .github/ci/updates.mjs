// Run from apps/apps on the same runner that will build and seed the native package.
import { execFileSync } from 'node:child_process';
import { createHash, createPrivateKey, createPublicKey, hkdfSync, sign } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const keyId = 'ci';
const channelPattern = /^base-(android|ios|macos)-([1-9][0-9]{0,8})$/;
const sha256 = data => createHash('sha256').update(data).digest('hex');

// Push carries static assets forward. Keep those files (including app icons),
// build hooks, dependencies and native sources in the native signing scope.
const docs = path => /^(?:AGENTS|CLAUDE|README)\.md$/i.test(path);
const content = path => /^(?:[^/]+\.(?:ts|contract)|strings\/[^/]+\.json)$/.test(path);

export function appInputs(env) {
  const rows = execFileSync('git', ['ls-tree', '-rz', 'HEAD', '--', '.'], { env, encoding: 'utf8' })
    .split('\0').filter(Boolean);
  const path = row => row.slice(row.indexOf('\t') + 1);
  const sources = rows.filter(row => !docs(path(row)));
  return {
    native: sources.filter(row => !content(path(row))),
    fingerprint: sha256(JSON.stringify(sources)),
  };
}

export function updateSigner(seed, scope, canonicalBytes) {
  const secret = Buffer.from(seed ?? '', 'base64');
  if (secret.length !== 32 || secret.toString('base64') !== seed) {
    secret.fill(0);
    throw Error('Set EXACT_UPDATE_SEED to a base64-encoded 32-byte key');
  }
  const bytes = Buffer.from(hkdfSync('sha256', secret, JSON.stringify(scope), 'exact-ci-updates-v1', 32));
  secret.fill(0);
  const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), bytes]);
  const privateKey = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  bytes.fill(0);
  der.fill(0);
  return {
    keyId,
    publicKey: createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64'),
    signBytes: message => sign(null, message, privateKey),
    sign: head => ({ keyId, ed25519: sign(null, canonicalBytes(head), privateKey).toString('base64') }),
  };
}

export function latestChannel(names, platform) {
  if (!Array.isArray(names) || names.some(name => typeof name !== 'string' ||
    (name !== 'blobs' && !channelPattern.test(name)))) {
    throw Error('Unexpected listing in the dedicated CI update origin');
  }
  return Math.max(0, ...names.map(name => channelPattern.exec(name)).filter(match => match?.[1] === platform).map(match => Number(match[2])));
}

export async function deliver({ origin, sdk, app, platform, channel, signer, env, fingerprint, seed }) {
  const builds = seed ? sdk.readBuilds(app, env).filter(build =>
    build.trust === 'production' && build.compat.inputs.platform === platform &&
    build.compat.inputs.keys?.[keyId] === signer.publicKey && build.compat.inputs.store?.L === 'A') : [];
  if (seed && builds.length !== 1) throw Error('Expected exactly one matching production build receipt');

  let found;
  try {
    found = await sdk.streams(origin, app, channel, { platforms: [platform], builds });
  } catch (error) {
    if (!String(error.message).includes('the head is missing with authenticated release history')) throw error;
    if (!seed) return 'retry';
    found = await sdk.streams(origin, app, channel, { deploying: true, platforms: [platform], builds });
  }
  if (found.length !== 1 || found[0].platform !== platform ||
      found[0].cohort.compat.inputs.keys?.[keyId] !== signer.publicKey ||
      found[0].cohort.compat.inputs.store?.L !== 'A' ||
      (seed && (found[0].head || found[0].stream.compatibilityId !== builds[0].compat.id)) ||
      (!seed && !found[0].head)) {
    throw Error('Expected one authenticated CI stream or the exact new production receipt');
  }

  if (!found[0].cohort.binaryInputs) throw Error('Update stream lacks signed native input evidence');
  if (!seed && found[0].head.release?.endsWith(`-src-${fingerprint}`)) {
    await sdk.readBinaryInputFile(origin, found[0].cohort);
    return 'current';
  }

  // Materialize the same generated native workspace used by the build before
  // comparing inputs. Pass a plain view to avoid invoking unrelated getters.
  const candidateApp = Object.create(app, {
    dir: { value: app.dir, enumerable: true },
    workspace: { value: app.workspace, enumerable: true },
  });
  mkdirSync(app.target, { recursive: true });
  const [candidate] = await sdk.streamCandidates(candidateApp, origin, found, env);
  if (candidate.note) throw Error(candidate.note);
  if (candidate.reason && !candidate.needsBinary) throw Error(candidate.reason);
  let incompatible = candidate.needsBinary;
  if (!candidate.reason) {
    const checked = sdk.classifyArtifacts(candidate.build, candidate.row.receipt, { id: keyId, public: signer.publicKey });
    if (!checked.bundle && (!checked.missing.length || checked.missing.some(reason => !checked.needsBinary?.includes(reason)))) {
      throw Error(checked.missing.join('; ') || 'Candidate lacks an admissible bundle');
    }
    incompatible = !checked.bundle || candidate.build.pendingInputs.length > 0;
  }
  if (incompatible) {
    if (seed) throw Error('New production binary rejected its seed bundle: ' +
      (candidate.reason ?? candidate.build.pendingInputs.join(', ')));
    return 'native';
  }
  const result = await sdk.publishStream({
    origin, ...candidate, app, signer,
    release: `${sdk.defaultRelease(env.GITHUB_SHA)}-src-${fingerprint}`,
    snapshot: { id: env.GITHUB_SHA, commit: env.GITHUB_SHA, dirty: false },
    opts: {}, log: console.log,
  });
  if (!['current', 'published'].includes(result.action)) throw Error('Unexpected publisher result');
  console.log(platform, result.action, 'sequence', result.seq);
  return result.action;
}

async function main() {
  const [phase, platform, ...extra] = process.argv.slice(2);
  if (!['plan', 'seed'].includes(phase) || !['android', 'ios', 'macos'].includes(platform) || extra.length) {
    throw Error('Expected plan|seed android|ios|macos');
  }
  const seed = process.env.EXACT_UPDATE_SEED;
  delete process.env.EXACT_UPDATE_SEED;
  const env = process.env;
  const { EXACT, EXACT_REF, CONVEX_ORIGIN, CONVEX_SITE_ORIGIN, GITHUB_REPOSITORY, GITHUB_SHA } = env;
  if (!EXACT || !/^[a-f0-9]{40}$/.test(EXACT_REF) || !/^[a-f0-9]{40}$/.test(GITHUB_SHA) ||
      !/^[\w.-]+\/[\w.-]+$/.test(GITHUB_REPOSITORY) || !/^wss:\/\/[a-z0-9.-]+$/.test(CONVEX_ORIGIN) ||
      !/^https:\/\/[a-z0-9.-]+$/.test(CONVEX_SITE_ORIGIN)) throw Error('Missing pinned SDK, commit, repository or Convex origins');
  if (execFileSync('git', ['rev-parse', 'HEAD'], { env, encoding: 'utf8' }).trim() !== GITHUB_SHA) {
    throw Error('Update source does not match GITHUB_SHA');
  }
  const manifest = JSON.parse(readFileSync('app.json', 'utf8'));
  if (!/^\d+(?:\.\d+){1,2}$/.test(manifest.version)) throw Error('Set a numeric version in app.json');
  const inputs = appInputs(env);
  const [appApi, publisher, { openOrigin, appdropOrigin }, { canonicalBytes }] = await Promise.all(
    ['app', 'publisher', 'origin', 'deploy-signing'].map(name => import(resolve(EXACT, 'scripts', name + '.mjs'))));
  const signer = updateSigner(seed, [
    GITHUB_REPOSITORY, platform, EXACT_REF, CONVEX_ORIGIN, CONVEX_SITE_ORIGIN,
    env.EXACT_ANDROID_SKIP_R8 ?? 'true', inputs.native,
  ], canonicalBytes);
  manifest.deploy = { ...manifest.deploy, store: { ...manifest.deploy?.store, [platform]: 'A' },
    signing: { key: keyId, keys: { [keyId]: signer.publicKey } } };
  const origin = openOrigin(appdropOrigin(manifest)).useSigner(signer);
  const configure = channel => {
    manifest.deploy.channel = channel;
    manifest.deploy.channels = { [channel]: 'appdrop' };
    return JSON.stringify(manifest, null, 2) + '\n';
  };

  const candidateEnv = { ...env, EXACT_UPDATE_TRUST: 'production', EXACT_VERSION: manifest.version };
  const run = channel => {
    execFileSync(process.execPath, ['--no-env-file', 'scripts/locales.mjs'], { env: candidateEnv, stdio: 'inherit' });
    const app = appApi.resolveApp(process.cwd());
    return deliver({ origin, sdk: { ...appApi, ...publisher }, app, platform, channel, signer,
      env: candidateEnv, fingerprint: inputs.fingerprint, seed: phase === 'seed' });
  };

  if (phase === 'seed') {
    const channel = env.EXACT_UPDATE_CHANNEL;
    if (channelPattern.exec(channel ?? '')?.[1] !== platform || readFileSync('app.json', 'utf8') !== configure(channel)) {
      throw Error('Seed requires the native build’s configured manifest and channel');
    }
    await run(channel);
    return;
  }

  const latest = latestChannel(await origin.list('.exact'), platform);
  let retry = false;
  if (latest) {
    const channel = `base-${platform}-${latest}`;
    writeFileSync('app.json', configure(channel));
    const outcome = await run(channel);
    retry = outcome === 'retry';
    if (outcome !== 'native' && !retry) {
      appendFileSync(env.GITHUB_OUTPUT, 'native=false\n');
      return;
    }
  }

  const channel = `base-${platform}-${retry ? latest : latest + 1}`;
  if (!channelPattern.test(channel)) throw Error('CI update channel number exhausted');
  writeFileSync('app.json', configure(channel));
  appendFileSync(env.GITHUB_ENV, `EXACT_UPDATE_CHANNEL=${channel}\nEXACT_UPDATE_TRUST=production\nEXACT_VERSION=${manifest.version}\nEXACT_UPDATE_GENESIS=1\n`);
  appendFileSync(env.GITHUB_OUTPUT, 'native=true\n');
  console.log(platform, 'requires a native base', channel);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
