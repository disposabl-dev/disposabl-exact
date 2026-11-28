"use node";

import { generateKeyPairSync, randomBytes } from "node:crypto";
import { ConvexError } from "convex/values";
import forge from "node-forge";
import { request } from "./provider";

function createAndroidSigningSecret() {
  const keys = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
  });
  const privateKey = forge.pki.privateKeyFromPem(keys.privateKey);
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = forge.pki.publicKeyFromPem(keys.publicKey);
  certificate.serialNumber = `01${randomBytes(16).toString("hex")}`;
  certificate.validity.notBefore = new Date();
  certificate.validity.notAfter = new Date(Date.now() + 10_000 * 24 * 60 * 60 * 1000);
  const subject = [{ shortName: "CN", value: "Android app signing" }];
  certificate.setSubject(subject);
  certificate.setIssuer(subject);
  certificate.sign(privateKey, forge.md.sha256.create());

  const password = randomBytes(32).toString("hex");
  const pkcs12 = forge.pkcs12.toPkcs12Asn1(privateKey, [certificate], password, {
    algorithm: "aes256",
    friendlyName: "android",
  });
  const keystore = forge.util.encode64(forge.asn1.toDer(pkcs12).getBytes());
  return JSON.stringify({ keystore, password });
}

const generators = {
  EXACT_UPDATE_SEED: () => randomBytes(32).toString("base64"),
  ANDROID_APK_SIGNING: createAndroidSigningSecret,
};

export async function ensureSigningSecrets(
  token: string,
  projectId: number,
  production: string,
  hasGitHubSecret: (name: string) => boolean,
) {
  const target = { deployment: production };
  const { environmentVariables } = await request<{ environmentVariables: Record<string, string | undefined> }>(
    target, token, "/list_environment_variables",
  );
  const values = new Map<string, string>();
  const changes: { name: string; value: string }[] = [];

  for (const [name, generate] of Object.entries(generators)) {
    let value = environmentVariables[name];
    if (!value) {
      if (value !== undefined || hasGitHubSecret(name)) {
        throw new ConvexError(`Restore ${name} in the app's production Convex environment before retrying.`);
      }
      value = generate();
      changes.push({ name, value });
    }
    values.set(name, value);
  }

  // Persist production first so a failed preview write can reuse the same keys.
  if (changes.length > 0) await request(target, token, "/update_environment_variables", { changes });
  await request("Convex", token, `/projects/${projectId}/update_default_environment_variables`, {
    changes: Array.from(values, ([name, value]) => ({
      name, value, deploymentType: "preview", applyToExistingDeployments: true,
    })),
  });
}
