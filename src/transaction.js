'use strict';

// All transactional paths live next to the output directory on the same
// filesystem. A single rename installs a complete staged project tree.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const JOURNAL_VERSION = 1;
const MANIFEST_NAME = '.j2e-manifest.json';
const ID = /^[a-f0-9]{8}-[a-f0-9-]{27,40}$/i;

function locations(outputDir) {
  const target = path.resolve(outputDir);
  return {
    target,
    parent: path.dirname(target),
    lock: target + '.j2e-lock',
    journal: target + '.j2e-transaction.json'
  };
}
function exists(p) {
  try {fs.lstatSync(p); return true;}
  catch (e) {if (e.code === 'ENOENT') return false; throw e;}
}
function assertDirectoryOrAbsent(p) {
  if (!exists(p)) return false;
  if (!fs.lstatSync(p).isDirectory()) throw new Error('Unsafe transaction directory: ' + p);
  return true;
}
function assertRegularFileOrAbsent(p) {
  if (!exists(p)) return false;
  if (!fs.lstatSync(p).isFile()) throw new Error('Unsafe transaction file: ' + p);
  return true;
}
function syncFile(filename) {
  const fd = fs.openSync(filename, 'r');
  try {fs.fsyncSync(fd);}
  finally {fs.closeSync(fd);}
}
function syncParent(dirname) {
  // fsync() on a directory is not supported by every filesystem/Windows.
  try {
    const fd = fs.openSync(dirname, 'r');
    try {fs.fsyncSync(fd);}
    finally {fs.closeSync(fd);}
  } catch (e) {
    if (!['EINVAL', 'EPERM', 'EISDIR', 'ENOTSUP', 'EACCES'].includes(e.code)) throw e;
  }
}
function writeNewJson(filename, value) {
  const fd = fs.openSync(filename, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(value) + '\n', 'utf8');
    fs.fsyncSync(fd);
  } finally {fs.closeSync(fd);}
  syncParent(path.dirname(filename));
}
function updateJournal(filename, value) {
  const replacement = filename + '.tmp-' + process.pid + '-' + crypto.randomUUID();
  try {
    writeNewJson(replacement, value);
    fs.renameSync(replacement, filename);
    syncParent(path.dirname(filename));
  } finally {if (exists(replacement)) fs.rmSync(replacement);}
}
function readJournal(outputDir) {
  const {journal} = locations(outputDir);
  if (!assertRegularFileOrAbsent(journal)) return null;
  let record;
  try {record = JSON.parse(fs.readFileSync(journal, 'utf8'));}
  catch (e) {throw new Error('Invalid recovery journal (manual inspection required): ' + e.message);}
  if (!record || record.version !== JOURNAL_VERSION || !ID.test(record.id) ||
      !['preparing', 'committed'].includes(record.phase) ||
      typeof record.hadTarget !== 'boolean' ||
      typeof record.manifestHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(record.manifestHash)) {
    throw new Error('Invalid recovery journal: refusing automatic recovery');
  }
  return record;
}
function statePaths(outputDir, record) {
  const {target} = locations(outputDir);
  return {
    stage: target + '.j2e-stage-' + record.id,
    backup: target + '.j2e-backup-' + record.id,
    quarantine: target + '.j2e-interrupted-' + record.id
  };
}
function assertExpectedProject(directory, record) {
  if (!assertDirectoryOrAbsent(directory)) throw new Error('Interrupted project disappeared: ' + directory);
  const manifest = path.join(directory, MANIFEST_NAME);
  if (!assertRegularFileOrAbsent(manifest) ||
      crypto.createHash('sha256').update(fs.readFileSync(manifest)).digest('hex') !== record.manifestHash) {
    throw new Error('Interrupted project was modified: refusing to overwrite or discard ' + directory);
  }
  const parsed = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  if (!parsed.files || typeof parsed.files !== 'object') throw new Error('Invalid interrupted project manifest');
  for (const [relative, digest] of Object.entries(parsed.files)) {
    if (!relative || path.posix.normalize(relative) !== relative || relative.startsWith('../') ||
        path.posix.isAbsolute(relative) || relative.includes('\\') ||
        !/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid interrupted project file');
    const file = path.join(directory, relative);
    if (!assertRegularFileOrAbsent(file) ||
        crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== digest) {
      throw new Error('Interrupted generated file was modified: ' + relative + '; manual recovery required');
    }
  }
}
function removeDirectory(p) {
  if (assertDirectoryOrAbsent(p)) fs.rmSync(p, {recursive: true, force: false});
}
function recoverLocked(outputDir) {
  const {target, parent, journal} = locations(outputDir);
  const record = readJournal(target);
  if (!record) return {status: 'clean'};
  const {stage, backup, quarantine} = statePaths(target, record);
  // Never follow symlinks planted under transaction control paths.
  assertDirectoryOrAbsent(stage);
  assertDirectoryOrAbsent(backup);
  assertDirectoryOrAbsent(target);
  if (exists(quarantine)) throw new Error('Recovery quarantine already exists: ' + quarantine);
  const hasBackup = exists(backup);
  const hasTarget = exists(target);
  if (record.phase === 'committed') {
    if (!hasTarget) throw new Error('Committed project is missing; recovery requires manual inspection');
    assertExpectedProject(target, record);
    removeDirectory(backup);
    removeDirectory(stage);
    fs.rmSync(journal);
    syncParent(parent);
    return {status: 'committed'};
  }
  if (hasBackup) {
    if (hasTarget) {
      // Keep a promoted tree for inspection, including changes made by a
      // process after the crash. Nothing is silently deleted.
      assertExpectedProject(target, record);
      fs.renameSync(target, quarantine);
    }
    fs.renameSync(backup, target);
    syncParent(parent);
    removeDirectory(stage);
    fs.rmSync(journal);
    syncParent(parent);
    return {status: 'rolled-back', ...(hasTarget ? {quarantine} : {})};
  }
  if (record.hadTarget) {
    if (!hasTarget) throw new Error('Original project missing without a backup; manual recovery required');
    // Crash before moving the original tree: it is still untouched.
    removeDirectory(stage);
    fs.rmSync(journal);
    syncParent(parent);
    return {status: 'aborted-staging'};
  }
  if (hasTarget) {
    // New project already atomically promoted: leave the complete tree.
    assertExpectedProject(target, record);
    removeDirectory(stage);
    fs.rmSync(journal);
    syncParent(parent);
    return {status: 'committed-new'};
  }
  removeDirectory(stage);
  fs.rmSync(journal);
  syncParent(parent);
  return {status: 'aborted-staging'};
}
function lockIsDead(filename) {
  if (!assertRegularFileOrAbsent(filename)) return false;
  let holder;
  try {holder = JSON.parse(fs.readFileSync(filename, 'utf8'));}
  catch (_) {return false;} // An active process may still be writing.
  if (!holder || holder.hostname !== os.hostname() || !Number.isInteger(holder.pid) ||
      holder.pid <= 0 || typeof holder.token !== 'string') return false;
  try {process.kill(holder.pid, 0); return false;}
  catch (e) {return e.code === 'ESRCH';}
}
function withOutputLock(outputDir, fn) {
  const {parent, lock} = locations(outputDir);
  // Generated files are never changed before the lock is acquired.
  fs.mkdirSync(parent, {recursive: true});
  const token = crypto.randomUUID();
  let fd;
  for (let tries = 0; tries < 3; tries++) {
    try {fd = fs.openSync(lock, 'wx', 0o600); break;}
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (!lockIsDead(lock)) throw new Error('Generation locked by another process: ' + lock);
      const original = fs.lstatSync(lock);
      if (!lockIsDead(lock)) throw new Error('Generation locked by another process: ' + lock);
      const current = fs.lstatSync(lock);
      if (current.ino !== original.ino || current.dev !== original.dev)
        throw new Error('Generation lock changed while recovering: ' + lock);
      fs.rmSync(lock);
    }
  }
  if (fd === undefined) throw new Error('Could not acquire generation lock: ' + lock);
  try {
    fs.writeFileSync(fd, JSON.stringify({pid: process.pid, hostname: os.hostname(), token}) + '\n');
    fs.fsyncSync(fd);
    return fn();
  } finally {
    fs.closeSync(fd);
    if (assertRegularFileOrAbsent(lock)) {
      let own = false;
      try {own = JSON.parse(fs.readFileSync(lock, 'utf8')).token === token;}
      catch (_) {/* Leave a foreign or broken lock for manual review. */}
      if (own) fs.rmSync(lock);
    }
  }
}
function assertCleanTransaction(outputDir) {
  const {lock, journal} = locations(outputDir);
  if (exists(journal)) throw new Error('Interrupted generation exists. Run j2e recover --output ' + outputDir);
  if (exists(lock)) {
    throw new Error('Generation lock exists. Run j2e recover --output ' + outputDir +
      ' after any active generation completes');
  }
}
function recoverTransaction(outputDir) {
  return withOutputLock(outputDir, () => recoverLocked(outputDir));
}
function swapProject(outputDir, manifestText, writeStage, {fault} = {}) {
  const {target, parent, journal} = locations(outputDir);
  if (exists(journal)) throw new Error('Recovery required before new generation');
  const id = crypto.randomUUID();
  const record = {version: JOURNAL_VERSION, id, phase: 'preparing',
    hadTarget: assertDirectoryOrAbsent(target),
    manifestHash: crypto.createHash('sha256').update(manifestText).digest('hex')};
  const {stage, backup} = statePaths(target, record);
  if (exists(stage) || exists(backup)) throw new Error('Transaction ID collision');
  const inject = phase => {if (typeof fault === 'function') fault(phase);};
  writeNewJson(journal, record);
  try {
    if (record.hadTarget) {
      fs.cpSync(target, stage, {recursive: true, dereference: false, errorOnExist: true,
        force: false, verbatimSymlinks: true});
    } else fs.mkdirSync(stage);
    writeStage(stage);
    syncFile(path.join(stage, MANIFEST_NAME));
    syncParent(stage);
    inject('after-stage');
    if (record.hadTarget) {
      fs.renameSync(target, backup);
      syncParent(parent);
    }
    inject('after-backup');
    fs.renameSync(stage, target);
    syncParent(parent);
    inject('after-promote');
    // Commit marker precedes backup cleanup, so a crash during cleanup
    // cannot roll back from a partially deleted backup.
    updateJournal(journal, {...record, phase: 'committed'});
    inject('after-commit');
    removeDirectory(backup);
    fs.rmSync(journal);
    syncParent(parent);
  } catch (error) {
    try {recoverLocked(target);}
    catch (recovery) {
      error.message += ' (automatic recovery failed: ' + recovery.message + ')';
    }
    throw error;
  }
}
module.exports = {locations, readJournal, assertCleanTransaction, withOutputLock,
  recoverLocked, recoverTransaction, swapProject};
