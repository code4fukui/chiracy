import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../src/db.ts";
import { createHandler } from "../src/server.ts";
import { parseSiteGeneration } from "../src/ai.ts";

let db: DatabaseSync;
let handler: ReturnType<typeof createHandler>;

Deno.test("parses output text from a raw Responses API response", () => {
  const generated = parseSiteGeneration({
    status: "completed",
    output: [{
      type: "message",
      content: [{
        type: "output_text",
        text: JSON.stringify({
          title: "テストサイト",
          html: "<!doctype html><html><body>test</body></html>",
          reply: "作成しました。",
        }),
      }],
    }],
  });
  if (generated.title !== "テストサイト") {
    throw new Error("nested output text was not parsed");
  }
});

function fakeGenerate(
  instruction: string,
  _html: string,
  _title: string,
) {
  return Promise.resolve({
    title: instruction,
    html:
      `<!doctype html><html><head><title>${instruction}</title></head><body><h1>${instruction}</h1></body></html>`,
    reply: `「${instruction}」を反映しました。`,
    costUsd: 0.001,
  });
}

function fakeImage() {
  return Promise.resolve({
    data: new Uint8Array([137, 80, 78, 71]),
    mimeType: "image/png" as const,
    costUsd: 0.034,
  });
}

function fakePlan(instruction: string, markdown: string) {
  return Promise.resolve({
    title: `${instruction}企画`,
    markdown:
      `${markdown}\n# ${instruction}\n\n- 実施する\n\n## チラシ作成依頼文章\n\n${instruction}を告知するチラシ`
        .trim(),
    flyerRequest: `${instruction}を告知するチラシ`,
    reply: "企画書を更新しました。",
    costUsd: 0.001,
  });
}

async function request(path: string, options: RequestInit = {}) {
  return await handler(new Request(`http://localhost${path}`, options));
}

async function registerAndLogin(id: string, level = 3) {
  await request("/api/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id,
      password: "password123",
      acceptedTerms: true,
    }),
  });
  if (level > 1) {
    db.prepare("UPDATE users SET level = ? WHERE id = ?").run(level, id);
  }
  const response = await request("/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, password: "password123" }),
  });
  return response.headers.get("set-cookie")?.split(";")[0] ?? "";
}

Deno.test({
  name: "register, login, create, edit and publish a site",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    db = await openDatabase(":memory:");
    handler = createHandler(db, fakeGenerate);
    const withoutTerms = await request("/api/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "refused", password: "password123" }),
    });
    if (withoutTerms.status !== 400) {
      throw new Error("registration without terms acceptance was allowed");
    }
    const cookie = await registerAndLogin("alice");
    const acceptance = db.prepare(
      "SELECT terms_accepted_at FROM users WHERE id = ?",
    ).get("alice") as { terms_accepted_at: string | null };
    if (!acceptance.terms_accepted_at) {
      throw new Error("terms acceptance was not recorded");
    }
    const created = await request("/api/sites", {
      method: "POST",
      headers: { cookie },
    });
    if (created.status !== 201) throw new Error(await created.text());
    const { id } = await created.json();
    const edited = await request(`/api/sites/${id}/messages`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ content: "私のお店" }),
    });
    const editedBody = await edited.json();
    if (edited.status !== 200 || !editedBody.html.includes("私のお店")) {
      throw new Error("site was not generated");
    }
    if (editedBody.points_remaining !== 999) {
      throw new Error("chat points were not charged");
    }
    const before = await request(`/alice/${id}`);
    if (before.status !== 404) throw new Error("private site was exposed");
    const privateQr = await request(`/api/sites/${id}/qr`, {
      headers: { cookie },
    });
    if (privateQr.status !== 409) {
      throw new Error("QR code was generated for a private site");
    }
    const published = await request(`/api/sites/${id}/publish`, {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ published: true }),
    });
    if (published.status !== 200) throw new Error(await published.text());
    const after = await request(`/alice/${id}`);
    if (
      after.status !== 200 || !(await after.text()).includes("私のお店")
    ) throw new Error("published site unavailable");
    const qr = await request(`/api/sites/${id}/qr`, { headers: { cookie } });
    if (
      qr.status !== 200 ||
      !qr.headers.get("content-type")?.startsWith("image/svg+xml") ||
      !(await qr.text()).includes("<svg")
    ) {
      throw new Error("published site's QR code is unavailable");
    }
    db.close();
  },
});

Deno.test({
  name: "upload, generate and publish site contents",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    db = await openDatabase(":memory:");
    handler = createHandler(db, fakeGenerate, fakeImage);
    const cookie = await registerAndLogin("alice");
    const created = await request("/api/sites", {
      method: "POST",
      headers: { cookie },
    });
    const { id: siteId } = await created.json();

    const form = new FormData();
    form.set(
      "file",
      new File([new Uint8Array([1, 2, 3])], "photo.png", {
        type: "image/png",
      }),
    );
    form.set("description", "青空の店舗写真");
    const uploaded = await request("/api/contents", {
      method: "POST",
      headers: { cookie },
      body: form,
    });
    if (uploaded.status !== 201) throw new Error(await uploaded.text());
    const upload = await uploaded.json();
    if (!upload.url.startsWith("/alice/content/")) {
      throw new Error("content URL is not under the user path");
    }
    if ((await request(upload.url)).status !== 404) {
      throw new Error("private content was publicly exposed");
    }
    if ((await request(upload.url, { headers: { cookie } })).status !== 200) {
      throw new Error("owner cannot read content");
    }

    const csvForm = new FormData();
    csvForm.set(
      "file",
      new File(["name,value\nA,1\n"], "data.csv", { type: "text/csv" }),
    );
    const csvUploaded = await request("/api/contents", {
      method: "POST",
      headers: { cookie },
      body: csvForm,
    });
    if (csvUploaded.status !== 201) throw new Error(await csvUploaded.text());

    const generated = await request(
      "/api/contents/generate",
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          prompt: "背景を明るくする",
          sourceId: upload.id,
        }),
      },
    );
    if (generated.status !== 201) throw new Error(await generated.text());
    if ((await generated.json()).points_remaining !== 989) {
      throw new Error("image points were not charged");
    }
    const contents = await request("/api/contents", {
      headers: { cookie },
    });
    const contentList = await contents.json();
    if (contentList.length !== 3) {
      throw new Error("contents were not saved");
    }
    if (
      !contentList.some((content: { description?: string }) =>
        content.description === "青空の店舗写真"
      )
    ) {
      throw new Error("content description was not saved");
    }

    const siteGenerated = await request(`/api/sites/${siteId}/messages`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ content: "マイコンテンツを使う" }),
    });
    if (!(await siteGenerated.json()).html.includes("付加情報: data.csv")) {
      throw new Error("file name was not used as the content description");
    }
    await request(`/api/sites/${siteId}/publish`, {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ published: true }),
    });
    if ((await request(upload.url)).status !== 200) {
      throw new Error("published content is unavailable");
    }
    if ((await request(`/content/${upload.id}`)).status !== 404) {
      throw new Error("legacy content URL is still available");
    }
    db.close();
  },
});

Deno.test({
  name: "create and revise a flyer through chat",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    db = await openDatabase(":memory:");
    let editUsedSource = false;
    let flyerSize = "";
    let imageNumber = 0;
    handler = createHandler(
      db,
      fakeGenerate,
      (_prompt, source, size) => {
        editUsedSource ||= Boolean(source);
        flyerSize = size ?? "";
        imageNumber++;
        return Promise.resolve({
          data: new Uint8Array([imageNumber]),
          mimeType: "image/png" as const,
          costUsd: 0.034,
        });
      },
    );
    const cookie = await registerAndLogin("alice");
    const created = await request("/api/flyers", {
      method: "POST",
      headers: { cookie },
    });
    if (created.status !== 201) throw new Error(await created.text());
    const { id } = await created.json();
    const initial = await request(`/api/flyers/${id}`, { headers: { cookie } });
    const initialBody = await initial.json();
    if (
      initialBody.has_image ||
      initialBody.messages[0]?.content !== "どんなチラシを作りますか？"
    ) throw new Error("flyer did not start with the initial question");

    const first = await request(`/api/flyers/${id}/messages`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ content: "夏祭りのチラシ" }),
    });
    if (first.status !== 200 || flyerSize !== "1024x1536") {
      throw new Error("flyer was not generated as an A4 portrait");
    }
    const image = await request(`/api/flyers/${id}/image`, {
      headers: { cookie },
    });
    if (
      image.status !== 200 || image.headers.get("content-type") !== "image/png"
    ) {
      throw new Error("generated flyer image is unavailable");
    }
    const revised = await request(`/api/flyers/${id}/messages`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ content: "日時を大きくして" }),
    });
    if (revised.status !== 200 || !editUsedSource) {
      throw new Error("flyer revision did not use the current image");
    }
    const versions = await request(`/api/flyers/${id}/versions`, {
      headers: { cookie },
    });
    const versionList = await versions.json();
    if (versionList.length !== 2) {
      throw new Error("flyer versions were not saved");
    }
    const thumbnail = await request(
      `/api/flyers/${id}/versions/${versionList[0].id}/image`,
      { headers: { cookie } },
    );
    if (
      thumbnail.status !== 200 ||
      thumbnail.headers.get("content-type") !== "image/png"
    ) throw new Error("flyer version thumbnail is unavailable");
    const restored = await request(
      `/api/flyers/${id}/versions/${versionList.at(-1).id}/restore`,
      { method: "POST", headers: { cookie } },
    );
    const restoredImage = await request(`/api/flyers/${id}/image`, {
      headers: { cookie },
    });
    if (
      restored.status !== 200 ||
      new Uint8Array(await restoredImage.arrayBuffer())[0] !== 1
    ) throw new Error("flyer version was not restored");
    db.close();
  },
});

Deno.test({
  name: "save and restore website versions",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    db = await openDatabase(":memory:");
    handler = createHandler(db, fakeGenerate);
    const cookie = await registerAndLogin("alice");
    const created = await request("/api/sites", {
      method: "POST",
      headers: { cookie },
    });
    const { id } = await created.json();
    for (const content of ["最初のサイト", "更新したサイト"]) {
      const response = await request(`/api/sites/${id}/messages`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (response.status !== 200) throw new Error(await response.text());
    }
    const versions = await request(`/api/sites/${id}/versions`, {
      headers: { cookie },
    });
    const versionList = await versions.json();
    const first = versionList.find((version: { title: string }) =>
      version.title === "最初のサイト"
    );
    if (versionList.length !== 3 || !first) {
      throw new Error("website versions were not saved");
    }
    const restored = await request(
      `/api/sites/${id}/versions/${first.id}/restore`,
      { method: "POST", headers: { cookie } },
    );
    const site = await request(`/api/sites/${id}`, { headers: { cookie } });
    if (
      restored.status !== 200 || (await site.json()).title !== "最初のサイト"
    ) {
      throw new Error("website version was not restored");
    }
    db.close();
  },
});

Deno.test({
  name: "create and improve a Markdown plan through chat",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    db = await openDatabase(":memory:");
    handler = createHandler(
      db,
      fakeGenerate,
      fakeImage,
      fakePlan,
    );
    const cookie = await registerAndLogin("alice");
    const created = await request("/api/plans", {
      method: "POST",
      headers: { cookie },
    });
    const { id } = await created.json();
    const initial = await request(`/api/plans/${id}`, { headers: { cookie } });
    const initialBody = await initial.json();
    if (
      created.status !== 201 || initialBody.markdown ||
      initialBody.messages[0]?.content !== "どんな企画を作りますか？"
    ) throw new Error("plan did not start with the initial question");
    const generated = await request(`/api/plans/${id}/messages`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ content: "地域イベント" }),
    });
    if (
      generated.status !== 200 ||
      !(await generated.json()).markdown.includes("## チラシ作成依頼文章")
    ) throw new Error("Markdown plan was not generated");
    const revised = await request(`/api/plans/${id}/messages`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ content: "予算を追加" }),
    });
    if (
      revised.status !== 200 ||
      !(await revised.json()).markdown.includes("# 地域イベント")
    ) throw new Error("existing Markdown plan was not preserved");
    db.close();
  },
});

Deno.test({
  name: "users cannot read another user's site",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    db = await openDatabase(":memory:");
    handler = createHandler(db, fakeGenerate);
    const alice = await registerAndLogin("alice");
    const bob = await registerAndLogin("bobby");
    const created = await request("/api/sites", {
      method: "POST",
      headers: { cookie: alice },
    });
    const { id } = await created.json();
    const response = await request(`/api/sites/${id}`, {
      headers: { cookie: bob },
    });
    if (response.status !== 404) {
      throw new Error("another user's site was exposed");
    }
    db.close();
  },
});

Deno.test({
  name: "move created items to trash and restore them",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    db = await openDatabase(":memory:");
    handler = createHandler(db, fakeGenerate);
    const cookie = await registerAndLogin("alice");
    const createdItems: Array<{ plural: string; type: string; id: string }> =
      [];
    for (
      const [plural, type] of [
        ["plans", "plan"],
        ["flyers", "flyer"],
        ["sites", "site"],
      ]
    ) {
      const created = await request(`/api/${plural}`, {
        method: "POST",
        headers: { cookie },
      });
      const { id } = await created.json();
      createdItems.push({ plural, type, id });
      const deleted = await request(`/api/${plural}/${id}`, {
        method: "DELETE",
        headers: { cookie },
      });
      if (deleted.status !== 204) throw new Error("item was not deleted");
    }
    const trash = await request("/api/trash", { headers: { cookie } });
    const trashItems = await trash.json();
    if (trashItems.length !== 3) throw new Error("trash items are missing");
    for (const item of createdItems) {
      const restored = await request(
        `/api/trash/${item.type}/${item.id}/restore`,
        { method: "POST", headers: { cookie } },
      );
      if (restored.status !== 200) throw new Error("item was not restored");
    }
    for (const { plural } of createdItems) {
      const list = await request(`/api/${plural}`, { headers: { cookie } });
      if ((await list.json()).length !== 1) {
        throw new Error("restored item is not in the created list");
      }
    }
    db.close();
  },
});

Deno.test({
  name: "initial admin must change its password",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    db = await openDatabase(":memory:");
    handler = createHandler(db, fakeGenerate);
    const login = await request("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "admin", password: "admin" }),
    });
    const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
    const blocked = await request("/api/sites", { headers: { cookie } });
    if (blocked.status !== 403) {
      throw new Error("admin bypassed password change");
    }
    const changed = await request("/api/password", {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        currentPassword: "admin",
        newPassword: "new-password-123",
      }),
    });
    if (changed.status !== 200) throw new Error(await changed.text());
    db.close();
  },
});

Deno.test({
  name: "unlock content types as the user level increases",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    db = await openDatabase(":memory:");
    handler = createHandler(db, fakeGenerate, fakeImage);
    const cookie = await registerAndLogin("beginner", 1);
    const headers = { cookie };
    if (
      (await request("/api/flyers", { method: "POST", headers })).status !==
        403 ||
      (await request("/api/sites", { method: "POST", headers })).status !== 403
    ) throw new Error("locked content was available at level 1");

    const plan = await request("/api/plans", { method: "POST", headers });
    if (plan.status !== 201 || (await plan.json()).level !== 2) {
      throw new Error("creating a plan did not unlock flyers");
    }
    db.prepare("UPDATE users SET level = 1 WHERE id = ?").run("beginner");
    const level2 = await (await request("/api/me", { headers })).json();
    if (level2.level !== 2) throw new Error("level 2 was not saved");
    if (
      (await request("/api/apps", { method: "POST", headers })).status !== 403
    ) throw new Error("apps were available before creating a flyer");

    const flyer = await request("/api/flyers", { method: "POST", headers });
    if (flyer.status !== 201 || (await flyer.json()).level !== 3) {
      throw new Error("creating a flyer did not unlock sites and apps");
    }
    const site = await request("/api/sites", { method: "POST", headers });
    const app = await request("/api/apps", { method: "POST", headers });
    if (site.status !== 201 || app.status !== 201) {
      throw new Error("level 3 content was not unlocked");
    }
    db.close();
  },
});

Deno.test({
  name: "create an app as a self-contained HTML document",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    db = await openDatabase(":memory:");
    handler = createHandler(db, fakeGenerate);
    const cookie = await registerAndLogin("alice");
    const created = await request("/api/apps", {
      method: "POST",
      headers: { cookie },
    });
    if (created.status !== 201) throw new Error(await created.text());
    const { id } = await created.json();
    const app = await request(`/api/sites/${id}`, { headers: { cookie } });
    const initial = await app.json();
    if (
      initial.kind !== "app" ||
      !initial.messages[0]?.content.includes("どんなアプリ")
    ) throw new Error("app did not start with the app prompt");
    const generated = await request(`/api/sites/${id}/messages`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ content: "クリックゲーム" }),
    });
    if (generated.status !== 200) throw new Error(await generated.text());
    const apps = await (await request("/api/apps", { headers: { cookie } }))
      .json();
    const sites = await (await request("/api/sites", { headers: { cookie } }))
      .json();
    if (apps.length !== 1 || sites.length !== 0) {
      throw new Error("apps and websites were not separated");
    }
    db.close();
  },
});

Deno.test({
  name: "admin manages initial points, grants points and bans users",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    db = await openDatabase(":memory:");
    handler = createHandler(db, fakeGenerate, fakeImage);
    const userAdminLogin = await request("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "admin", password: "admin" }),
    });
    const userAdminCookie = userAdminLogin.headers.get("set-cookie")?.split(
      ";",
    )[0] ?? "";
    await request("/api/password", {
      method: "PUT",
      headers: {
        cookie: userAdminCookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        currentPassword: "admin",
        newPassword: "new-admin-password",
      }),
    });
    if (
      (await request("/api/admin/users", {
        headers: { cookie: userAdminCookie },
      })).status !== 200
    ) throw new Error("admin user cannot access admin API");
    if (
      (await request("/api/sites", { headers: { cookie: userAdminCookie } }))
        .status !== 403
    ) throw new Error("admin user can access website creation");
    if ((await request("/api/admin/users")).status !== 401) {
      throw new Error("admin API was not protected");
    }
    const adminCookie = userAdminCookie;
    const setting = await request("/api/admin/settings", {
      method: "PUT",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({ initial_points: 2500 }),
    });
    if (setting.status !== 200) throw new Error(await setting.text());
    const userCookie = await registerAndLogin("alice");
    const me = await request("/api/me", { headers: { cookie: userCookie } });
    if ((await me.json()).points !== 2500) {
      throw new Error("initial points setting was not applied");
    }
    const changedPoints = await request("/api/admin/users/alice/points", {
      method: "PUT",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({ points: 4321 }),
    });
    if ((await changedPoints.json()).points !== 4321) {
      throw new Error("points were not changed to an arbitrary value");
    }
    const banned = await request("/api/admin/users/alice/ban", {
      method: "PUT",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({ banned: true }),
    });
    if (banned.status !== 200) throw new Error(await banned.text());
    if (
      (await request("/api/me", { headers: { cookie: userCookie } })).status !==
        401
    ) {
      throw new Error("banned user's existing session remained active");
    }
    db.close();
  },
});
