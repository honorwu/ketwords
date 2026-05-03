const fs = require("node:fs");
const path = require("node:path");

const BACKUP_CHECK_INTERVAL_MS = 60 * 60 * 1000;

function dateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function cleanupOldBackups(backupDir, retentionDays) {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    return;
  }

  if (!fs.existsSync(backupDir)) {
    return;
  }

  const cutoff = Date.now() - retentionDays * 86400000;

  for (const file of fs.readdirSync(backupDir)) {
    if (!/^ketwords-\d{4}-\d{2}-\d{2}(?:-wordbank)?\.sqlite/.test(file)) {
      continue;
    }

    const fullPath = path.join(backupDir, file);
    const stats = fs.statSync(fullPath);

    if (stats.mtimeMs < cutoff) {
      fs.rmSync(fullPath, { force: true });
    }
  }
}

function createBackupScheduler(store, { backupDir, retentionDays }) {
  function runDatabaseBackup(reason = "daily") {
    if (process.env.KET_AUTO_BACKUP === "0") {
      return;
    }

    const backupPath = path.join(backupDir, `ketwords-${dateKey()}.sqlite`);

    if (fs.existsSync(backupPath)) {
      return;
    }

    const savedPath = store.backupDatabase(backupPath);
    cleanupOldBackups(backupDir, retentionDays);
    console.log(`学习数据已备份（${reason}）：${savedPath}`);
  }

  return function startBackupScheduler() {
    runDatabaseBackup("startup");
    setInterval(() => runDatabaseBackup("daily"), BACKUP_CHECK_INTERVAL_MS).unref();
  };
}

module.exports = {
  createBackupScheduler,
};
