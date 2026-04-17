/**
 * seed-admin.ts — create a PostgreSQL admin (or manager/viewer) user
 * from the command line. Bootstrap helper for fresh deploys where
 * `REQUIRE_MFA=true` + AUTH_USERS-only admin locks the operator out
 * (AUTH_USERS users cannot enroll in MFA — no DB row for the TOTP
 * secret). Documented in CLAUDE.md § Operator State Checklist.
 *
 * Usage:
 *   npm run seed-admin -- --username=robin --password='Winter!2026$Snow' --name='Robin Choudhury'
 *   npm run seed-admin -- --username=robin --password='...' --name='Robin' --role=manager
 *   npm run seed-admin -- --username=robin --password='NewPass!2026$' --name='Robin' --force
 *
 * Without `--force`, the script refuses to overwrite an existing user.
 * With `--force`, it updates the password on an existing row (rolling
 * the password history per HIPAA's no-reuse-of-last-5 rule).
 *
 * Reuses the same `hashPasswordForDb` scrypt helper + `createDbUserSchema`
 * Zod validator the `/api/users` admin route uses, so the resulting row
 * is byte-for-byte identical to one created through the UI.
 *
 * Requires `DATABASE_URL` in the environment.
 */
import "dotenv/config";
import { hashPasswordForDb } from "./server/auth";
import { storage } from "./server/storage";
import { initializeDatabase, closePool } from "./server/db/pool";
import { createDbUserSchema } from "./shared/schema";

interface Args {
  username?: string;
  password?: string;
  name?: string;
  role?: "admin" | "manager" | "viewer";
  force?: boolean;
  help?: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (const raw of argv) {
    if (raw === "--help" || raw === "-h") { out.help = true; continue; }
    if (raw === "--force") { out.force = true; continue; }
    const m = /^--([a-zA-Z-]+)=(.*)$/.exec(raw);
    if (!m) continue;
    const key = m[1];
    const value = m[2];
    switch (key) {
      case "username": out.username = value; break;
      case "password": out.password = value; break;
      case "name":
      case "display-name":
      case "displayName":
        out.name = value;
        break;
      case "role":
        if (value === "admin" || value === "manager" || value === "viewer") {
          out.role = value;
        } else {
          throw new Error(`Invalid --role=${value}. Must be admin | manager | viewer.`);
        }
        break;
    }
  }
  return out;
}

function printUsage() {
  console.log(`
seed-admin — create a DB-backed admin/manager/viewer user

Usage:
  npm run seed-admin -- --username=<user> --password=<pw> --name=<displayName> [--role=admin|manager|viewer] [--force]

Required:
  --username     Login username (typically an email).
  --password     Password. Must meet HIPAA complexity (12+ chars, upper,
                 lower, digit, special). Quote it in the shell so special
                 chars like ! $ & don't get interpreted.
  --name         Display name shown in the UI.

Optional:
  --role=admin   Role (default: admin). One of admin | manager | viewer.
  --force        Update password + role on existing user. Without this,
                 an existing username is rejected with an error.

Example:
  npm run seed-admin -- \\
    --username=robin \\
    --password='Winter!2026$Snow' \\
    --name='Robin Choudhury'
`.trim());
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    process.exit(0);
  }

  // Defaults + required-field checks before we touch the DB.
  const role = args.role ?? "admin";
  if (!args.username || !args.password || !args.name) {
    console.error("Error: --username, --password, and --name are required.\n");
    printUsage();
    process.exit(1);
  }

  // Reuse the same Zod validator /api/users uses so complexity rules
  // match the UI path exactly.
  const validation = createDbUserSchema.safeParse({
    username: args.username,
    password: args.password,
    role,
    displayName: args.name,
  });
  if (!validation.success) {
    console.error("Validation failed:");
    for (const issue of validation.error.issues) {
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error("Error: DATABASE_URL is not set. seed-admin requires PostgreSQL.");
    process.exit(1);
  }

  try {
    // Run migrations so `users` table exists on a totally-fresh deploy.
    await initializeDatabase();

    const existing = await storage.getDbUserByUsername(args.username);
    const passwordHash = await hashPasswordForDb(args.password);

    if (existing && !args.force) {
      console.error(
        `Error: user "${args.username}" already exists. Use --force to update the password.`,
      );
      process.exit(2);
    }

    if (existing && args.force) {
      // Update role + displayName if they changed, then rotate password
      // using the history-aware helper so we don't silently bypass the
      // "no-reuse-of-last-5" HIPAA rule on any FUTURE password set.
      await storage.updateDbUser(existing.id, {
        role,
        displayName: args.name,
        active: true,
      });
      const ok = await storage.updateDbUserPassword(existing.id, passwordHash);
      if (!ok) {
        console.error(
          `Error: password update blocked. The new password was used in the last 5 and was rejected by the history check.`,
        );
        process.exit(3);
      }
      console.log(
        `OK: updated ${role} user "${args.username}" (id=${existing.id}).`,
      );
    } else {
      const created = await storage.createDbUser({
        username: args.username,
        passwordHash,
        role,
        displayName: args.name,
      });
      console.log(
        `OK: created ${role} user "${created.username}" (id=${created.id}).`,
      );
    }

    console.log(
      "\nNext steps:\n" +
      "  1. Log in with the credentials above.\n" +
      "  2. If REQUIRE_MFA=true, the MFA setup dialog will appear on first login.\n" +
      "  3. Scan the QR code with an authenticator app and save the recovery codes\n" +
      "     shown exactly once — they are scrypt-hashed at rest.\n",
    );
  } catch (err) {
    console.error("Unexpected error:", (err as Error).message);
    process.exit(10);
  } finally {
    await closePool().catch(() => { /* best-effort */ });
  }
}

main();
