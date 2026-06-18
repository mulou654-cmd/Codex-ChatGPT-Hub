const fs = require("node:fs/promises");
const path = require("node:path");

const { createHubCore, findProjectRoot } = require("../src/hub-core.cjs");

async function main() {
  const projectRoot = findProjectRoot([path.resolve(__dirname, "..", "..", "..")]);
  const core = createHubCore(projectRoot);
  const originalEnv = await fs.readFile(core.envPath, "utf8").catch(() => "");
  const smokeSpace = `hub-manager-smoke-${Date.now()}`;
  let smokeSpaceDir;

  try {
    const before = await core.readManagerState();
    const switched = await core.setMemorySpace(smokeSpace);
    smokeSpaceDir = switched.config.spaceDataDir;

    if (switched.config.memorySpace !== smokeSpace) {
      throw new Error(`Unexpected sanitized space: ${switched.config.memorySpace}`);
    }

    if (!switched.config.spaceDataDir.endsWith(`${path.sep}.data${path.sep}spaces${path.sep}${smokeSpace}`)) {
      throw new Error(`Unexpected spaceDataDir: ${switched.config.spaceDataDir}`);
    }

    const spaceStats = await fs.stat(switched.config.spaceDataDir);
    if (!spaceStats.isDirectory()) {
      throw new Error(`Space directory was not created: ${switched.config.spaceDataDir}`);
    }

    await fs.writeFile(core.envPath, originalEnv, "utf8");
    const restored = await core.readManagerState();

    console.log(JSON.stringify({
      ok: true,
      projectRoot: core.projectRoot,
      beforeSpace: before.config.memorySpace,
      smokeSpace: switched.config.memorySpace,
      restoredSpace: restored.config.memorySpace,
      serviceOk: before.service.ok === true
    }, null, 2));
  } catch (error) {
    throw error;
  } finally {
    await fs.writeFile(core.envPath, originalEnv, "utf8").catch(() => undefined);
    if (isSmokeSpaceDir(projectRoot, smokeSpaceDir)) {
      await fs.rm(smokeSpaceDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

function isSmokeSpaceDir(projectRoot, targetPath) {
  if (!targetPath) {
    return false;
  }

  const spacesRoot = path.resolve(projectRoot, ".data", "spaces");
  const resolved = path.resolve(targetPath);
  return path.dirname(resolved) === spacesRoot && path.basename(resolved).startsWith("hub-manager-smoke-");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
