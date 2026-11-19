"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { JsonFileVisitorRepository } = require("../src/db/jsonFileRepository");

const requestedSizes = process.argv.slice(2).length ? process.argv.slice(2).map(Number) : [100];
if (requestedSizes.some(size => !Number.isInteger(size) || size < 1 || size > 10_000)) {
  process.stderr.write("Usage: node scripts/storageLoadTest.js [synthetic-base-size ...] (each size: 1-10000)\n");
  process.exitCode = 2;
} else {
  run().catch(() => {
    process.stderr.write("Synthetic storage load check failed; inspect the failure code locally. No live storage path was used.\n");
    process.exitCode = 1;
  });
}

async function run() {
  const scratchRoot = path.join(__dirname, "..", `.readiness-load-${process.pid}-${Date.now()}`);
  await fs.mkdir(scratchRoot, { mode: 0o700 });
  try {
    const results = [];
    for (const baseCount of requestedSizes) {
      const storageFile = path.join(scratchRoot, `synthetic-${baseCount}.json`);
      const records = Array.from({ length: baseCount }, (_, index) => syntheticRecord(baseCount, index));
      await fs.writeFile(storageFile, JSON.stringify({ version: 1, records }), { mode: 0o600, flag: "wx" });
      let repository;
      try {
        repository = await JsonFileVisitorRepository.open(storageFile);
        const rssBefore = process.memoryUsage().rss;
        const insertCount = Math.min(10, Math.max(1, Math.ceil(baseCount / 1000)));
        const startedAt = performance.now();
        for (let index = 0; index < insertCount; index += 1) {
          await repository.insert(syntheticRecord(baseCount, baseCount + index));
        }
        const insertMs = performance.now() - startedAt;
        const readStartedAt = performance.now();
        const expectedCount = baseCount + insertCount;
        const history = await repository.history({ page: 1, limit: Math.min(expectedCount, 100) });
        const overview = await repository.overview(new Date(Date.UTC(2025, 0, 2)));
        const readMs = performance.now() - readStartedAt;
        const stat = await fs.stat(storageFile);
        if (history.total !== expectedCount || overview.totalVisitors !== expectedCount) {
          throw new Error(`Synthetic record count did not round-trip for base size ${baseCount}.`);
        }
        results.push({
          result: "PASS",
          baseRecords: baseCount,
          measuredInserts: insertCount,
          totalInsertMs: Number(insertMs.toFixed(2)),
          averageInsertMs: Number((insertMs / insertCount).toFixed(3)),
          historyAndOverviewReadMs: Number(readMs.toFixed(2)),
          storageBytes: stat.size,
          rssBeforeBytes: rssBefore,
          rssAfterBytes: process.memoryUsage().rss,
          verifiedTotal: expectedCount
        });
      } finally {
        await repository?.close().catch(() => {});
      }
    }
    results.push(await checkSizeLimit(scratchRoot));
    process.stdout.write(JSON.stringify({
      storage: "isolated synthetic temporary directory under the system temp root",
      note: "Base datasets are seeded directly; measured inserts use the real repository. RSS values are process-wide observations, not per-operation memory measurements.",
      workloads: results
    }, null, 2) + "\n");
  } finally {
    await fs.rm(scratchRoot, { recursive: true, force: true });
  }
}

function syntheticRecord(size, index) {
  return {
    _id: `synthetic-${String(size).padStart(5, "0")}-${String(index).padStart(6, "0")}`,
    createdAt: new Date(Date.UTC(2025, 0, 1) + index * 1000).toISOString(),
    ipMasked: "198.51.100.xxx",
    ipHash: `synthetic-hash-${String(index).padStart(6, "0")}`,
    geo: { country: "Synthetic", city: "Fixture" },
    device: { category: index % 2 ? "mobile" : "desktop" },
    browser: { name: "Synthetic" },
    os: { name: "Synthetic" }
  };
}

async function checkSizeLimit(directory) {
  const oversizedFile = path.join(directory, "synthetic-over-limit.json");
  const handle = await fs.open(oversizedFile, "wx", 0o600);
  await handle.truncate(64 * 1024 * 1024 + 1);
  await handle.close();
  try {
    await JsonFileVisitorRepository.open(oversizedFile);
    throw new Error("Over-limit synthetic file was unexpectedly accepted.");
  } catch (error) {
    if (error.code !== "STORAGE_FILE_INVALID") throw error;
    return { result: "PASS", overLimitBytes: 64 * 1024 * 1024 + 1, observedCode: error.code };
  }
}
