"use strict";

const { JsonFileVisitorRepository } = require("./jsonFileRepository");
const { StorageError } = require("./jsonFileRepository");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

function decodeMountField(value) {
  return value.replace(/\\([0-7]{3})/g, (_match, octal) => String.fromCharCode(Number.parseInt(octal, 8)));
}

function mountInfoHasPath(mountInfo, mountPath) {
  const expected = path.resolve(mountPath);
  return mountInfo.split("\n").some(line => {
    const fields = line.split(" ");
    return fields.length >= 6 && decodeMountField(fields[4]) === expected;
  });
}

async function assertPersistentMountAvailable(mountPath, mountInfoFile = "/proc/self/mountinfo") {
  let mountInfo;
  try {
    mountInfo = await fs.readFile(mountInfoFile, "utf8");
  } catch {
    throw new StorageError("STORAGE_MOUNT_UNAVAILABLE", "Configured persistent storage mount is unavailable.");
  }
  if (!mountInfoHasPath(mountInfo, mountPath)) {
    throw new StorageError("STORAGE_MOUNT_UNAVAILABLE", "Configured persistent storage mount is not mounted; refusing ephemeral storage.");
  }
}

async function createStorageRepository(config) {
  if (!config || config.storageBackend !== "json-file") {
    if (config?.vercelMode === true && config.storageBackend === "neon-postgres") {
      if (typeof config.databaseUrl !== "string" || !config.databaseUrl) {
        const error = new Error("DATABASE_URL is required for Vercel PostgreSQL storage.");
        error.code = "DATABASE_URL_REQUIRED";
        throw error;
      }
      const { neon } = require("@neondatabase/serverless");
      const { createNeonRepository } = require("./neonRepository");
      const repository = createNeonRepository({ sql: neon(config.databaseUrl) });
      await repository.assertSchema();
      await repository.ping();
      return repository;
    }
    const error = new Error("Unsupported storage backend.");
    error.code = "STORAGE_BACKEND_UNSUPPORTED";
    throw error;
  }
  if (config.stagingMode) {
    const tempRoot = path.resolve(os.tmpdir());
    const stagingDir = path.resolve(config.stagingStorageDir || "");
    const relativeDir = path.relative(tempRoot, stagingDir);
    const expectedFile = path.join(stagingDir, "visitors.json");
    if (config.stagingEphemeralStorage !== true || !relativeDir || relativeDir === ".." || relativeDir.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativeDir) || path.resolve(config.storageFile) !== expectedFile || config.storageMountPath ||
        config.storageFile === "/var/data" || config.storageFile.startsWith("/var/data/")) {
      throw new StorageError("STAGING_STORAGE_CONFIG_INVALID", "Temporary staging storage configuration is invalid; refusing to open a data file.");
    }
    try {
      await fs.mkdir(stagingDir, { recursive: true, mode: 0o700 });
      const stat = await fs.lstat(stagingDir);
      if (!stat.isDirectory() || stat.isSymbolicLink() || (typeof process.getuid === "function" && stat.uid !== process.getuid()) || (stat.mode & 0o077) !== 0) {
        throw new StorageError("STAGING_STORAGE_PERMISSIONS", "Temporary staging storage directory must be owned by this process and private.");
      }
    } catch (error) {
      if (error instanceof StorageError) throw error;
      throw new StorageError("STAGING_STORAGE_UNAVAILABLE", "Temporary staging storage directory is unavailable.");
    }
  } else if (config.stagingEphemeralStorage === true) {
    throw new StorageError("STAGING_STORAGE_CONFIG_INVALID", "Ephemeral storage requires explicit staging mode; refusing to open a data file.");
  }
  if (config.nodeEnv === "production" && !config.stagingMode) {
    if (!config.storageMountPath) {
      throw new StorageError("STORAGE_MOUNT_UNAVAILABLE", "Production file storage requires a configured persistent mount.");
    }
    await assertPersistentMountAvailable(config.storageMountPath);
  }
  return JsonFileVisitorRepository.open(config.storageFile);
}

module.exports = { createStorageRepository, mountInfoHasPath, assertPersistentMountAvailable };
