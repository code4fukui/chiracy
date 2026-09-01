import type { Database } from "./db.ts";
import { openDatabase } from "./db.ts";
import { hashPassword, randomId, verifyPassword } from "./auth.ts";
import {
  type GeneratedImage,
  generateImage,
  generatePlan,
  generateSite,
  type PlanGeneration,
  type SiteGeneration,
} from "./ai.ts";
import QRCode from "qrcode";

const publicRoot = new URL("../public/", import.meta.url);
const sessionMaxAge = 60 * 60 * 24 * 30;
const idPattern = /^[a-zA-Z0-9_-]{3,32}$/;
const maxContentSize = 10 * 1024 * 1024;
const maxChatLength = 10_000;
const allowedContentTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/csv",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  "audio/mp4",
]);

type User = {
  id: string;
  is_admin: number;
  must_change_password: number;
  points: number;
  level: number;
};

function envNumber(name: string, fallback: number): number {
  try {
    const value = Number(Deno.env.get(name));
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

function chargePoints(
  db: Database,
  userId: string,
  kind: "chat" | "image",
  costUsd: number,
): number {
  const rate = envNumber("USD_JPY_RATE", 150);
  const points = Math.max(1, Math.ceil(costUsd * rate * 2));
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE users SET points = MAX(points - ?, 0) WHERE id = ?")
      .run(points, userId);
    db.prepare(
      "INSERT INTO point_usage(user_id, kind, points, cost_usd) VALUES (?, ?, ?, ?)",
    ).run(userId, kind, points, costUsd);
    const remaining = (db.prepare("SELECT points FROM users WHERE id = ?").get(
      userId,
    ) as { points: number }).points;
    db.exec("COMMIT");
    return remaining;
  } catch (cause) {
    db.exec("ROLLBACK");
    throw cause;
  }
}

function json(
  data: unknown,
  status = 200,
  headers: HeadersInit = {},
): Response {
  return Response.json(data, { status, headers });
}

function error(message: string, status = 400): Response {
  return json({ error: message }, status);
}

function contentMetadata(
  row: Record<string, unknown>,
  userId: string,
) {
  return {
    id: row.id,
    name: row.name,
    mime_type: row.mime_type,
    size: row.size,
    source_content_id: row.source_content_id,
    description: row.description,
    prompt: row.prompt,
    created_at: row.created_at,
    url: `/${encodeURIComponent(userId)}/content/${row.id}`,
  };
}

function cookieValue(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

function sessionCookie(id: string, request: Request): string {
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(
    ",",
  )[0].trim();
  const secure = forwardedProtocol === "https" ||
      new URL(request.url).protocol === "https:"
    ? "; Secure"
    : "";
  return `session=${
    encodeURIComponent(id)
  }; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionMaxAge}${secure}`;
}

function currentUser(db: Database, request: Request): User | null {
  const session = cookieValue(request, "session");
  if (!session) return null;
  return (db.prepare(
    `SELECT users.id, users.is_admin, users.must_change_password, users.points,
      MAX(users.level, CASE
        WHEN EXISTS (SELECT 1 FROM flyers WHERE flyers.user_id = users.id)
          OR EXISTS (SELECT 1 FROM sites WHERE sites.user_id = users.id) THEN 3
        WHEN EXISTS (SELECT 1 FROM plans WHERE plans.user_id = users.id) THEN 2
        ELSE 1
      END) AS level
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.id = ? AND sessions.expires_at > CURRENT_TIMESTAMP
      AND users.is_banned = 0`,
  ).get(session) as User | undefined) ?? null;
}

async function body(request: Request): Promise<Record<string, unknown> | null> {
  if (
    !request.headers.get("content-type")?.toLowerCase().startsWith(
      "application/json",
    )
  ) return null;
  try {
    const value = await request.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : null;
  } catch {
    return null;
  }
}

function safeText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(
    ">",
    "&gt;",
  )
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function firstSite(title: string): string {
  const escaped = safeText(title);
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escaped}</title><style>*{box-sizing:border-box}body{margin:0;font-family:system-ui,sans-serif;color:#17202a;background:#f7f3ed}main{min-height:100vh;display:grid;place-content:center;text-align:center;padding:2rem}h1{font-size:clamp(2.5rem,8vw,6rem);margin:0;color:#e0523d}p{font-size:1.2rem}</style></head>
<body><main><h1>${escaped}</h1></main></body></html>`;
}

async function staticFile(path: string): Promise<Response> {
  const files: Record<string, [string, string]> = {
    "/": ["index.html", "text/html; charset=utf-8"],
    "/app.js": ["app.js", "text/javascript; charset=utf-8"],
    "/__admin_internal": ["admin.html", "text/html; charset=utf-8"],
    "/admin.js": ["admin.js", "text/javascript; charset=utf-8"],
    "/terms": ["terms.html", "text/html; charset=utf-8"],
    "/logo.png": ["logo.png", "image/png"],
    "/logo-square.png": ["logo-square.png", "image/png"],
    "/logo-icon.png": ["logo-icon.png", "image/png"],
    "/style.css": ["style.css", "text/css; charset=utf-8"],
  };
  const file = files[path];
  if (!file) return new Response("Not found", { status: 404 });
  try {
    return new Response(await Deno.readFile(new URL(file[0], publicRoot)), {
      headers: { "content-type": file[1] },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

export function createHandler(
  db: Database,
  generate: (
    instruction: string,
    html: string,
    title: string,
  ) => Promise<SiteGeneration> = (instruction, html, title) => {
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
    return generateSite(
      apiKey,
      instruction,
      html,
      title,
      Deno.env.get("OPENAI_MODEL") ?? "gpt-5.6-luna",
      envNumber("OPENAI_TEXT_INPUT_USD_PER_MILLION", 0.2),
      envNumber("OPENAI_TEXT_OUTPUT_USD_PER_MILLION", 1.2),
      envNumber("OPENAI_TEXT_CACHED_INPUT_USD_PER_MILLION", 0.02),
    );
  },
  createImage: (
    prompt: string,
    source?: { data: Uint8Array; mimeType: string; name: string },
    size?: string,
  ) => Promise<GeneratedImage> = (prompt, source, size) => {
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
    return generateImage(
      apiKey,
      prompt,
      Deno.env.get("OPENAI_IMAGE_MODEL") ?? "gpt-image-2",
      source,
      envNumber("OPENAI_IMAGE_COST_USD", 0.034),
      size,
    );
  },
  createPlan: (
    instruction: string,
    markdown: string,
    title: string,
  ) => Promise<PlanGeneration> = (instruction, markdown, title) => {
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
    return generatePlan(
      apiKey,
      instruction,
      markdown,
      title,
      Deno.env.get("OPENAI_MODEL") ?? "gpt-5.6-luna",
      envNumber("OPENAI_TEXT_INPUT_USD_PER_MILLION", 0.2),
      envNumber("OPENAI_TEXT_OUTPUT_USD_PER_MILLION", 1.2),
      envNumber("OPENAI_TEXT_CACHED_INPUT_USD_PER_MILLION", 0.02),
    );
  },
): (request: Request) => Promise<Response> {
  return async (request) => {
    const url = new URL(request.url);
    if (
      request.headers.get("x-forwarded-proto")?.split(",")[0].trim() ===
        "https"
    ) url.protocol = "https:";
    const method = request.method;
    try {
      if (!url.pathname.startsWith("/api/")) {
        const pageUser = url.pathname === "/" ? currentUser(db, request) : null;
        if (pageUser?.is_admin && !pageUser.must_change_password) {
          return staticFile("/__admin_internal");
        }
        const contentMatch = url.pathname.match(
          /^\/([a-zA-Z0-9_-]+)\/content\/([a-zA-Z0-9_-]+)$/,
        );
        if (contentMatch) {
          const content = db.prepare(
            `SELECT contents.name, contents.mime_type, contents.data,
              contents.user_id,
              EXISTS (
                SELECT 1 FROM sites
                WHERE sites.user_id = contents.user_id
                  AND sites.is_published = 1 AND sites.deleted_at IS NULL
                  AND instr(
                    sites.html,
                    '/' || contents.user_id || '/content/' || contents.id
                  ) > 0
              ) AS is_public
             FROM contents
             WHERE contents.user_id = ? AND contents.id = ?`,
          ).get(contentMatch[1], contentMatch[2]) as {
            name: string;
            mime_type: string;
            data: Uint8Array;
            user_id: string;
            is_public: number;
          } | undefined;
          const viewer = currentUser(db, request);
          if (
            !content || (!content.is_public && viewer?.id !== content.user_id)
          ) return new Response("Not found", { status: 404 });
          return new Response(content.data as Uint8Array<ArrayBuffer>, {
            headers: {
              "content-type": content.mime_type,
              "content-disposition": `inline; filename*=UTF-8''${
                encodeURIComponent(content.name)
              }`,
              "x-content-type-options": "nosniff",
              "cache-control": content.is_public
                ? "public, max-age=3600"
                : "private, no-store",
            },
          });
        }
        const published = url.pathname.match(
          /^\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)$/,
        );
        if (published) {
          const site = db.prepare(
            "SELECT html FROM sites WHERE user_id = ? AND id = ? AND is_published = 1 AND deleted_at IS NULL",
          )
            .get(published[1], published[2]) as { html: string } | undefined;
          return site
            ? new Response(site.html, {
              headers: {
                "content-type": "text/html; charset=utf-8",
                "content-security-policy":
                  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' https: data:; media-src 'self'; font-src https: data:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'",
              },
            })
            : new Response("Not found", { status: 404 });
        }
        return staticFile(url.pathname);
      }

      if (url.pathname === "/api/register" && method === "POST") {
        const data = await body(request);
        const id = typeof data?.id === "string" ? data.id.trim() : "";
        const password = typeof data?.password === "string"
          ? data.password
          : "";
        if (data?.acceptedTerms !== true) {
          return error("利用規約への同意が必要です");
        }
        if (!idPattern.test(id)) {
          return error("IDは半角英数字・_・-の3〜32文字で入力してください");
        }
        if (password.length < 8 || password.length > 128) {
          return error("パスワードは8〜128文字で入力してください");
        }
        try {
          const initialPoints = Number(
            (db.prepare(
              "SELECT value FROM settings WHERE key = 'initial_points'",
            ).get() as { value: string }).value,
          );
          db.prepare(
            `INSERT INTO users(id, password_hash, points, terms_accepted_at)
             VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
          ).run(id, await hashPassword(password), initialPoints);
        } catch {
          return error("このIDは使用できません", 409);
        }
        return json({ ok: true }, 201);
      }

      if (url.pathname === "/api/login" && method === "POST") {
        const data = await body(request);
        const id = typeof data?.id === "string" ? data.id : "";
        const password = typeof data?.password === "string"
          ? data.password
          : "";
        const account = db.prepare(
          "SELECT id, password_hash FROM users WHERE id = ? AND is_banned = 0",
        ).get(id) as { id: string; password_hash: string } | undefined;
        if (
          !account || !(await verifyPassword(password, account.password_hash))
        ) return error("Invalid ID or password", 401);
        const session = randomId();
        const expires = new Date(Date.now() + sessionMaxAge * 1000)
          .toISOString();
        db.exec("BEGIN");
        try {
          db.prepare(
            "INSERT INTO sessions(id, user_id, expires_at) VALUES (?, ?, ?)",
          ).run(session, account.id, expires);
          db.prepare(
            "UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?",
          ).run(account.id);
          db.exec("COMMIT");
        } catch (cause) {
          db.exec("ROLLBACK");
          throw cause;
        }
        return json({ ok: true }, 200, {
          "set-cookie": sessionCookie(session, request),
        });
      }

      if (url.pathname === "/api/logout" && method === "POST") {
        const session = cookieValue(request, "session");
        if (session) {
          db.prepare("DELETE FROM sessions WHERE id = ?").run(session);
        }
        return json({ ok: true }, 200, {
          "set-cookie": "session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
        });
      }

      if (url.pathname.startsWith("/api/admin/")) {
        const admin = currentUser(db, request);
        if (!admin?.is_admin || admin.must_change_password) {
          return error("Authentication required", 401);
        }
        if (url.pathname === "/api/admin/users" && method === "GET") {
          return json(
            db.prepare(
              `SELECT users.id, users.points, users.level, users.is_banned,
                users.created_at, users.last_login_at,
                COALESCE((
                  SELECT SUM(point_usage.points) FROM point_usage
                  WHERE point_usage.user_id = users.id
                ), 0) AS total_points_used
               FROM users ORDER BY users.created_at DESC`,
            ).all(),
          );
        }
        if (url.pathname === "/api/admin/settings" && method === "GET") {
          const row = db.prepare(
            "SELECT value FROM settings WHERE key = 'initial_points'",
          ).get() as { value: string };
          return json({ initial_points: Number(row.value) });
        }
        if (url.pathname === "/api/admin/settings" && method === "PUT") {
          const data = await body(request);
          const points = data?.initial_points;
          if (
            typeof points !== "number" || !Number.isSafeInteger(points) ||
            points < 0 || points > 1_000_000
          ) return error("初期ポイントは0〜1000000で指定してください");
          db.prepare(
            `UPDATE settings SET value = ?, updated_at = CURRENT_TIMESTAMP
             WHERE key = 'initial_points'`,
          ).run(String(points));
          return json({ initial_points: points });
        }
        const adminUserMatch = url.pathname.match(
          /^\/api\/admin\/users\/([a-zA-Z0-9_-]+)\/(points|ban)$/,
        );
        if (adminUserMatch?.[2] === "points" && method === "PUT") {
          const data = await body(request);
          const points = data?.points;
          if (
            typeof points !== "number" || !Number.isSafeInteger(points) ||
            points < 0 || points > 1_000_000
          ) return error("ポイントは0〜1000000で指定してください");
          const result = db.prepare(
            "UPDATE users SET points = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
          ).run(points, adminUserMatch[1]);
          if (!result.changes) return error("User not found", 404);
          return json(
            db.prepare("SELECT points FROM users WHERE id = ?").get(
              adminUserMatch[1],
            ),
          );
        }
        if (adminUserMatch?.[2] === "ban" && method === "PUT") {
          const data = await body(request);
          if (typeof data?.banned !== "boolean") {
            return error("banned must be boolean");
          }
          const result = db.prepare(
            "UPDATE users SET is_banned = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
          ).run(data.banned ? 1 : 0, adminUserMatch[1]);
          if (!result.changes) return error("User not found", 404);
          return json({ banned: data.banned });
        }
        return error("Not found", 404);
      }

      const user = currentUser(db, request);
      if (!user) return error("Authentication required", 401);
      if (url.pathname === "/api/me" && method === "GET") {
        return json(user);
      }

      if (url.pathname === "/api/password" && method === "PUT") {
        const data = await body(request);
        const current = typeof data?.currentPassword === "string"
          ? data.currentPassword
          : "";
        const next = typeof data?.newPassword === "string"
          ? data.newPassword
          : "";
        const row = db.prepare("SELECT password_hash FROM users WHERE id = ?")
          .get(user.id) as { password_hash: string };
        if (!(await verifyPassword(current, row.password_hash))) {
          return error("現在のパスワードが違います", 403);
        }
        if (next.length < 8 || next.length > 128) {
          return error("新しいパスワードは8〜128文字で入力してください");
        }
        db.prepare(
          "UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        )
          .run(await hashPassword(next), user.id);
        return json({ ok: true });
      }

      if (user.must_change_password) {
        return error("Password change required", 403);
      }
      if (user.is_admin) {
        return error("管理者アカウントではサイトを作成できません", 403);
      }

      if (url.pathname === "/api/trash" && method === "GET") {
        return json(
          db.prepare(
            `SELECT id, title, deleted_at, 'plan' AS type FROM plans
             WHERE user_id = ? AND deleted_at IS NOT NULL
           UNION ALL
           SELECT id, title, deleted_at, 'flyer' AS type FROM flyers
             WHERE user_id = ? AND deleted_at IS NOT NULL
           UNION ALL
           SELECT id, title, deleted_at, 'site' AS type FROM sites
             WHERE user_id = ? AND deleted_at IS NOT NULL
           ORDER BY deleted_at DESC`,
          ).all(user.id, user.id, user.id),
        );
      }
      const trashRestoreMatch = url.pathname.match(
        /^\/api\/trash\/(plan|flyer|site)\/([a-zA-Z0-9_-]+)\/restore$/,
      );
      if (trashRestoreMatch && method === "POST") {
        const tables = { plan: "plans", flyer: "flyers", site: "sites" };
        const table = tables[trashRestoreMatch[1] as keyof typeof tables];
        const result = db.prepare(
          `UPDATE ${table} SET deleted_at = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL`,
        ).run(trashRestoreMatch[2], user.id);
        if (!result.changes) return error("Item not found", 404);
        return json({ restored: true });
      }
      const deleteMatch = url.pathname.match(
        /^\/api\/(plans|flyers|sites)\/([a-zA-Z0-9_-]+)$/,
      );
      if (deleteMatch && method === "DELETE") {
        const result = db.prepare(
          `UPDATE ${deleteMatch[1]}
           SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
        ).run(deleteMatch[2], user.id);
        if (!result.changes) return error("Item not found", 404);
        return new Response(null, { status: 204 });
      }

      if (url.pathname === "/api/plans" && method === "GET") {
        return json(
          db.prepare(
            `SELECT id, title, markdown != '' AS has_markdown, created_at, updated_at
           FROM plans WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC`,
          ).all(user.id),
        );
      }
      if (url.pathname === "/api/plans" && method === "POST") {
        const id = randomId(9);
        db.exec("BEGIN");
        try {
          db.prepare(
            "INSERT INTO plans(id, user_id, title) VALUES (?, ?, ?)",
          ).run(id, user.id, "無題の企画");
          db.prepare(
            "INSERT INTO plan_messages(plan_id, role, content) VALUES (?, 'assistant', ?)",
          ).run(id, "どんな企画を作りますか？");
          db.prepare(
            "UPDATE users SET level = MAX(level, 2), updated_at = CURRENT_TIMESTAMP WHERE id = ?",
          ).run(user.id);
          db.exec("COMMIT");
        } catch (cause) {
          db.exec("ROLLBACK");
          throw cause;
        }
        return json({ id, level: Math.max(user.level, 2) }, 201);
      }
      const planMatch = url.pathname.match(
        /^\/api\/plans\/([a-zA-Z0-9_-]+)(?:\/(messages))?$/,
      );
      if (planMatch) {
        const plan = db.prepare(
          `SELECT id, title, markdown, created_at, updated_at
           FROM plans WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
        ).get(planMatch[1], user.id) as {
          id: string;
          title: string;
          markdown: string;
          created_at: string;
          updated_at: string;
        } | undefined;
        if (!plan) return error("Plan not found", 404);
        if (!planMatch[2] && method === "GET") {
          return json({
            ...plan,
            messages: db.prepare(
              "SELECT id, role, content, created_at FROM plan_messages WHERE plan_id = ? ORDER BY id",
            ).all(plan.id),
          });
        }
        if (planMatch[2] === "messages" && method === "POST") {
          if (user.points <= 0) return error("ポイントが不足しています", 402);
          const data = await body(request);
          const content = typeof data?.content === "string"
            ? data.content.trim()
            : "";
          if (!content || content.length > maxChatLength) {
            return error("指示は1〜10000文字で入力してください");
          }
          let generated: PlanGeneration;
          try {
            generated = await createPlan(content, plan.markdown, plan.title);
          } catch (cause) {
            console.error("Plan generation failed", cause);
            return error("AIによる企画書生成に失敗しました", 502);
          }
          db.exec("BEGIN");
          try {
            db.prepare(
              "INSERT INTO plan_messages(plan_id, role, content) VALUES (?, 'user', ?)",
            ).run(plan.id, content);
            db.prepare(
              "INSERT INTO plan_messages(plan_id, role, content) VALUES (?, 'assistant', ?)",
            ).run(plan.id, generated.reply);
            db.prepare(
              `UPDATE plans SET title = ?, markdown = ?, updated_at = CURRENT_TIMESTAMP
               WHERE id = ?`,
            ).run(generated.title, generated.markdown, plan.id);
            db.exec("COMMIT");
          } catch (cause) {
            db.exec("ROLLBACK");
            throw cause;
          }
          return json({
            title: generated.title,
            markdown: generated.markdown,
            reply: generated.reply,
            points_remaining: chargePoints(
              db,
              user.id,
              "chat",
              generated.costUsd,
            ),
          });
        }
      }

      if (url.pathname === "/api/flyers" && method === "GET") {
        return json(
          db.prepare(
            `SELECT id, title, image IS NOT NULL AS has_image, created_at, updated_at
           FROM flyers WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC`,
          ).all(user.id),
        );
      }
      if (url.pathname === "/api/flyers" && method === "POST") {
        if (user.level < 2) {
          return error("企画を1つ作るとチラシが解放されます", 403);
        }
        const id = randomId(9);
        db.exec("BEGIN");
        try {
          db.prepare(
            "INSERT INTO flyers(id, user_id, title) VALUES (?, ?, ?)",
          ).run(id, user.id, "無題のチラシ");
          db.prepare(
            "INSERT INTO flyer_messages(flyer_id, role, content) VALUES (?, 'assistant', ?)",
          ).run(id, "どんなチラシを作りますか？");
          db.prepare(
            "UPDATE users SET level = MAX(level, 3), updated_at = CURRENT_TIMESTAMP WHERE id = ?",
          ).run(user.id);
          db.exec("COMMIT");
        } catch (cause) {
          db.exec("ROLLBACK");
          throw cause;
        }
        return json({ id, level: 3 }, 201);
      }

      const flyerVersionsMatch = url.pathname.match(
        /^\/api\/flyers\/([a-zA-Z0-9_-]+)\/versions(?:\/(\d+)\/(restore|image))?$/,
      );
      if (flyerVersionsMatch && method === "GET" && !flyerVersionsMatch[2]) {
        const flyer = db.prepare(
          "SELECT 1 FROM flyers WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
        ).get(flyerVersionsMatch[1], user.id);
        if (!flyer) return error("Flyer not found", 404);
        return json(
          db.prepare(
            `SELECT id, created_at FROM flyer_versions
             WHERE flyer_id = ? ORDER BY id DESC LIMIT 5`,
          ).all(flyerVersionsMatch[1]),
        );
      }
      if (
        flyerVersionsMatch?.[2] && flyerVersionsMatch[3] === "image" &&
        method === "GET"
      ) {
        const version = db.prepare(
          `SELECT flyer_versions.image, flyer_versions.mime_type
           FROM flyer_versions JOIN flyers ON flyers.id = flyer_versions.flyer_id
           WHERE flyer_versions.id = ? AND flyer_versions.flyer_id = ?
             AND flyers.user_id = ? AND flyers.deleted_at IS NULL`,
        ).get(
          Number(flyerVersionsMatch[2]),
          flyerVersionsMatch[1],
          user.id,
        ) as { image: Uint8Array; mime_type: string } | undefined;
        if (!version) return new Response("Not found", { status: 404 });
        return new Response(version.image as Uint8Array<ArrayBuffer>, {
          headers: {
            "content-type": version.mime_type,
            "cache-control": "private, no-store",
            "x-content-type-options": "nosniff",
          },
        });
      }
      if (
        flyerVersionsMatch?.[2] && flyerVersionsMatch[3] === "restore" &&
        method === "POST"
      ) {
        const version = db.prepare(
          `SELECT flyer_versions.title, flyer_versions.image, flyer_versions.mime_type,
             flyer_versions.request_text
           FROM flyer_versions JOIN flyers ON flyers.id = flyer_versions.flyer_id
           WHERE flyer_versions.id = ? AND flyer_versions.flyer_id = ? AND flyers.user_id = ?`,
        ).get(
          Number(flyerVersionsMatch[2]),
          flyerVersionsMatch[1],
          user.id,
        ) as {
          title: string;
          image: Uint8Array;
          mime_type: string;
          request_text: string;
        } | undefined;
        if (!version) return error("Version not found", 404);
        db.prepare(
          `UPDATE flyers SET title = ?, image = ?, mime_type = ?, request_text = ?,
           updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`,
        ).run(
          version.title,
          version.image,
          version.mime_type,
          version.request_text,
          flyerVersionsMatch[1],
          user.id,
        );
        return json({ restored: true });
      }

      const flyerMatch = url.pathname.match(
        /^\/api\/flyers\/([a-zA-Z0-9_-]+)(?:\/(messages|image))?$/,
      );
      if (flyerMatch) {
        const flyer = db.prepare(
          `SELECT id, title, image, mime_type, request_text, created_at, updated_at
           FROM flyers WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
        ).get(flyerMatch[1], user.id) as {
          id: string;
          title: string;
          image: Uint8Array | null;
          mime_type: string | null;
          request_text: string;
          created_at: string;
          updated_at: string;
        } | undefined;
        if (!flyer) return error("Flyer not found", 404);
        if (!flyerMatch[2] && method === "GET") {
          const messages = db.prepare(
            "SELECT id, role, content, created_at FROM flyer_messages WHERE flyer_id = ? ORDER BY id",
          ).all(flyer.id);
          return json({
            id: flyer.id,
            title: flyer.title,
            has_image: Boolean(flyer.image),
            request_text: flyer.request_text,
            created_at: flyer.created_at,
            updated_at: flyer.updated_at,
            messages,
          });
        }
        if (flyerMatch[2] === "image" && method === "GET") {
          if (!flyer.image || !flyer.mime_type) {
            return new Response("Not found", { status: 404 });
          }
          return new Response(flyer.image as Uint8Array<ArrayBuffer>, {
            headers: {
              "content-type": flyer.mime_type,
              "cache-control": "private, no-store",
              "x-content-type-options": "nosniff",
            },
          });
        }
        if (flyerMatch[2] === "messages" && method === "POST") {
          if (user.points <= 0) return error("ポイントが不足しています", 402);
          const data = await body(request);
          const content = typeof data?.content === "string"
            ? data.content.trim()
            : "";
          if (!content || content.length > maxChatLength) {
            return error("指示は1〜10000文字で入力してください");
          }
          const source = flyer.image && flyer.mime_type
            ? {
              data: flyer.image,
              mimeType: flyer.mime_type,
              name: `${flyer.id}.png`,
            }
            : undefined;
          const a4Instruction =
            "標準的なA4縦（210mm × 297mm、縦横比1:√2）の印刷用チラシです。四辺に安全な余白を取り、重要な文字や要素を端へ寄せず、日本語の文字を正確で読みやすくしてください。";
          const prompt = source
            ? `${a4Instruction}\n現在のチラシ画像をベースに、次の修正を反映してください。\n${content}`
            : `${a4Instruction}\n次の内容で、完成品として使えるチラシを1枚作成してください。情報の優先順位が明確なデザインにしてください。\n${content}`;
          let generated: GeneratedImage;
          try {
            generated = await createImage(prompt, source, "1024x1536");
          } catch (cause) {
            console.error("Flyer generation failed", cause);
            const detail = cause instanceof Error ? cause.message : "";
            return error(
              detail
                ? `AIによるチラシ画像生成に失敗しました: ${detail}`
                : "AIによるチラシ画像生成に失敗しました",
              502,
            );
          }
          if (generated.data.length > maxContentSize) {
            return error("生成画像が10MBを超えました", 502);
          }
          const title = flyer.image
            ? flyer.title
            : content.replaceAll(/\s+/g, " ").slice(0, 40);
          const reply = flyer.image
            ? "修正内容をチラシに反映しました。"
            : "チラシを作成しました。修正したい点を教えてください。";
          db.exec("BEGIN");
          try {
            db.prepare(
              "INSERT INTO flyer_messages(flyer_id, role, content) VALUES (?, 'user', ?)",
            ).run(flyer.id, content);
            db.prepare(
              "INSERT INTO flyer_messages(flyer_id, role, content) VALUES (?, 'assistant', ?)",
            ).run(flyer.id, reply);
            db.prepare(
              `UPDATE flyers SET title = ?, image = ?, mime_type = ?,
               updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            ).run(title, generated.data, generated.mimeType, flyer.id);
            db.prepare(
              `INSERT INTO flyer_versions(flyer_id, title, image, mime_type)
               VALUES (?, ?, ?, ?)`,
            ).run(flyer.id, title, generated.data, generated.mimeType);
            db.exec("COMMIT");
          } catch (cause) {
            db.exec("ROLLBACK");
            throw cause;
          }
          return json({
            title,
            reply,
            points_remaining: chargePoints(
              db,
              user.id,
              "image",
              generated.costUsd,
            ),
          });
        }
      }

      if (url.pathname === "/api/sites" && method === "GET") {
        return json(
          db.prepare(
            "SELECT id, title, is_published, created_at, updated_at FROM sites WHERE user_id = ? AND kind = 'site' AND deleted_at IS NULL ORDER BY updated_at DESC",
          ).all(user.id),
        );
      }
      if (url.pathname === "/api/apps" && method === "GET") {
        return json(
          db.prepare(
            "SELECT id, title, is_published, created_at, updated_at FROM sites WHERE user_id = ? AND kind = 'app' AND deleted_at IS NULL ORDER BY updated_at DESC",
          ).all(user.id),
        );
      }
      if (
        (url.pathname === "/api/sites" || url.pathname === "/api/apps") &&
        method === "POST"
      ) {
        if (user.level < 3) {
          return error("チラシを1つ作るとサイトとアプリが解放されます", 403);
        }
        const isApp = url.pathname === "/api/apps";
        const id = randomId(9);
        const title = isApp ? "無題のアプリ" : "無題のサイト";
        const html = firstSite(title);
        db.exec("BEGIN");
        try {
          db.prepare(
            "INSERT INTO sites(id, user_id, title, html, kind) VALUES (?, ?, ?, ?, ?)",
          ).run(id, user.id, title, html, isApp ? "app" : "site");
          db.prepare(
            "INSERT INTO messages(site_id, role, content) VALUES (?, 'assistant', ?)",
          ).run(
            id,
            isApp
              ? "どんなアプリを作りますか？シンプルなゲームなど、遊び方や欲しい機能を教えてください。"
              : "まず、ウェブサイトのタイトルを教えてください。",
          );
          db.prepare(
            "INSERT INTO site_versions(site_id, title, html) VALUES (?, ?, ?)",
          ).run(id, title, html);
          db.exec("COMMIT");
        } catch (cause) {
          db.exec("ROLLBACK");
          throw cause;
        }
        return json({ id }, 201);
      }

      const contentsMatch = url.pathname.match(
        /^\/api\/contents(?:\/(generate))?$/,
      );
      if (contentsMatch) {
        if (!contentsMatch[1] && method === "GET") {
          const rows = db.prepare(
            `SELECT id, name, mime_type, size, source_content_id, description, prompt, created_at
             FROM contents WHERE user_id = ? ORDER BY created_at DESC`,
          ).all(user.id) as Record<string, unknown>[];
          return json(rows.map((row) => contentMetadata(row, user.id)));
        }

        if (!contentsMatch[1] && method === "POST") {
          const declaredSize = Number(request.headers.get("content-length"));
          if (declaredSize > maxContentSize + 1024 * 1024) {
            return error("ファイルは10MB以下にしてください", 413);
          }
          let form: FormData;
          try {
            form = await request.formData();
          } catch {
            return error("アップロードデータが不正です");
          }
          const file = form.get("file");
          if (!(file instanceof File)) {
            return error("ファイルを選択してください");
          }
          if (file.size > maxContentSize) {
            return error("ファイルは10MB以下にしてください", 413);
          }
          if (!allowedContentTypes.has(file.type)) {
            return error("対応していないファイル形式です", 415);
          }
          const id = randomId(12);
          const name = file.name.trim().slice(0, 200) || "content";
          const descriptionValue = form.get("description");
          const description = typeof descriptionValue === "string"
            ? descriptionValue.trim()
            : "";
          if (description.length > 500) {
            return error("付加情報は500文字以内で入力してください");
          }
          const bytes = new Uint8Array(await file.arrayBuffer());
          db.prepare(
            `INSERT INTO contents(id, user_id, name, mime_type, size, data, description)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            id,
            user.id,
            name,
            file.type,
            bytes.length,
            bytes,
            description || null,
          );
          const row = db.prepare(
            `SELECT id, name, mime_type, size, source_content_id, description, prompt, created_at
             FROM contents WHERE id = ?`,
          ).get(id) as Record<string, unknown>;
          return json(contentMetadata(row, user.id), 201);
        }

        if (contentsMatch[1] === "generate" && method === "POST") {
          if (user.points <= 0) return error("ポイントが不足しています", 402);
          const data = await body(request);
          const prompt = typeof data?.prompt === "string"
            ? data.prompt.trim()
            : "";
          if (!prompt || prompt.length > 2000) {
            return error("画像の指示は1〜2000文字で入力してください");
          }
          const sourceId = typeof data?.sourceId === "string"
            ? data.sourceId
            : "";
          let source:
            | { data: Uint8Array; mimeType: string; name: string }
            | undefined;
          if (sourceId) {
            const row = db.prepare(
              `SELECT data, mime_type, name FROM contents
               WHERE id = ? AND user_id = ?
                 AND mime_type IN ('image/png', 'image/jpeg', 'image/webp')`,
            ).get(sourceId, user.id) as {
              data: Uint8Array;
              mime_type: string;
              name: string;
            } | undefined;
            if (!row) return error("加工元の画像が見つかりません", 404);
            source = {
              data: row.data,
              mimeType: row.mime_type,
              name: row.name,
            };
          }
          let generated: GeneratedImage;
          try {
            generated = await createImage(prompt, source);
          } catch (cause) {
            console.error("Image generation failed", cause);
            return error("AIによる画像生成に失敗しました", 502);
          }
          if (generated.data.length > maxContentSize) {
            return error("生成画像が10MBを超えました", 502);
          }
          const id = randomId(12);
          const name = `generated-${
            new Date().toISOString().replaceAll(":", "-")
          }.png`;
          db.prepare(
            `INSERT INTO contents(
              id, user_id, name, mime_type, size, data, source_content_id, prompt
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            id,
            user.id,
            name,
            generated.mimeType,
            generated.data.length,
            generated.data,
            sourceId || null,
            prompt,
          );
          const pointsRemaining = chargePoints(
            db,
            user.id,
            "image",
            generated.costUsd,
          );
          const row = db.prepare(
            `SELECT id, name, mime_type, size, source_content_id, description, prompt, created_at
             FROM contents WHERE id = ?`,
          ).get(id) as Record<string, unknown>;
          return json({
            ...contentMetadata(row, user.id),
            points_remaining: pointsRemaining,
          }, 201);
        }
      }

      const contentApiMatch = url.pathname.match(
        /^\/api\/contents\/([a-zA-Z0-9_-]+)$/,
      );
      if (contentApiMatch && method === "DELETE") {
        const result = db.prepare(
          "DELETE FROM contents WHERE id = ? AND user_id = ?",
        ).run(contentApiMatch[1], user.id);
        if (!result.changes) return error("Content not found", 404);
        return new Response(null, { status: 204 });
      }

      const siteVersionsMatch = url.pathname.match(
        /^\/api\/sites\/([a-zA-Z0-9_-]+)\/versions(?:\/(\d+)\/restore)?$/,
      );
      if (siteVersionsMatch && method === "GET" && !siteVersionsMatch[2]) {
        const site = db.prepare(
          "SELECT 1 FROM sites WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
        ).get(siteVersionsMatch[1], user.id);
        if (!site) return error("Site not found", 404);
        return json(
          db.prepare(
            `SELECT id, title, created_at FROM site_versions
           WHERE site_id = ? ORDER BY id DESC`,
          ).all(siteVersionsMatch[1]),
        );
      }
      if (siteVersionsMatch?.[2] && method === "POST") {
        const version = db.prepare(
          `SELECT site_versions.title, site_versions.html
           FROM site_versions JOIN sites ON sites.id = site_versions.site_id
           WHERE site_versions.id = ? AND site_versions.site_id = ?
             AND sites.user_id = ? AND sites.deleted_at IS NULL`,
        ).get(
          Number(siteVersionsMatch[2]),
          siteVersionsMatch[1],
          user.id,
        ) as { title: string; html: string } | undefined;
        if (!version) return error("Version not found", 404);
        db.prepare(
          `UPDATE sites SET title = ?, html = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND user_id = ?`,
        ).run(
          version.title,
          version.html,
          siteVersionsMatch[1],
          user.id,
        );
        return json({ restored: true });
      }

      const match = url.pathname.match(
        /^\/api\/sites\/([a-zA-Z0-9_-]+)(?:\/(messages|publish|qr))?$/,
      );
      if (match) {
        const site = db.prepare(
          "SELECT id, title, html, kind, is_published, created_at, updated_at FROM sites WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
        )
          .get(match[1], user.id) as Record<string, unknown> | undefined;
        if (!site) return error("Site not found", 404);
        if (!match[2] && method === "GET") {
          const messages = db.prepare(
            "SELECT id, role, content, created_at FROM messages WHERE site_id = ? ORDER BY id",
          ).all(match[1]);
          return json({ ...site, messages });
        }
        if (match[2] === "qr" && method === "GET") {
          if (!site.is_published) {
            return error("サイトを公開してから共有してください", 409);
          }
          const publicUrl = `${url.origin}/${encodeURIComponent(user.id)}/${
            encodeURIComponent(match[1])
          }`;
          const svg = await QRCode.toString(publicUrl, {
            type: "svg",
            width: 320,
            margin: 2,
            color: { dark: "#24302cff", light: "#fffdf8ff" },
          });
          return new Response(svg, {
            headers: {
              "content-type": "image/svg+xml; charset=utf-8",
              "cache-control": "no-store",
            },
          });
        }
        if (match[2] === "publish" && method === "PUT") {
          const data = await body(request);
          if (typeof data?.published !== "boolean") {
            return error("published must be boolean");
          }
          db.prepare(
            "UPDATE sites SET is_published = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
          ).run(data.published ? 1 : 0, match[1]);
          return json({
            published: data.published,
            url: `/${user.id}/${match[1]}`,
          });
        }
        if (match[2] === "messages" && method === "POST") {
          if (user.points <= 0) return error("ポイントが不足しています", 402);
          const data = await body(request);
          const content = typeof data?.content === "string"
            ? data.content.trim()
            : "";
          if (!content || content.length > maxChatLength) {
            return error("指示は1〜10000文字で入力してください");
          }
          let generated: SiteGeneration;
          try {
            const assets = db.prepare(
              `SELECT id, name, mime_type, description, prompt FROM contents
               WHERE user_id = ? ORDER BY created_at DESC`,
            ).all(user.id) as Array<Record<string, unknown>>;
            const assetContext = assets.length
              ? `\n\n利用可能なマイコンテンツです。内容に合うものだけを選んで使用してください。すべてを使う必要はなく、適切なものがなければ使用しないでください。\n${
                assets.map((asset) =>
                  `- ${asset.name} (${asset.mime_type}) URL: /${user.id}/content/${asset.id} 付加情報: ${
                    asset.description ?? asset.prompt ?? asset.name
                  }`
                ).join("\n")
              }`
              : "";
            const appInstruction = site.kind === "app"
              ? "\n\nこれは単一HTMLファイルで動くアプリです。CSSとJavaScriptをHTML内に含め、外部ライブラリや通信なしで操作できる完成品にしてください。ゲームの場合は開始・リセット・遊び方を分かりやすく実装してください。"
              : "";
            generated = await generate(
              content + appInstruction + assetContext,
              site.html as string,
              site.title as string,
            );
          } catch (cause) {
            console.error("Website generation failed", cause);
            return error("AIによるサイト生成に失敗しました", 502);
          }
          const { html, reply, title } = generated;
          db.exec("BEGIN");
          try {
            db.prepare(
              "INSERT INTO messages(site_id, role, content) VALUES (?, 'user', ?)",
            ).run(match[1], content);
            db.prepare(
              "INSERT INTO messages(site_id, role, content) VALUES (?, 'assistant', ?)",
            ).run(match[1], reply);
            db.prepare(
              "UPDATE sites SET title = ?, html = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            ).run(title, html, match[1]);
            db.prepare(
              "INSERT INTO site_versions(site_id, title, html) VALUES (?, ?, ?)",
            ).run(match[1], title, html);
            db.exec("COMMIT");
          } catch (cause) {
            db.exec("ROLLBACK");
            throw cause;
          }
          const pointsRemaining = chargePoints(
            db,
            user.id,
            "chat",
            generated.costUsd,
          );
          return json({
            html,
            title,
            reply,
            points_remaining: pointsRemaining,
          });
        }
      }
      return error("Not found", 404);
    } catch (cause) {
      console.error(cause);
      return error("Internal server error", 500);
    }
  };
}

if (import.meta.main) {
  const db = await openDatabase(
    Deno.env.get("DATABASE_PATH") ?? "data/chiracy.sqlite",
  );
  const port = Number(Deno.env.get("PORT"));
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  console.log(`Chiracy: http://localhost:${port}`);
  Deno.serve({ port }, createHandler(db));
}
