"use strict";

const readline = require("node:readline/promises");
const { stdin, stdout } = require("node:process");
const { createStorageBackupService } = require("../src/db/storageBackup");

function output(value) {
  stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main(argv = process.argv.slice(2), env = process.env) {
  if (env.STAGING_MODE === "true" || env.STAGING_EPHEMERAL_STORAGE === "true") {
    throw Object.assign(new Error("Backup and restore CLI operations are disabled in temporary staging mode; staging data is disposable."), { code: "BACKUP_STAGING_DISABLED" });
  }
  const [command, id, ...flags] = argv;
  if (!env.STORAGE_FILE) {
    throw Object.assign(new Error("Set STORAGE_FILE to the intended JSON storage file."), { code: "BACKUP_CONFIG_INVALID" });
  }
  const service = await createStorageBackupService({
    storageFile: env.STORAGE_FILE,
    backupDir: env.BACKUP_DIR,
    retentionCount: env.BACKUP_RETENTION_COUNT
  });

  if (command === "create" && !id) {
    output(await service.createBackup());
    return;
  }
  if (command === "list" && !id) {
    output({ backups: await service.listVerifiedBackups(), recoveryCopies: await service.listRecoveryCopies() });
    return;
  }
  if (command === "verify" && id && flags.length === 0) {
    output(await service.verifyBackup(id));
    return;
  }
  if (command === "restore" && id && flags.length === 0) {
    if (!stdin.isTTY || !stdout.isTTY) {
      throw Object.assign(new Error("Restore requires an interactive terminal and typed confirmation."), { code: "RESTORE_CONFIRMATION_REQUIRED" });
    }
    const prompt = readline.createInterface({ input: stdin, output: stdout });
    try {
      const answer = await prompt.question(`This replaces the live storage file after saving a recovery copy. Type RESTORE ${id} to continue: `);
      if (answer !== `RESTORE ${id}`) {
        throw Object.assign(new Error("Restore confirmation did not match; no restore was performed."), { code: "RESTORE_CONFIRMATION_REQUIRED" });
      }
    } finally {
      prompt.close();
    }
    output(await service.restoreBackup(id, { confirmed: true }));
    return;
  }
  throw Object.assign(new Error("Usage: npm run backup -- <create|list|verify ID|restore ID>; restore accepts a verified backup or valid recovery-copy ID."), { code: "BACKUP_USAGE" });
}

if (require.main === module) {
  main().catch(error => {
    const code = typeof error?.code === "string" && /^[A-Z][A-Z0-9_]+$/.test(error.code) ? error.code : "BACKUP_OPERATION_FAILED";
    console.error(JSON.stringify({ level: "error", event: "storage_backup_failed", code, message: error.message }));
    process.exitCode = 1;
  });
}

module.exports = { main };
