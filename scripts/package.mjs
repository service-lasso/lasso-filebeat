import { spawnSync } from "node:child_process";
import { chmod, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const filebeatVersion = process.env.FILEBEAT_VERSION ?? "8.14.2";
const targetPlatform = process.env.TARGET_PLATFORM ?? process.platform;

const targets = {
  win32: {
    upstreamAsset: `filebeat-${filebeatVersion}-windows-x86_64.zip`,
    upstreamUrl: `https://artifacts.elastic.co/downloads/beats/filebeat/filebeat-${filebeatVersion}-windows-x86_64.zip`,
    archiveType: "zip",
    binaryName: "filebeat.exe",
  },
  linux: {
    upstreamAsset: `filebeat-${filebeatVersion}-linux-x86_64.tar.gz`,
    upstreamUrl: `https://artifacts.elastic.co/downloads/beats/filebeat/filebeat-${filebeatVersion}-linux-x86_64.tar.gz`,
    archiveType: "tar.gz",
    binaryName: "filebeat",
  },
  darwin: {
    upstreamAsset: `filebeat-${filebeatVersion}-darwin-aarch64.tar.gz`,
    upstreamUrl: `https://artifacts.elastic.co/downloads/beats/filebeat/filebeat-${filebeatVersion}-darwin-aarch64.tar.gz`,
    archiveType: "tar.gz",
    binaryName: "filebeat",
  },
};

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

function versionedAssetName(version, platform, archiveType) {
  return `lasso-filebeat-${version}-${platform}.${archiveType === "zip" ? "zip" : "tar.gz"}`;
}

async function download(url, destination) {
  if (existsSync(destination)) {
    return;
  }

  const response = await fetch(url, {
    headers: {
      "user-agent": "service-lasso-lasso-filebeat-packager",
    },
  });

  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

async function extractArchive(archivePath, destination, archiveType) {
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });

  if (archiveType === "zip") {
    run("powershell", [
      "-NoLogo",
      "-NoProfile",
      "-Command",
      `Expand-Archive -Path ${JSON.stringify(archivePath)} -DestinationPath ${JSON.stringify(destination)} -Force`,
    ]);
    return;
  }

  run("tar", ["-xzf", archivePath, "-C", destination]);
}

async function compressPackage(packageRoot, outputPath, archiveType) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await rm(outputPath, { force: true });

  if (archiveType === "zip") {
    run("powershell", [
      "-NoLogo",
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path ${JSON.stringify(path.join(packageRoot, "*"))} -DestinationPath ${JSON.stringify(outputPath)} -Force`,
    ]);
    return outputPath;
  }

  run("tar", ["-czf", outputPath, "-C", packageRoot, "."]);
  return outputPath;
}

function findDistributionRoot(root, binaryName) {
  const shell = process.platform === "win32" ? "powershell" : "bash";
  const args =
    process.platform === "win32"
      ? [
          "-NoLogo",
          "-NoProfile",
          "-Command",
          `(Get-ChildItem -Path ${JSON.stringify(root)} -Recurse -Filter ${JSON.stringify(binaryName)} | Select-Object -First 1).Directory.FullName`,
        ]
      : ["-lc", `dirname "$(find ${JSON.stringify(root)} -type f -name ${JSON.stringify(binaryName)} | head -n 1)"`];
  const result = spawnSync(shell, args, { cwd: repoRoot, encoding: "utf8", shell: false });
  const candidate = result.stdout.trim();
  if (result.status !== 0 || !candidate) {
    throw new Error(`Could not find Filebeat distribution root under ${root}.`);
  }
  return candidate;
}

export async function packageFilebeat(platform = targetPlatform, version = filebeatVersion) {
  const target = targets[platform];
  if (!target) {
    throw new Error(`Unsupported target platform: ${platform}. Supported platforms: ${Object.keys(targets).join(", ")}.`);
  }

  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Expected Filebeat version like "8.14.2", got "${version}".`);
  }

  const vendorRoot = path.join(repoRoot, "vendor", version, platform);
  const outputRoot = path.join(repoRoot, "output", "package", version, platform);
  const extractRoot = path.join(outputRoot, "extract");
  const packageRoot = path.join(outputRoot, "payload");
  const upstreamArchive = process.env.FILEBEAT_VENDOR_ARCHIVE
    ? path.resolve(process.env.FILEBEAT_VENDOR_ARCHIVE)
    : path.join(vendorRoot, target.upstreamAsset);
  const assetName = versionedAssetName(version, platform, target.archiveType);
  const outputPath = path.join(repoRoot, "dist", assetName);

  await mkdir(vendorRoot, { recursive: true });
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(packageRoot, { recursive: true });

  if (!process.env.FILEBEAT_VENDOR_ARCHIVE) {
    await download(target.upstreamUrl, upstreamArchive);
  }

  await extractArchive(upstreamArchive, extractRoot, target.archiveType);
  const distributionRoot = findDistributionRoot(extractRoot, target.binaryName);
  await cp(distributionRoot, packageRoot, { recursive: true });

  if (platform !== "win32") {
    await chmod(path.join(packageRoot, target.binaryName), 0o755);
  }

  await writeFile(
    path.join(packageRoot, "SERVICE-LASSO-PACKAGE.json"),
    `${JSON.stringify(
      {
        serviceId: "filebeat",
        upstream: {
          vendor: "Elastic",
          source: "https://artifacts.elastic.co/downloads/beats/filebeat/",
          version,
          asset: target.upstreamAsset,
          url: target.upstreamUrl,
        },
        migratedFrom: {
          sourcePath: "services/filebeat",
          sourceVersion: "8.14.2",
          startCommand: "./filebeat -c filebeat.yml -e",
          setupCommand: "./filebeat setup -e",
        },
        packagedBy: "service-lasso/lasso-filebeat",
        platform,
        arch: platform === "darwin" ? "arm64" : "x64",
        command: target.binaryName,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  await compressPackage(packageRoot, outputPath, target.archiveType);
  console.log(`[lasso-filebeat] packaged ${outputPath}`);
  return outputPath;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await packageFilebeat();
}
