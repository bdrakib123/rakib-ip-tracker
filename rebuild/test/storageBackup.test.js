"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createStorageBackupService, DEFAULT_RETENTION_COUNT } = require("../src/db/storageBackup");
const { main: backupCliMain } = require("../scripts/storageBackup");

async function fixture(options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rakib-ip-backup-"));
  const storageFile = path.join(root, "data", "visitors.json");
  const backupDir = path.join(root, "data", "backups");
  await fs.mkdir(path.dirname(storageFile), { recursive: true });
  await fs.writeFile(storageFile, JSON.stringify({ version: 1, records: [] }) + "\n", { mode: 0o600 });
  const service = await createStorageBackupService({ storageFile, backupDir, ...options });
  return { root, storageFile, backupDir, service };
}

function stateWith(id) {
  return { version: 1, records: [{ _id: id, createdAt: "2026-01-02T03:04:05.000Z", ipMasked: "203.0.113.xxx" }] };
}

test("creates timestamped private backup and verifies manifest checksum and format", async t => {
  const { root, storageFile, backupDir, service } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const original = await fs.readFile(storageFile);
  const result = await service.createBackup();
  assert.match(result.id, /^backup-\d{8}T\d{6}\.\d{3}Z-[a-f0-9]{12}$/);
  assert.equal(await fs.readFile(storageFile, "utf8"), original.toString("utf8"));
  assert.equal(result.sha256, crypto.createHash("sha256").update(original).digest("hex"));
  const verified = await service.verifyBackup(result.id);
  assert.equal(verified.storageFormatVersion, 1);
  assert.equal((await service.listVerifiedBackups()).length, 1);
  const dataStat = await fs.stat(path.join(backupDir, `${result.id}.json`));
  const manifestStat = await fs.stat(path.join(backupDir, `${result.id}.manifest.json`));
  assert.equal(dataStat.mode & 0o777, 0o600);
  assert.equal(manifestStat.mode & 0o777, 0o600);
  const manifest = JSON.parse(await fs.readFile(path.join(backupDir, `${result.id}.manifest.json`), "utf8"));
  assert.equal(manifest.storageFormatVersion, 1);
  assert.equal(manifest.fileSizeBytes, original.length);
  assert.equal(Object.hasOwn(manifest, "encryptionKey"), false);
  assert.equal(Object.hasOwn(manifest, "adminPassword"), false);
});

test("backup and restore CLI refuses all operations in explicitly temporary staging mode", async () => {
  await assert.rejects(backupCliMain(["create"], {
    STAGING_MODE: "true", STAGING_EPHEMERAL_STORAGE: "true", STORAGE_FILE: "/tmp/synthetic-staging/visitors.json"
  }), { code: "BACKUP_STAGING_DISABLED" });
});

test("rejects corrupted backups and omits them from verified listings", async t => {
  const { root, backupDir, service } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const created = await service.createBackup();
  await fs.writeFile(path.join(backupDir, `${created.id}.json`), JSON.stringify(stateWith("tampered")), { mode: 0o600 });
  await assert.rejects(service.verifyBackup(created.id), { code: "BACKUP_CHECKSUM_MISMATCH" });
  assert.deepEqual(await service.listVerifiedBackups(), []);
});

test("ignores interrupted and incomplete artifacts without deleting them", async t => {
  const { root, backupDir, service } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(backupDir, { recursive: true, mode: 0o700 });
  const orphanId = "backup-20261118T120000.000Z-aaaaaaaaaaaa";
  const orphanPath = path.join(backupDir, `${orphanId}.json`);
  await fs.writeFile(orphanPath, JSON.stringify(stateWith("orphan")), { mode: 0o600 });
  const temporaryPath = path.join(backupDir, ".backup-interrupted.tmp");
  await fs.writeFile(temporaryPath, "partial", { mode: 0o600 });
  assert.deepEqual(await service.listVerifiedBackups(), []);
  assert.equal(await fs.readFile(orphanPath, "utf8"), JSON.stringify(stateWith("orphan")));
  assert.equal(await fs.readFile(temporaryPath, "utf8"), "partial");
});

test("prevents concurrent backup operations and preserves the existing operation lock", async t => {
  const { root, storageFile, backupDir, service } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(backupDir, { recursive: true, mode: 0o700 });
  const operationLock = path.join(backupDir, ".backup-operation.lock");
  const lockText = JSON.stringify({ version: 1, pid: 123456, token: "synthetic" });
  await fs.writeFile(operationLock, lockText, { mode: 0o600 });
  const original = await fs.readFile(storageFile, "utf8");
  await assert.rejects(service.createBackup(), { code: "BACKUP_OPERATION_IN_PROGRESS" });
  assert.equal(await fs.readFile(storageFile, "utf8"), original);
  assert.equal(await fs.readFile(operationLock, "utf8"), lockText);
});

test("two overlapping backup calls cannot run concurrently", async t => {
  const { root, service } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const results = await Promise.allSettled([service.createBackup(), service.createBackup()]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.filter(result => result.status === "rejected" && result.reason.code === "BACKUP_OPERATION_IN_PROGRESS").length, 1);
  assert.equal((await service.listVerifiedBackups()).length, 1);
});

test("refuses a backup directory accessible to group or other users", async t => {
  const { root, backupDir, service } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(backupDir, { recursive: true, mode: 0o755 });
  await fs.chmod(backupDir, 0o755);
  await assert.rejects(service.createBackup(), { code: "BACKUP_DIRECTORY_PERMISSIONS" });
});

test("retention prunes only older verified backups and preserves newest and invalid artifacts", async t => {
  const { root, backupDir, storageFile, service } = await fixture({ retentionCount: 2 });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const first = await service.createBackup();
  await new Promise(resolve => setTimeout(resolve, 3));
  await service.createBackup();
  await new Promise(resolve => setTimeout(resolve, 3));
  await service.createBackup();
  assert.equal((await service.listVerifiedBackups()).length, 2);
  const orphanId = "backup-20261118T120001.000Z-bbbbbbbbbbbb";
  const orphanPath = path.join(backupDir, `${orphanId}.json`);
  await fs.writeFile(orphanPath, "invalid", { mode: 0o600 });
  await fs.writeFile(storageFile, `${JSON.stringify(stateWith("fourth"))}\n`, { mode: 0o600 });
  const newest = await service.createBackup();
  const remaining = await service.listVerifiedBackups();
  assert.equal(remaining.length, 2);
  assert.equal(remaining[0].id, newest.id);
  await assert.rejects(service.verifyBackup(first.id), { code: "BACKUP_NOT_FOUND" });
  assert.equal(await fs.readFile(orphanPath, "utf8"), "invalid");
  assert.equal(await fs.readFile(storageFile, "utf8"), `${JSON.stringify(stateWith("fourth"))}\n`);
  assert.equal(DEFAULT_RETENTION_COUNT, 14);
});

test("restore requires confirmation, refuses active app lock, and preserves live storage", async t => {
  const { root, storageFile, service } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const backup = await service.createBackup();
  const current = JSON.stringify(stateWith("current"));
  await fs.writeFile(storageFile, current, { mode: 0o600 });
  await assert.rejects(service.restoreBackup(backup.id), { code: "RESTORE_CONFIRMATION_REQUIRED" });
  const lockPath = `${storageFile}.lock`;
  const lockText = JSON.stringify({ version: 1, pid: process.pid, token: "active-synthetic-lock" });
  await fs.writeFile(lockPath, lockText, { mode: 0o600 });
  await assert.rejects(service.restoreBackup(backup.id, { confirmed: true }), { code: "RESTORE_STORAGE_LOCKED" });
  assert.equal(await fs.readFile(storageFile, "utf8"), current);
  assert.equal(await fs.readFile(lockPath, "utf8"), lockText);
});

test("restore validates backup, writes recovery copy, and atomically replaces isolated synthetic storage", async t => {
  const { root, storageFile, backupDir, service } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const restoreState = stateWith("restore-target");
  await fs.writeFile(storageFile, `${JSON.stringify(restoreState)}\n`, { mode: 0o600 });
  const backup = await service.createBackup();
  const newerLive = `${JSON.stringify(stateWith("newer-current"))}\n`;
  await fs.writeFile(storageFile, newerLive, { mode: 0o600 });
  const result = await service.restoreBackup(backup.id, { confirmed: true });
  assert.equal(result.restored, true);
  assert.equal(JSON.parse(await fs.readFile(storageFile, "utf8")).records[0]._id, "restore-target");
  assert.equal(result.recoveryCopy.storageValid, true);
  assert.equal(await fs.readFile(path.join(backupDir, `${result.recoveryCopy.id}.json`), "utf8"), newerLive);
  assert.equal(await fs.access(`${storageFile}.lock`).then(() => true, () => false), false);
  const files = await fs.readdir(path.dirname(storageFile));
  assert.equal(files.some(name => name.endsWith(".tmp")), false);
});

test("restore rejects newer live format before changing it", async t => {
  const { root, storageFile, service } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const backup = await service.createBackup();
  const newer = JSON.stringify({ version: 2, records: [] });
  await fs.writeFile(storageFile, newer, { mode: 0o600 });
  await assert.rejects(service.restoreBackup(backup.id, { confirmed: true }), { code: "RESTORE_OLDER_THAN_LIVE" });
  assert.equal(await fs.readFile(storageFile, "utf8"), newer);
});

test("restore rejects a tampered candidate before preserving or changing live storage", async t => {
  const { root, storageFile, backupDir, service } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const backup = await service.createBackup();
  const original = `${JSON.stringify(stateWith("must-remain-live"))}\n`;
  await fs.writeFile(storageFile, original, { mode: 0o600 });
  await fs.writeFile(path.join(backupDir, `${backup.id}.json`), JSON.stringify(stateWith("tampered")), { mode: 0o600 });
  await assert.rejects(service.restoreBackup(backup.id, { confirmed: true }), { code: "BACKUP_CHECKSUM_MISMATCH" });
  assert.equal(await fs.readFile(storageFile, "utf8"), original);
  assert.deepEqual(await service.listRecoveryCopies(), []);
});

test("restore preserves corrupt current bytes in a non-restorable recovery copy", async t => {
  const { root, storageFile, backupDir, service } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const backup = await service.createBackup();
  const corrupt = "{corrupt-current";
  await fs.writeFile(storageFile, corrupt, { mode: 0o600 });
  const result = await service.restoreBackup(backup.id, { confirmed: true });
  assert.equal(result.recoveryCopy.storageValid, false);
  assert.equal(await fs.readFile(path.join(backupDir, `${result.recoveryCopy.id}.json`), "utf8"), corrupt);
});

test("lists and restores verified recovery copies while excluding invalid recovery data", async t => {
  const { root, storageFile, service } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const backup = await service.createBackup();
  const currentState = `${JSON.stringify(stateWith("current-before-restore"))}\n`;
  await fs.writeFile(storageFile, currentState, { mode: 0o600 });
  const restored = await service.restoreBackup(backup.id, { confirmed: true });
  const recoveryCopies = await service.listRecoveryCopies();
  assert.equal(recoveryCopies.length, 1);
  assert.equal(recoveryCopies[0].id, restored.recoveryCopy.id);
  assert.equal((await service.verifyBackup(restored.recoveryCopy.id)).id, restored.recoveryCopy.id);
  await service.restoreBackup(restored.recoveryCopy.id, { confirmed: true });
  assert.equal(JSON.parse(await fs.readFile(storageFile, "utf8")).records[0]._id, "current-before-restore");
});

test("backup CLI creates, lists, verifies, and refuses non-interactive restore", async t => {
  const { root, storageFile, backupDir } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const script = path.join(__dirname, "..", "scripts", "storageBackup.js");
  const env = { PATH: process.env.PATH, NODE_ENV: "test", STORAGE_FILE: storageFile, BACKUP_DIR: backupDir, BACKUP_RETENTION_COUNT: "14" };
  const run = (...args) => spawnSync(process.execPath, [script, ...args], {
    cwd: path.join(__dirname, ".."), env, encoding: "utf8", timeout: 10_000
  });
  const created = run("create");
  assert.equal(created.status, 0, created.stderr);
  const createdResult = JSON.parse(created.stdout);
  const listed = run("list");
  assert.equal(listed.status, 0, listed.stderr);
  assert.ok(JSON.parse(listed.stdout).backups.some(item => item.id === createdResult.id));
  const verified = run("verify", createdResult.id);
  assert.equal(verified.status, 0, verified.stderr);
  assert.equal(JSON.parse(verified.stdout).id, createdResult.id);
  const original = await fs.readFile(storageFile, "utf8");
  const restore = run("restore", createdResult.id);
  assert.equal(restore.status, 1);
  assert.match(restore.stderr, /RESTORE_CONFIRMATION_REQUIRED/);
  assert.equal(await fs.readFile(storageFile, "utf8"), original);
});
