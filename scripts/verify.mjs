import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packageFilebeat } from "./package.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const platform = process.env.TARGET_PLATFORM ?? process.platform;
const filebeatVersion = process.env.FILEBEAT_VERSION ?? "8.14.2";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false,
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

async function reserveLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to reserve loopback port.")));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

async function extractArchive(artifact, destination) {
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });

  if (artifact.endsWith(".zip")) {
    run("powershell", [
      "-NoLogo",
      "-NoProfile",
      "-Command",
      `Expand-Archive -Path ${JSON.stringify(artifact)} -DestinationPath ${JSON.stringify(destination)} -Force`,
    ]);
    return;
  }

  run("tar", ["-xzf", artifact, "-C", destination]);
}

function renderConfig(template, replacements) {
  return Object.entries(replacements).reduce((content, [key, value]) => content.replaceAll(`\${${key}}`, value), template);
}

async function waitForHttp(url, timeoutMs = 30_000) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.status === 200) {
        return await response.text();
      }
      lastError = new Error(`Unexpected status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }

  throw lastError ?? new Error(`Timed out waiting for ${url}.`);
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("close", resolve)),
    sleep(10_000).then(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }),
  ]);
}

const serviceManifest = JSON.parse(await readFile(path.join(repoRoot, "service.json"), "utf8"));
if (serviceManifest.id !== "filebeat" || serviceManifest.version !== filebeatVersion) {
  throw new Error(`Unexpected service manifest identity: ${JSON.stringify({ id: serviceManifest.id, version: serviceManifest.version })}`);
}

if (
  serviceManifest.healthcheck?.type !== "http" ||
  serviceManifest.healthcheck.url !== "http://${FILEBEAT_HTTP_HOST}:${FILEBEAT_HTTP_PORT}/" ||
  serviceManifest.ports?.service !== 5066
) {
  throw new Error(`Filebeat service.json health/ports drifted: ${JSON.stringify(serviceManifest.healthcheck)}`);
}

for (const key of ["FILEBEAT_HTTP_URL", "FILEBEAT_HTTP_PORT", "FILEBEAT_LOG_GLOB"]) {
  if (!serviceManifest.globalenv?.[key]) {
    throw new Error(`Filebeat service.json is missing globalenv ${key}.`);
  }
}

if (!serviceManifest.setup?.steps?.["setup-dashboards"] || serviceManifest.setup.steps["setup-dashboards"].rerun !== "manual") {
  throw new Error("Filebeat service.json must expose a manual setup-dashboards setup step.");
}

const artifact = await packageFilebeat(platform, filebeatVersion);
const verifyRoot = path.join(repoRoot, "output", "verify", filebeatVersion, platform);
const serviceRoot = path.join(verifyRoot, "service");
const extractRoot = path.join(serviceRoot, ".state", "extracted", "current");
const runtimeRoot = path.join(serviceRoot, "runtime");
const dataRoot = path.join(runtimeRoot, "data");
const logRoot = path.join(serviceRoot, "logs");
const inputRoot = path.join(serviceRoot, "input-logs");
const httpPort = await reserveLoopbackPort();

await rm(verifyRoot, { recursive: true, force: true });
await mkdir(runtimeRoot, { recursive: true });
await mkdir(dataRoot, { recursive: true });
await mkdir(logRoot, { recursive: true });
await mkdir(inputRoot, { recursive: true });
await extractArchive(artifact, extractRoot);

const metadata = JSON.parse(await readFile(path.join(extractRoot, "SERVICE-LASSO-PACKAGE.json"), "utf8"));
if (
  metadata.serviceId !== "filebeat" ||
  metadata.upstream?.version !== filebeatVersion ||
  metadata.packagedBy !== "service-lasso/lasso-filebeat" ||
  metadata.platform !== platform
) {
  throw new Error(`Unexpected package metadata: ${JSON.stringify(metadata)}`);
}

const binary = path.join(extractRoot, platform === "win32" ? "filebeat.exe" : "filebeat");
run(binary, ["version"]);

await writeFile(path.join(inputRoot, "sample.log"), "hello from lasso-filebeat verification\n", "utf8");
const logGlob = platform === "win32" ? `${inputRoot}\\*.log` : `${inputRoot}/*.log`;
const config = renderConfig(serviceManifest.config.files[0].content, {
  FILEBEAT_LOG_GLOB: logGlob,
  FILEBEAT_OUTPUT_HOST: "http://127.0.0.1:1",
  FILEBEAT_OUTPUT_TIMEOUT: "1",
  FILEBEAT_OUTPUT_PATH: "/api/default/",
  FILEBEAT_OUTPUT_INDEX: "default",
  FILEBEAT_OUTPUT_USERNAME: "root@service-lasso.local",
  FILEBEAT_OUTPUT_PASSWORD: "service-lasso-openobserve",
  FILEBEAT_HTTP_HOST: "127.0.0.1",
  FILEBEAT_HTTP_PORT: String(httpPort),
  FILEBEAT_LOG_DIR: logRoot,
});
const configPath = path.join(runtimeRoot, "filebeat.yml");
await writeFile(configPath, config, "utf8");

run(binary, [
  "test",
  "config",
  "-c",
  configPath,
  "--path.home",
  extractRoot,
  "--path.config",
  runtimeRoot,
  "--path.data",
  dataRoot,
  "--path.logs",
  logRoot,
]);

const child = spawn(
  binary,
  [
    "-c",
    configPath,
    "-e",
    "--path.home",
    extractRoot,
    "--path.config",
    runtimeRoot,
    "--path.data",
    dataRoot,
    "--path.logs",
    logRoot,
  ],
  {
    cwd: serviceRoot,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  },
);

let stdout = "";
let stderr = "";
child.stdout?.on("data", (chunk) => {
  stdout += chunk.toString();
});
child.stderr?.on("data", (chunk) => {
  stderr += chunk.toString();
});

try {
  const body = await waitForHttp(`http://127.0.0.1:${httpPort}/`);
  if (!body.includes('"beat":"filebeat"') || !body.includes(`"version":"${filebeatVersion}"`)) {
    throw new Error(`Unexpected Filebeat HTTP response: ${body.slice(0, 300)}`);
  }
  console.log("[lasso-filebeat] verification passed");
} catch (error) {
  console.error("[lasso-filebeat] stdout:");
  console.error(stdout);
  console.error("[lasso-filebeat] stderr:");
  console.error(stderr);
  throw error;
} finally {
  await stopChild(child);
}
