"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { constants } = require("node:fs");
const { FORMAT_VERSION, MAX_FILE_BYTES, validateState, upgradeState } = require("./jsonFileRepository");

const MANIFEST_VERSION = 1;
const DEFAULT_RETENTION_COUNT = 14;
const MAX_RETENTION_COUNT = 1000;
const ID_PATTERN = /^(backup|recovery)-\d{8}T\d{6}\.\d{3}Z-[a-f0-9]{12}$/;

class BackupError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BackupError";
    this.code = code;
  }
}

function parseRetentionCount(value) {
  if (value === undefined || value === "") return DEFAULT_RETENTION_COUNT;
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > MAX_RETENTION_COUNT) {
    throw new BackupError("BACKUP_CONFIG_INVALID", `BACKUP_RETENTION_COUNT must be an integer from 1 through ${MAX_RETENTION_COUNT}.`);
  }
  return count;
}

function createId(kind) {
  const timestamp = new Date().toISOString().replace(/[-:]/g, "");
  return `${kind}-${timestamp}-${crypto.randomBytes(6).toString("hex")}`;
}

function backupPaths(directory, id) {
  if (typeof id !== "string" || !ID_PATTERN.test(id)) {
    throw new BackupError("BACKUP_ID_INVALID", "Backup identifier is invalid.");
  }
  return {
    data: path.join(directory, `${id}.json`),
    manifest: path.join(directory, `${id}.manifest.json`)
  };
}

function digest(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function validateStorageBytes(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_FILE_BYTES) {
    throw new BackupError("BACKUP_STORAGE_INVALID", "Storage data exceeds the supported size.");
  }
  let state;
  try {
    state = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new BackupError("BACKUP_STORAGE_INVALID", "Storage data is not valid JSON.");
  }
  if (state?.version > FORMAT_VERSION) {
    throw new BackupError("BACKUP_STORAGE_VERSION_NEWER", "Storage data was written by a newer format and cannot be restored by this application version.");
  }
  try {
    validateState(state);
  } catch {
    throw new BackupError("BACKUP_STORAGE_INVALID", "Storage data has an unsupported or invalid format.");
  }
  return state;
}

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await fs.open(directory, constants.O_RDONLY);
    await handle.sync();
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function writeTemp(directory, basename, bytes) {
  const tempPath = path.join(directory, `.${basename}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`);
  let handle;
  try {
    handle = await fs.open(tempPath, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    return tempPath;
  } catch {
    await handle?.close().catch(() => {});
    await fs.unlink(tempPath).catch(() => {});
    throw new BackupError("BACKUP_WRITE_FAILED", "Backup data could not be written safely.");
  }
}

async function installWithoutOverwrite(tempPath, finalPath, directory) {
  try {
    await fs.link(tempPath, finalPath);
    await fs.unlink(tempPath);
    await syncDirectory(directory);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => {});
    if (error.code === "EEXIST") throw new BackupError("BACKUP_ALREADY_EXISTS", "A backup with this identifier already exists; no file was replaced.");
    throw new BackupError("BACKUP_WRITE_FAILED", "Backup could not be committed safely.");
  }
}

async function readRegularFile(filePath, maximumBytes = MAX_FILE_BYTES) {
  let handle;
  try {
    handle = await fs.open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maximumBytes) throw new BackupError("BACKUP_FILE_INVALID", "Backup file is not a supported regular file.");
    return await handle.readFile();
  } catch (error) {
    if (error instanceof BackupError) throw error;
    if (error.code === "ENOENT") throw new BackupError("BACKUP_NOT_FOUND", "Requested backup file was not found.");
    if (error.code === "ELOOP") throw new BackupError("BACKUP_FILE_INVALID", "Backup files cannot be symbolic links.");
    throw new BackupError("BACKUP_READ_FAILED", "Backup file could not be read.");
  } finally {
    await handle?.close().catch(() => {});
  }
}

function parseManifest(bytes, expectedId) {
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new BackupError("BACKUP_MANIFEST_INVALID", "Backup manifest is invalid.");
  }
  if (!manifest || manifest.manifestVersion !== MANIFEST_VERSION || manifest.id !== expectedId ||
      !["backup", "recovery"].includes(manifest.kind) || manifest.fileName !== `${expectedId}.json` ||
      !Number.isSafeInteger(manifest.fileSizeBytes) || manifest.fileSizeBytes < 0 || manifest.fileSizeBytes > MAX_FILE_BYTES ||
      !/^[a-f0-9]{64}$/.test(manifest.sha256) || typeof manifest.createdAt !== "string" ||
      Number.isNaN(Date.parse(manifest.createdAt)) || typeof manifest.storageValid !== "boolean" ||
      !(manifest.storageFormatVersion === null || Number.isInteger(manifest.storageFormatVersion))) {
    throw new BackupError("BACKUP_MANIFEST_INVALID", "Backup manifest fields are invalid.");
  }
  return manifest;
}

async function verifyPair(directory, id, { restoreSource = false } = {}) {
  const paths = backupPaths(directory, id);
  const manifest = parseManifest(await readRegularFile(paths.manifest, 16 * 1024), id);
  const bytes = await readRegularFile(paths.data);
  if (bytes.length !== manifest.fileSizeBytes || digest(bytes) !== manifest.sha256) {
    throw new BackupError("BACKUP_CHECKSUM_MISMATCH", "Backup integrity verification failed.");
  }
  let state = null;
  if (manifest.storageValid) {
    state = validateStorageBytes(bytes);
    if (state.version !== manifest.storageFormatVersion) {
      throw new BackupError("BACKUP_MANIFEST_INVALID", "Backup storage version does not match its manifest.");
    }
  } else if (restoreSource || manifest.kind === "backup") {
    throw new BackupError("BACKUP_STORAGE_INVALID", "This artifact is not a valid restorable storage backup.");
  }
  if (restoreSource && (!(["backup", "recovery"].includes(manifest.kind)) || !manifest.storageValid)) {
    throw new BackupError("BACKUP_NOT_RESTORABLE", "Only checksum-verified, format-valid storage artifacts can be restored.");
  }
  return { id, manifest, bytes, state };
}

function operationLockPath(directory) {
  return path.join(directory, ".backup-operation.lock");
}

async function acquireExclusiveLock(lockPath, code, message, details = {}) {
  const token = crypto.randomBytes(32).toString("hex");
  let handle;
  let created = false;
  try {
    handle = await fs.open(lockPath, "wx", 0o600);
    created = true;
    await handle.writeFile(JSON.stringify({ version: 1, pid: process.pid, createdAt: new Date().toISOString(), token, ...details }), "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    return token;
  } catch (error) {
    await handle?.close().catch(() => {});
    handle = null;
    if (created) await fs.unlink(lockPath).catch(() => {});
    if (error.code === "EEXIST") throw new BackupError(code, message);
    throw new BackupError("BACKUP_LOCK_FAILED", "A safe storage operation lock could not be created.");
  }
}

async function releaseExclusiveLock(lockPath, token) {
  try {
    const parsed = JSON.parse(await fs.readFile(lockPath, "utf8"));
    if (parsed?.token === token) await fs.unlink(lockPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw new BackupError("BACKUP_LOCK_RELEASE_FAILED", "A storage operation lock could not be released safely.");
  }
}

async function withOperationLock(directory, callback) {
  const lockPath = operationLockPath(directory);
  const token = await acquireExclusiveLock(lockPath, "BACKUP_OPERATION_IN_PROGRESS", "Another backup or restore operation is in progress, or its lock requires manual recovery.");
  try {
    return await callback();
  } finally {
    await releaseExclusiveLock(lockPath, token);
  }
}

async function readLiveStorage(storageFile) {
  return readRegularFile(storageFile);
}

function manifestFor({ id, kind, bytes, state }) {
  return {
    manifestVersion: MANIFEST_VERSION,
    kind,
    id,
    createdAt: new Date().toISOString(),
    fileName: `${id}.json`,
    storageFormatVersion: state?.version ?? null,
    fileSizeBytes: bytes.length,
    sha256: digest(bytes),
    storageValid: Boolean(state)
  };
}

async function commitPair(directory, id, bytes, manifest) {
  const paths = backupPaths(directory, id);
  let dataTemp;
  let manifestTemp;
  try {
    dataTemp = await writeTemp(directory, path.basename(paths.data), bytes);
    await installWithoutOverwrite(dataTemp, paths.data, directory);
    dataTemp = null;
    const writtenBytes = await readRegularFile(paths.data);
    if (writtenBytes.length !== bytes.length || digest(writtenBytes) !== manifest.sha256) {
      throw new BackupError("BACKUP_CHECKSUM_MISMATCH", "Written backup failed integrity verification.");
    }
    manifestTemp = await writeTemp(directory, path.basename(paths.manifest), Buffer.from(`${JSON.stringify(manifest)}\n`));
    await installWithoutOverwrite(manifestTemp, paths.manifest, directory);
    manifestTemp = null;
    await verifyPair(directory, id, { restoreSource: manifest.kind === "backup" });
  } finally {
    if (dataTemp) await fs.unlink(dataTemp).catch(() => {});
    if (manifestTemp) await fs.unlink(manifestTemp).catch(() => {});
  }
}

async function readLockMetadata(lockPath) {
  try {
    const bytes = await readRegularFile(lockPath, 4096);
    const lock = JSON.parse(bytes.toString("utf8"));
    return lock && Number.isInteger(lock.pid) ? lock : null;
  } catch (error) {
    if (error.code === "BACKUP_NOT_FOUND") return null;
    return { invalid: true };
  }
}

async function inspectCurrentVersion(storageFile) {
  let bytes;
  try {
    bytes = await readLiveStorage(storageFile);
  } catch (error) {
    if (error.code === "BACKUP_NOT_FOUND") return { exists: false, bytes: null, state: null, version: null };
    throw error;
  }
  let state;
  try {
    state = JSON.parse(bytes.toString("utf8"));
  } catch {
    return { exists: true, bytes, state: null, version: null };
  }
  const version = Number.isInteger(state?.version) ? state.version : null;
  try {
    validateState(state);
    return { exists: true, bytes, state, version };
  } catch {
    return { exists: true, bytes, state: null, version };
  }
}

async function createStorageBackupService({ storageFile, backupDir, retentionCount = DEFAULT_RETENTION_COUNT }) {
  if (typeof storageFile !== "string" || !storageFile.trim()) throw new BackupError("BACKUP_CONFIG_INVALID", "STORAGE_FILE is required for backup operations.");
  const absoluteStorageFile = path.resolve(storageFile);
  const absoluteBackupDir = path.resolve(backupDir || path.join(path.dirname(absoluteStorageFile), "backups"));
  if (absoluteBackupDir === path.dirname(absoluteStorageFile) || absoluteBackupDir === absoluteStorageFile) {
    throw new BackupError("BACKUP_CONFIG_INVALID", "Backup directory must be separate from the storage file itself.");
  }
  const retention = parseRetentionCount(retentionCount);

  async function ensureDirectory() {
    await fs.mkdir(absoluteBackupDir, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(absoluteBackupDir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new BackupError("BACKUP_DIRECTORY_INVALID", "Backup destination must be a real directory.");
    if ((stat.mode & 0o077) !== 0) throw new BackupError("BACKUP_DIRECTORY_PERMISSIONS", "Backup destination must not be accessible to group or other users.");
  }

  async function listVerifiedBackups() {
    await ensureDirectory();
    const entries = await fs.readdir(absoluteBackupDir, { withFileTypes: true });
    const ids = [...new Set(entries.map(entry => entry.name.match(/^(backup-\d{8}T\d{6}\.\d{3}Z-[a-f0-9]{12})\.manifest\.json$/)?.[1]).filter(Boolean))];
    const verified = [];
    for (const id of ids) {
      try {
        const { manifest } = await verifyPair(absoluteBackupDir, id, { restoreSource: true });
        verified.push({ id, createdAt: manifest.createdAt, fileSizeBytes: manifest.fileSizeBytes, sha256: manifest.sha256, storageFormatVersion: manifest.storageFormatVersion });
      } catch {
        // Invalid, interrupted, or recovery artifacts are deliberately omitted.
      }
    }
    return verified.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id));
  }

  async function listRecoveryCopies() {
    await ensureDirectory();
    const entries = await fs.readdir(absoluteBackupDir, { withFileTypes: true });
    const ids = [...new Set(entries.map(entry => entry.name.match(/^(recovery-\d{8}T\d{6}\.\d{3}Z-[a-f0-9]{12})\.manifest\.json$/)?.[1]).filter(Boolean))];
    const verified = [];
    for (const id of ids) {
      try {
        const { manifest } = await verifyPair(absoluteBackupDir, id, { restoreSource: true });
        verified.push({ id, createdAt: manifest.createdAt, fileSizeBytes: manifest.fileSizeBytes, sha256: manifest.sha256, storageFormatVersion: manifest.storageFormatVersion });
      } catch {
        // Invalid or corrupt recovery artifacts remain preserved and are not offered for restore.
      }
    }
    return verified.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id));
  }

  async function verifyBackup(id) {
    await ensureDirectory();
    const verified = await verifyPair(absoluteBackupDir, id, { restoreSource: true });
    return { id, createdAt: verified.manifest.createdAt, fileSizeBytes: verified.manifest.fileSizeBytes, sha256: verified.manifest.sha256, storageFormatVersion: verified.state.version };
  }

  async function pruneRetention() {
    const verified = await listVerifiedBackups();
    if (verified.length <= retention) return { retained: verified.length, removed: 0 };
    const toRemove = verified.slice(retention).filter(item => item.id !== verified[0]?.id);
    let removed = 0;
    for (const item of toRemove) {
      const paths = backupPaths(absoluteBackupDir, item.id);
      try {
        await fs.unlink(paths.manifest);
        await fs.unlink(paths.data).catch(() => {});
        removed += 1;
      } catch (error) {
        if (error.code !== "ENOENT") throw new BackupError("BACKUP_RETENTION_FAILED", "An older verified backup could not be pruned safely.");
      }
    }
    await syncDirectory(absoluteBackupDir);
    return { retained: verified.length - removed, removed };
  }

  async function createBackup() {
    await ensureDirectory();
    return withOperationLock(absoluteBackupDir, async () => {
      const bytes = await readLiveStorage(absoluteStorageFile);
      const state = validateStorageBytes(bytes);
      const id = createId("backup");
      const manifest = manifestFor({ id, kind: "backup", bytes, state });
      await commitPair(absoluteBackupDir, id, bytes, manifest);
      const retention = await pruneRetention();
      return { id, createdAt: manifest.createdAt, fileSizeBytes: manifest.fileSizeBytes, sha256: manifest.sha256, storageFormatVersion: state.version, retention };
    });
  }

  async function createRecoveryCopy(current) {
    if (!current.exists) return null;
    const id = createId("recovery");
    let state = null;
    try { state = validateStorageBytes(current.bytes); } catch { /* Preserve exact bytes even if live data is corrupt. */ }
    const manifest = manifestFor({ id, kind: "recovery", bytes: current.bytes, state });
    await commitPair(absoluteBackupDir, id, current.bytes, manifest);
    return { id, storageValid: Boolean(state), sha256: manifest.sha256, fileSizeBytes: manifest.fileSizeBytes };
  }

  async function restoreBackup(id, { confirmed = false } = {}) {
    if (confirmed !== true) throw new BackupError("RESTORE_CONFIRMATION_REQUIRED", "Restore requires explicit confirmation.");
    await ensureDirectory();
    return withOperationLock(absoluteBackupDir, async () => {
      const candidate = await verifyPair(absoluteBackupDir, id, { restoreSource: true });
      const storageLock = `${absoluteStorageFile}.lock`;
      const existingLock = await readLockMetadata(storageLock);
      if (existingLock) throw new BackupError("RESTORE_STORAGE_LOCKED", "Storage is locked or has a lock requiring manual recovery; restore was not started.");
      await fs.mkdir(path.dirname(absoluteStorageFile), { recursive: true, mode: 0o700 });
      const maintenanceToken = await acquireExclusiveLock(storageLock, "RESTORE_STORAGE_LOCKED", "Storage became active before restore could acquire its exclusive maintenance lock.", { purpose: "backup-restore" });
      let tempPath;
      try {
        const current = await inspectCurrentVersion(absoluteStorageFile);
        const upgradedState = upgradeState(candidate.state);
        const restoreBytes = Buffer.from(`${JSON.stringify(upgradedState)}\n`, "utf8");
        if (current.version !== null && current.version > upgradedState.version) {
          throw new BackupError("RESTORE_OLDER_THAN_LIVE", "Restore refused because the live storage uses a newer format version.");
        }
        const recoveryCopy = await createRecoveryCopy(current);
        const tempName = `.${path.basename(absoluteStorageFile)}.restore.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`;
        tempPath = path.join(path.dirname(absoluteStorageFile), tempName);
        let handle;
        try {
          handle = await fs.open(tempPath, "wx", 0o600);
          await handle.writeFile(restoreBytes);
          await handle.sync();
          await handle.close();
          handle = null;
          const staged = await readRegularFile(tempPath);
          if (staged.length !== restoreBytes.length || digest(staged) !== digest(restoreBytes)) {
            throw new BackupError("RESTORE_CHECKSUM_MISMATCH", "Staged restore failed integrity verification.");
          }
          validateStorageBytes(staged);
          await fs.rename(tempPath, absoluteStorageFile);
          tempPath = null;
          await syncDirectory(path.dirname(absoluteStorageFile));
        } catch (error) {
          await handle?.close().catch(() => {});
          if (error instanceof BackupError) throw error;
          throw new BackupError("RESTORE_FAILED", "Storage restore failed; the pre-restore recovery copy was preserved.");
        }
        return { id, restored: true, recoveryCopy, storageFormatVersion: upgradedState.version,
          analyticsHistoricalDataAvailable: false, analyticsCollectedFrom: upgradedState.analytics.collectedFrom };
      } finally {
        if (tempPath) await fs.unlink(tempPath).catch(() => {});
        await releaseExclusiveLock(storageLock, maintenanceToken);
      }
    });
  }

  return Object.freeze({
    storageFile: absoluteStorageFile,
    backupDir: absoluteBackupDir,
    retentionCount: retention,
    createBackup,
    listVerifiedBackups,
    listRecoveryCopies,
    verifyBackup,
    restoreBackup
  });
}

module.exports = { BackupError, DEFAULT_RETENTION_COUNT, MAX_RETENTION_COUNT, createStorageBackupService, parseRetentionCount };
