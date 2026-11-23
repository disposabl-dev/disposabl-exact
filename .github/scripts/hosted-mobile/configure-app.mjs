const app = await Bun.file("app.json").json();
const template = await Bun.file(`${process.env.GITHUB_WORKSPACE}/apps/apps/app.json`).json();
app.deploy ??= {};
app.deploy.store = { ...app.deploy.store };
for (const platform of ["android", "ios", "macos"]) {
  app.deploy.store[platform] = template.deploy.store[platform];
}
app.deploy.signing = { key: "benchmark", keys: { benchmark: "FPoMYpSLlWwuBUBirF3yGlftL3thxKqDCkkHxa5g64Y=" } };
app.deploy.channel = "benchmark";
app.deploy.channels = { benchmark: "appdrop" };
await Bun.write("app.json", JSON.stringify(app, null, 2) + "\n");
