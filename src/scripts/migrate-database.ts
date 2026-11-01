import { spawnSync } from "node:child_process";
import { Client } from "pg";

const featureMigration = "20261101090000_email_verification";
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) throw new Error("DATABASE_URL is required to prepare the database");

const client = new Client({ connectionString: databaseUrl });
await client.connect();
let schemaState: {
  hasUsers: boolean;
  hasVerificationColumn: boolean;
  hasTokenTable: boolean;
  migrationRecorded: boolean;
};
try {
  const result = await client.query<{
    hasusers: boolean;
    hasverificationcolumn: boolean;
    hastokentable: boolean;
    hasmigrationtable: boolean;
  }>(`
    SELECT
      to_regclass('public.users') IS NOT NULL AS hasUsers,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'email_verified'
      ) AS hasVerificationColumn,
      to_regclass('public.email_verification_tokens') IS NOT NULL AS hasTokenTable,
      to_regclass('public._prisma_migrations') IS NOT NULL AS hasMigrationTable
  `);
  let migrationRecorded = false;
  if (result.rows[0]!.hasmigrationtable) {
    const migrationResult = await client.query<{ recorded: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name = $1 AND finished_at IS NOT NULL) AS recorded",
      [featureMigration],
    );
    migrationRecorded = migrationResult.rows[0]!.recorded;
  }
  schemaState = {
    hasUsers: result.rows[0]!.hasusers,
    hasVerificationColumn: result.rows[0]!.hasverificationcolumn,
    hasTokenTable: result.rows[0]!.hastokentable,
    migrationRecorded,
  };
} finally {
  await client.end();
}

if (!schemaState.hasUsers) {
  // A brand-new local database needs the existing schema bootstrap. No data-loss flag is used.
  runPrisma("db", "push");
  runPrisma("migrate", "resolve", "--applied", featureMigration);
} else if (schemaState.hasVerificationColumn && schemaState.hasTokenTable) {
  // An existing db-push-managed database already has this feature's schema.
  if (!schemaState.migrationRecorded) {
    runPrisma("migrate", "resolve", "--applied", featureMigration);
  }
} else {
  // Existing users receive the migration's verified backfill before API startup.
  runPrisma("migrate", "deploy");
}

function runPrisma(...args: string[]) {
  const result = spawnSync("pnpm", ["exec", "prisma", ...args], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
