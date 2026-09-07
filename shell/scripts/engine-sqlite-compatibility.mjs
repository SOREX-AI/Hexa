import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

function replaceRequired(text, anchor, replacement, label) {
  if (!text.includes(anchor)) throw new Error(`Cannot apply Hexa SQLite compatibility patch: ${label}`);
  return text.replace(anchor, replacement);
}

export async function applyHexaSqliteCompatibility(engineRoot) {
  const manifestPath = path.join(engineRoot, 'state', 'Cargo.toml');
  let manifest = await readFile(manifestPath, 'utf8');
  if (!manifest.includes('sha2 = { workspace = true }')) {
    manifest = replaceRequired(manifest, 'serde_json = { workspace = true }\n', 'serde_json = { workspace = true }\nsha2 = { workspace = true }\n', 'state dependency list changed');
    await writeFile(manifestPath, manifest);
  }

  const migrationsPath = path.join(engineRoot, 'state', 'src', 'migrations.rs');
  let migrations = await readFile(migrationsPath, 'utf8');
  if (!migrations.includes('repair_line_ending_migration_checksums')) {
    migrations = replaceRequired(migrations, 'use sqlx::SqlitePool;\n', 'use sha2::Digest;\nuse sha2::Sha384;\nuse sqlx::SqlitePool;\n', 'migration imports changed');
    migrations = replaceRequired(
      migrations,
      'pub(crate) async fn repair_legacy_recency_migration_version(',
      `/// Repair checksums produced from the same SQL with a different checkout line
/// ending. Git may materialize migrations as CRLF on Windows and LF elsewhere;
/// that must not make an otherwise identical runtime database unopenable.
pub(crate) async fn repair_line_ending_migration_checksums(
    pool: &SqlitePool,
    migrator: &Migrator,
) -> anyhow::Result<()> {
    let migrations_table_exists = sqlx::query_scalar::<_, i64>(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_sqlx_migrations'",
    )
    .fetch_optional(pool)
    .await?
    .is_some();
    if !migrations_table_exists {
        return Ok(());
    }

    for migration in migrator.migrations.iter() {
        let Some(applied_checksum) = sqlx::query_scalar::<_, Vec<u8>>(
            "SELECT checksum FROM _sqlx_migrations WHERE version = ? AND success = TRUE",
        )
        .bind(migration.version)
        .fetch_optional(pool)
        .await?
        else {
            continue;
        };
        if applied_checksum.as_slice() == migration.checksum.as_ref() {
            continue;
        }

        let normalized_lf = migration.sql.as_str().replace("\\r\\n", "\\n").replace('\\r', "\\n");
        let normalized_crlf = normalized_lf.replace('\\n', "\\r\\n");
        let lf_checksum = Sha384::digest(normalized_lf.as_bytes());
        let crlf_checksum = Sha384::digest(normalized_crlf.as_bytes());
        if applied_checksum.as_slice() != lf_checksum.as_slice()
            && applied_checksum.as_slice() != crlf_checksum.as_slice()
        {
            continue;
        }

        sqlx::query("UPDATE _sqlx_migrations SET checksum = ? WHERE version = ? AND checksum = ?")
            .bind(migration.checksum.as_ref())
            .bind(migration.version)
            .bind(applied_checksum)
            .execute(pool)
            .await?;
    }
    Ok(())
}

pub(crate) async fn repair_legacy_recency_migration_version(`,
      'legacy migration repair anchor changed',
    );
    await writeFile(migrationsPath, migrations);
  }

  const sqlitePath = path.join(engineRoot, 'state', 'src', 'sqlite.rs');
  let sqlite = await readFile(sqlitePath, 'utf8');
  if (!sqlite.includes('use crate::migrations::repair_line_ending_migration_checksums;')) {
    sqlite = replaceRequired(sqlite, 'use crate::migrations::repair_legacy_recency_migration_version;\n', 'use crate::migrations::repair_legacy_recency_migration_version;\nuse crate::migrations::repair_line_ending_migration_checksums;\n', 'SQLite migration import changed');
  }
  if (!sqlite.includes('repair_line_ending_migration_checksums(&pool, migrator).await?;')) {
    sqlite = replaceRequired(sqlite, '        let migrate_result = async {\n', '        let migrate_result = async {\n            repair_line_ending_migration_checksums(&pool, migrator).await?;\n', 'SQLite migration startup changed');
  }
  await writeFile(sqlitePath, sqlite);
}
