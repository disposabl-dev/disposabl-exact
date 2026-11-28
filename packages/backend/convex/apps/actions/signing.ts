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
) {
  const target = { deployment: production };
  const { environmentVariables } = await request<{ environmentVariables: Record<string, string | undefined> }>(
    target, token, "/list_environment_variables",
  );
  const previewPath = `/projects/${projectId}`;
  const { items } = await request<{ items: { name: string; value: string }[] }>(
    "Convex", token, previewPath + "/list_default_environment_variables?deploymentType=preview",
  );
  const preview = new Map(items.map(({ name, value }) => [name, value]));
  const productionChanges = [];
  const previewChanges = [];

  for (const [name, generate] of Object.entries(generators)) {
    const saved = environmentVariables[name];
    if (saved === "") throw new ConvexError(`Restore ${name} in the production Convex environment before retrying.`);
    const productionValue = saved ?? generate();
    if (!saved) productionChanges.push({ name, value: productionValue });
    if (!preview.get(name) || preview.get(name) === productionValue) {
      previewChanges.push({ name, value: generate(), deploymentType: "preview", applyToExistingDeployments: true });
    }
  }

  if (productionChanges.length) await request(target, token, "/update_environment_variables", { changes: productionChanges });
  if (previewChanges.length) await request("Convex", token, previewPath + "/update_default_environment_variables", { changes: previewChanges });
}
