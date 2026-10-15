# P6 — Transactional and recoverable generation

Starting with the next npm beta after 0.2.0-beta.3, both j2e generate and
j2e upgrade use **journaled, same-filesystem directory-swap transactions**.

## Why this exists

Older versions preflighted the manifest and schema constraints, then directly
rewrote generated files one by one. An exception, process kill or machine
interruption could leave a half-replaced generated application.

Now generation takes these steps:

1. Acquire a **per-output exclusive lock** in the output's parent directory.
   A second generator targeting the same output fails immediately.
2. Resolve an interrupted prior journal, if present. Live plans/diffs refuse
   to proceed while a journal or active lock is present.
3. Under the lock, rerun all path, ownership and schema checks.
4. Create a recovery journal and copy the **entire existing output tree**
   into a unique sibling staging directory. This includes unowned .env
   files, installed dependencies and user data. Existing output is untouched.
5. Render every generated file and a matching v2 manifest into staging.
6. Atomically rename the original output to a sibling backup, then rename
   the fully staged directory to the real target. Each rename is atomic on
   the same filesystem, though the two renames are **not one atomic swap**.
7. Write a durable committed journal state **before** deleting the backup,
   then remove the backup and journal and release the lock.

A successful generation has only the new complete tree and its manifest.
Pre-commit failures restore the original. A failure during backup cleanup
cannot restore a partly deleted backup because the committed journal is
written first.

## Crash recovery

If the process crashes or gets SIGKILL, its lock survives temporarily.
The next generate/upgrade automatically reclaims a provably dead local-process
lock and resolves the journal before reading the old manifest.

You can recover without a specification file:

~~~bash
j2e recover --output generated/my-api
j2e plan my-spec.json --output generated/my-api
~~~

Recovery behavior:

| Interrupted phase | Restart action |
| --- | --- |
| During staging | Discard incomplete staging; original remains intact |
| Original moved to backup, no new target yet | Restore complete backup |
| Candidate promoted but commit marker not written | Quarantine candidate, restore backup |
| Committed marker written, backup cleanup interrupted | Finish cleanup and retain new complete project |
| New application promoted with no previous target | Verify and retain complete project |
| Unverifiable/tampered tree or malformed journal | Stop without overwriting; manual review required |

Quarantined candidates use <output>.j2e-interrupted-<id> in the same parent
directory. They are not removed automatically, to avoid silently deleting
user changes made after a crash. Review and delete them manually only
after deciding they contain no useful changes.

Stale locks are reclaimed **only** when their recorded PID is demonstrably
absent on the same host. Live or ambiguous/foreign-host locks fail closed.
Do not forcibly delete lock or journal files while another process is active.

## Guarantees and operational limitations

- Preserves generator-owned file protection, unowned-file protection and
  schema-change approval requirements. An explicit --force still replaces
  only modified generated files, not unowned developer content.
- Each renaming operation is atomic. There can be a short **unavailable
  output-path window** between the backup rename and stage promotion.
  Do not regenerate directly into a directory that a live server needs
  continuously; use a separate deployment switch for zero downtime.
- Staging makes a full copy of the output, including user data, node_modules
  and any runtime files. Reserve **at least one complete output-tree worth
  of free disk space**, and avoid regenerating folders with live database
  files or concurrently mutated uploads. Runtime writes during staging
  cannot be made transactionally consistent by a code generator.
- Assumes the staging, backup and target are siblings on the **same**
  filesystem. Cross-volume atomic promotion is not supported.
- Node and filesystem fsync/rename durability differ by OS/filesystem.
  Process-crash recovery is tested with real SIGKILL at critical boundaries.
  A sudden device or power failure may still require manual inspection.
- The recovery journal records only a transaction ID, phase and digest of
  the generated manifest (no secret environment values).
- Recovery verifies generated file hashes before treating an interrupted
  promoted tree as valid. It refuses automatic repair when those files
  have been modified after interruption.
- The exclusive lock only protects json-to-express generators; it cannot
  stop arbitrary unrelated processes from editing a project directory.

## Validation

Run:

~~~bash
node --test test/transaction.test.js
npm test
npm run test:package
~~~

The dedicated suite injects exceptions and kills independent Node processes
with SIGKILL after staging, backup rename, promotion and commit-marker
creation. It then recovers the project and verifies file snapshots,
developer-owned content, journal removal, quarantine, and lock contention.
The full 44-job compatibility CI matrix retains historical npm upgrades,
live MongoDB/PostgreSQL apps, deployment checks and npm tarball coverage.
