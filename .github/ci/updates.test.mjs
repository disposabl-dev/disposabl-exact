import assert from 'node:assert/strict';
import { createPublicKey, verify } from 'node:crypto';
import test from 'node:test';
import { deliver, latestChannel, updateSigner } from './updates.mjs';

const key = Buffer.alloc(32, 9).toString('base64');
const canonical = head => Buffer.from(JSON.stringify(head));
const signer = updateSigner(key, ['fixture', 'ios'], canonical);

test('scope controls the Ed25519 key and directory parsing fails closed', () => {
  const head = { seq: 2 };
  const publicKey = createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(signer.publicKey, 'base64')]),
    format: 'der', type: 'spki',
  });
  assert(verify(null, canonical(head), publicKey, Buffer.from(signer.sign(head).ed25519, 'base64')));
  assert.equal(updateSigner(key, ['fixture', 'ios'], canonical).publicKey, signer.publicKey);
  assert.notEqual(updateSigner(key, ['fixture', 'android'], canonical).publicKey, signer.publicKey);
  assert.throws(() => updateSigner('invalid', [], canonical));
  assert.equal(latestChannel([]), 0);
  assert.equal(latestChannel(['base-2', 'base-10', 'blobs']), 10);
  for (const names of [null, {}, ['broken'], ['base-0']]) assert.throws(() => latestChannel(names));
});

function fixture(platform, seed = false) {
  const channel = 'base-1';
  const fingerprint = 'a'.repeat(64);
  const app = { dir: '.', workspace: '.', target: '.' };
  const compat = { id: 'cohort', inputs: { platform, keys: { ci: signer.publicKey }, store: { L: 'A' } } };
  const build = { trust: 'production', compat, pendingInputs: [] };
  const cohort = { compat, binaryInputs: { sha256: 'evidence' } };
  const stream = { channel, compatibilityId: compat.id };
  const row = { platform, channel, compatibilityId: compat.id, receipt: cohort };
  const found = [{ stream, platform, cohort, head: seed ? null : { release: 'earlier' } }];
  const candidate = { build, row };
  let publishes = 0;
  let bakes = 0;
  const sdk = {
    streams: async (_origin, _app, wantedChannel, opts) => {
      assert.equal(wantedChannel, channel);
      assert.deepEqual(opts.platforms, [platform]);
      assert.equal(opts.builds.length, seed ? 1 : 0);
      return found;
    },
    readBuilds: () => [build],
    readBinaryInputFile: async () => ({ bytes: Buffer.from('evidence') }),
    streamCandidates: async () => { bakes++; return [candidate]; },
    classifyArtifacts: () => ({ bundle: true }),
    defaultRelease: () => 'fixture',
    publishStream: async args => {
      publishes++;
      assert.equal(args.release, 'fixture-src-' + fingerprint);
      return { action: 'published', seq: 1 };
    },
  };
  return { sdk, found, build, candidate, counts: () => [bakes, publishes],
    run: () => deliver({ sdk, app, origin: {}, platform, channel, signer, fingerprint, seed,
      env: { GITHUB_SHA: 'a'.repeat(40) } }) };
}

for (const platform of ['android', 'ios', 'macos']) {
  test(platform + ' seeds its production receipt and delivers changed compatible content', async () => {
    for (const seed of [true, false]) {
      const state = fixture(platform, seed);
      assert.equal(await state.run(), 'published');
      assert.deepEqual(state.counts(), [1, 1]);
    }
  });
}

test('same authenticated source skips the bake and still checks native evidence', async () => {
  const state = fixture('ios');
  state.found[0].head.release = 'fixture-src-' + 'a'.repeat(64);
  assert.equal(await state.run(), 'current');
  assert.deepEqual(state.counts(), [0, 0]);
  state.sdk.readBinaryInputFile = async () => { throw Error('corrupt evidence'); };
  await assert.rejects(state.run, /corrupt evidence/);
});

test('only a proven incompatibility requests a new native base', async () => {
  const state = fixture('android');
  state.build.pendingInputs = ['native file'];
  assert.equal(await state.run(), 'native');
  assert.deepEqual(state.counts(), [1, 0]);
  state.candidate.reason = 'invalid module';
  await assert.rejects(state.run, /invalid module/);
  assert.deepEqual(state.counts(), [2, 0]);
  state.sdk.streams = async () => { throw Error('invalid signature'); };
  await assert.rejects(state.run, /invalid signature/);
  assert.deepEqual(state.counts(), [2, 0]);
});

test('seed rejects an existing head, a missing receipt, and an incompatible fresh build', async () => {
  const state = fixture('macos', true);
  state.found[0].head = {};
  await assert.rejects(state.run, /exact new production receipt/);
  state.found[0].head = null;
  state.build.pendingInputs = ['unexpected input'];
  await assert.rejects(state.run, /rejected its seed bundle/);
  state.sdk.readBuilds = () => [];
  await assert.rejects(state.run, /one matching production build receipt/);
  assert.deepEqual(state.counts(), [1, 0]);
});
