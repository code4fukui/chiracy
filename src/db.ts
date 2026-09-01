import { DatabaseSync } from "node:sqlite";
import { hashPassword } from "./auth.ts";
import migration001 from "../migrations/001_init.sql" with { type: "text" };
import migration002 from "../migrations/002_add_contents.sql" with {
  type: "text",
};
import migration003 from "../migrations/003_add_points_and_metadata.sql" with {
  type: "text",
};
import migration004 from "../migrations/004_add_admin.sql" with {
  type: "text",
};
import migration005 from "../migrations/005_update_content_paths.sql" with {
  type: "text",
};
import migration006 from "../migrations/006_repair_content_paths.sql" with {
  type: "text",
};
import migration007 from "../migrations/007_add_flyers.sql" with {
  type: "text",
};
import migration008 from "../migrations/008_add_plans.sql" with {
  type: "text",
};
import migration009 from "../migrations/009_add_versions.sql" with {
  type: "text",
};
import migration010 from "../migrations/010_add_flyer_request_text.sql" with {
  type: "text",
};
import migration011 from "../migrations/011_add_trash.sql" with {
  type: "text",
};
import migration012 from "../migrations/012_add_apps.sql" with {
  type: "text",
};
import migration013 from "../migrations/013_add_terms_acceptance.sql" with {
  type: "text",
};
import migration014 from "../migrations/014_add_user_level.sql" with {
  type: "text",
};
import migration015 from "../migrations/015_make_contents_user_wide.sql" with {
  type: "text",
};

export type Database = DatabaseSync;

export async function openDatabase(
  path = "data/chiracy.sqlite",
): Promise<Database> {
  if (path !== ":memory:") {
    await Deno.mkdir(new URL("../data", import.meta.url), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) STRICT`);
  const applied = db.prepare(
    "SELECT 1 FROM schema_migrations WHERE version = ?",
  );
  const migration = db.prepare(
    "INSERT INTO schema_migrations(version) VALUES (?)",
  );
  const migrations = [
    ["001_init.sql", migration001],
    ["002_add_contents.sql", migration002],
    ["003_add_points_and_metadata.sql", migration003],
    ["004_add_admin.sql", migration004],
    ["005_update_content_paths.sql", migration005],
    ["006_repair_content_paths.sql", migration006],
    ["007_add_flyers.sql", migration007],
    ["008_add_plans.sql", migration008],
    ["009_add_versions.sql", migration009],
    ["010_add_flyer_request_text.sql", migration010],
    ["011_add_trash.sql", migration011],
    ["012_add_apps.sql", migration012],
    ["013_add_terms_acceptance.sql", migration013],
    ["014_add_user_level.sql", migration014],
    ["015_make_contents_user_wide.sql", migration015],
  ] as const;
  for (const [version, sql] of migrations) {
    if (applied.get(version)) continue;
    db.exec("BEGIN");
    try {
      db.exec(sql);
      migration.run(version);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  if (!db.prepare("SELECT 1 FROM users WHERE id = 'admin'").get()) {
    db.prepare(
      "INSERT INTO users(id, password_hash, is_admin, must_change_password) VALUES (?, ?, 1, 1)",
    ).run("admin", await hashPassword("adminadmin"));
  }
  return db;
}
