const $ = (selector) => document.querySelector(selector);
let user;
let currentSite;
let openingSiteId;
let currentFlyer;
let currentPlan;
let historyType;

async function api(path, options = {}) {
  const isForm = options.body instanceof FormData;
  const response = await fetch(path, {
    ...options,
    headers: options.body && !isForm
      ? { "content-type": "application/json", ...options.headers }
      : options.headers,
  });
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(data.error || "エラーが発生しました");
  return data;
}

function show(name) {
  for (
    const id of [
      "auth",
      "password-change",
      "dashboard",
      "editor",
      "flyer-editor",
      "plan-editor",
    ]
  ) {
    $(`#${id}`).hidden = id !== name;
  }
  $("#public-apps").hidden = name !== "auth";
  $("#user-menu").hidden = !user;
}

async function loadPublicApps() {
  const list = $("#public-app-list");
  list.replaceChildren();
  try {
    const apps = await api("/api/public/apps");
    for (const app of apps) {
      const link = document.createElement("a");
      link.className = "public-app-card";
      link.href = app.url;
      link.target = "_blank";
      link.rel = "noopener";
      const thumbnail = document.createElement("div");
      thumbnail.className = "public-app-thumbnail";
      const preview = document.createElement("iframe");
      preview.src = app.url;
      preview.title = `${app.title}のプレビュー`;
      preview.loading = "lazy";
      preview.tabIndex = -1;
      preview.setAttribute("sandbox", "allow-scripts");
      thumbnail.append(preview);
      const title = document.createElement("strong");
      title.textContent = app.title;
      const author = document.createElement("small");
      author.textContent = `by ${app.user_id}`;
      link.append(thumbnail, title, author);
      list.append(link);
    }
    $("#public-apps").hidden = !apps.length || Boolean(user);
  } catch {
    $("#public-apps").hidden = true;
  }
}

function updatePoints(points) {
  if (typeof points !== "number") return;
  user.points = points;
  $("#points").textContent = `${points} pt`;
}

function clearUserDisplay() {
  $("#points").textContent = "";
  $("#user-id").textContent = "";
}

async function loadUser() {
  try {
    user = await api("/api/me");
    $("#user-id").textContent = user.id;
    updatePoints(user.points);
    if (user.must_change_password) show("password-change");
    else if (user.is_admin) location.reload();
    else {
      await showDashboard();
      history.replaceState({ view: "dashboard" }, "");
    }
  } catch {
    user = null;
    clearUserDisplay();
    show("auth");
    await loadPublicApps();
  }
}

async function showDashboard() {
  show("dashboard");
  user = await api("/api/me");
  updatePoints(user.points);
  const flyerUnlocked = user.level >= 2;
  const webUnlocked = user.level >= 3;
  $("#new-flyer").disabled = !flyerUnlocked;
  $("#new-flyer").textContent = flyerUnlocked
    ? "＋新規チラシ"
    : "🔒 企画を1つ作ると解放";
  $("#new-site").disabled = !webUnlocked;
  $("#new-app").disabled = !webUnlocked;
  $("#new-site").textContent = webUnlocked
    ? "＋新規サイト"
    : "🔒 チラシを1つ作ると解放";
  $("#new-app").textContent = webUnlocked
    ? "＋新規アプリ"
    : "🔒 チラシを1つ作ると解放";
  const [plans, flyers, sites, apps] = await Promise.all([
    api("/api/plans"),
    api("/api/flyers"),
    api("/api/sites"),
    api("/api/apps"),
  ]);
  const planList = $("#plans");
  planList.replaceChildren();
  for (const plan of plans) {
    const button = document.createElement("button");
    button.className = "site-card plan-card";
    const title = document.createElement("strong");
    title.textContent = plan.title;
    const meta = document.createElement("span");
    meta.textContent = plan.has_markdown ? "企画書作成済み" : "作成を開始";
    button.append(title, meta);
    attachDelete(button, "plans", plan.id, plan.title);
    button.addEventListener("click", () => openPlan(plan.id));
    planList.append(button);
  }
  if (!plans.length) {
    planList.innerHTML = '<p class="empty">まだ企画がありません。</p>';
  }
  const list = $("#sites");
  list.replaceChildren();
  for (const site of sites) {
    const button = document.createElement("button");
    button.className = "site-card";
    const title = document.createElement("strong");
    title.textContent = site.title;
    const meta = document.createElement("span");
    meta.textContent = site.is_published ? "● 公開中" : "非公開";
    button.append(title, meta);
    attachDelete(button, "sites", site.id, site.title);
    button.addEventListener("click", () => openSite(site.id));
    list.append(button);
  }
  if (!sites.length) {
    list.innerHTML = '<p class="empty">まだサイトがありません。</p>';
  }
  const appList = $("#apps");
  appList.replaceChildren();
  for (const app of apps) {
    const button = document.createElement("button");
    button.className = "site-card";
    const title = document.createElement("strong");
    title.textContent = app.title;
    const meta = document.createElement("span");
    meta.textContent = app.is_published ? "● 公開中" : "非公開";
    button.append(title, meta);
    attachDelete(button, "sites", app.id, app.title);
    button.addEventListener("click", () => openSite(app.id));
    appList.append(button);
  }
  if (!apps.length) {
    appList.innerHTML = '<p class="empty">まだアプリがありません。</p>';
  }
  const flyerList = $("#flyers");
  flyerList.replaceChildren();
  for (const flyer of flyers) {
    const button = document.createElement("button");
    button.className = "site-card flyer-card";
    const title = document.createElement("strong");
    title.textContent = flyer.title;
    const meta = document.createElement("span");
    meta.textContent = flyer.has_image ? "チラシ作成済み" : "作成を開始";
    button.append(title, meta);
    attachDelete(button, "flyers", flyer.id, flyer.title);
    button.addEventListener("click", () => openFlyer(flyer.id));
    flyerList.append(button);
  }
  if (!flyers.length) {
    flyerList.innerHTML = '<p class="empty">まだチラシがありません。</p>';
  }
}

function attachDelete(card, type, id, title) {
  const remove = document.createElement("span");
  remove.className = "delete-icon";
  remove.textContent = "🗑️";
  remove.title = `${title}を削除`;
  remove.setAttribute("role", "button");
  remove.setAttribute("tabindex", "0");
  const moveToTrash = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!confirm(`「${title}」をゴミ箱へ移しますか？`)) return;
    await api(`/api/${type}/${encodeURIComponent(id)}`, { method: "DELETE" });
    await showDashboard();
  };
  remove.addEventListener("click", moveToTrash);
  remove.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") moveToTrash(event);
  });
  card.append(remove);
}

async function openTrash() {
  const list = $("#trash-list");
  list.replaceChildren();
  $("#trash-status").textContent = "読み込み中・・・";
  if (!$("#trash-dialog").open) $("#trash-dialog").showModal();
  try {
    const items = await api("/api/trash");
    $("#trash-status").textContent = "";
    for (const item of items) {
      const row = document.createElement("div");
      row.className = "history-row";
      const detail = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = item.title;
      const date = document.createElement("small");
      date.textContent = `削除: ${
        new Date(`${item.deleted_at}Z`).toLocaleString()
      }`;
      detail.append(title, date);
      const restore = document.createElement("button");
      restore.type = "button";
      restore.textContent = "復元";
      restore.addEventListener("click", async () => {
        restore.disabled = true;
        try {
          await api(`/api/trash/${item.type}/${item.id}/restore`, {
            method: "POST",
          });
          await showDashboard();
          await openTrash();
        } catch (error) {
          $("#trash-status").textContent = error.message;
          restore.disabled = false;
        }
      });
      row.append(detail, restore);
      list.append(row);
    }
    if (!items.length) {
      list.innerHTML = '<p class="empty">ゴミ箱は空です。</p>';
    }
  } catch (error) {
    $("#trash-status").textContent = error.message;
  }
}

$("#trash-button").addEventListener("click", openTrash);
$("#trash-close").addEventListener("click", () => {
  $("#trash-dialog").close();
});

function renderMarkdown(markdown) {
  const target = $("#plan-preview");
  target.replaceChildren();
  let list;
  let code;
  const lines = markdown.split("\n");
  const cells = (line) =>
    line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.startsWith("```")) {
      if (code) {
        target.append(code);
        code = null;
      } else {
        code = document.createElement("pre");
      }
      continue;
    }
    if (code) {
      code.textContent += `${line}\n`;
      continue;
    }
    if (
      line.includes("|") &&
      /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(
        lines[index + 1] ?? "",
      )
    ) {
      list = null;
      const table = document.createElement("table");
      const head = document.createElement("thead");
      const headRow = document.createElement("tr");
      for (const value of cells(line)) {
        const th = document.createElement("th");
        th.textContent = value;
        headRow.append(th);
      }
      head.append(headRow);
      table.append(head);
      const body = document.createElement("tbody");
      index += 2;
      while (index < lines.length && lines[index].includes("|")) {
        const row = document.createElement("tr");
        for (const value of cells(lines[index])) {
          const td = document.createElement("td");
          td.textContent = value;
          row.append(td);
        }
        body.append(row);
        index++;
      }
      index--;
      table.append(body);
      const wrapper = document.createElement("div");
      wrapper.className = "markdown-table-wrap";
      wrapper.append(table);
      target.append(wrapper);
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    const item = line.match(/^[-*]\s+(.+)$/);
    if (heading) {
      list = null;
      const element = document.createElement(`h${heading[1].length}`);
      element.textContent = heading[2];
      target.append(element);
    } else if (item) {
      if (!list) {
        list = document.createElement("ul");
        target.append(list);
      }
      const element = document.createElement("li");
      element.textContent = item[1];
      list.append(element);
    } else if (line.trim()) {
      list = null;
      const element = document.createElement("p");
      element.textContent = line;
      target.append(element);
    } else {
      list = null;
    }
  }
  if (code) target.append(code);
}

function appendPlanMessage(role, content) {
  const bubble = document.createElement("div");
  bubble.className = `message ${role}`;
  bubble.textContent = content;
  $("#plan-messages").append(bubble);
  bubble.scrollIntoView({ block: "nearest" });
  return bubble;
}

async function openPlan(id, recordHistory = true) {
  currentPlan = await api(`/api/plans/${id}`);
  if (recordHistory) history.pushState({ view: "plan", id }, "");
  show("plan-editor");
  $("#plan-title").textContent = currentPlan.title;
  $("#plan-messages").replaceChildren();
  for (const message of currentPlan.messages) {
    appendPlanMessage(message.role, message.content);
  }
  const hasMarkdown = Boolean(currentPlan.markdown);
  $("#plan-empty").hidden = hasMarkdown;
  $("#plan-preview").hidden = !hasMarkdown;
  $("#plan-markdown-copy").disabled = !hasMarkdown;
  $("#plan-markdown-copy").textContent = "Markdown";
  if (hasMarkdown) renderMarkdown(currentPlan.markdown);
}

function renderMessages(messages) {
  const list = $("#messages");
  list.replaceChildren();
  for (const message of messages) {
    appendMessage(message.role, message.content);
  }
}

function appendMessage(role, content) {
  const list = $("#messages");
  const bubble = document.createElement("div");
  bubble.className = `message ${role}`;
  bubble.textContent = content;
  list.append(bubble);
  list.scrollTop = list.scrollHeight;
  return bubble;
}

function appendThinking() {
  const bubble = document.createElement("div");
  bubble.className = "message assistant thinking";
  bubble.setAttribute("role", "status");
  bubble.setAttribute("aria-label", "AIが回答を作成しています");
  bubble.innerHTML =
    '<span class="thinking-label">AIが作成中</span><span class="thinking-dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span>';
  $("#messages").append(bubble);
  bubble.scrollIntoView({ block: "nearest" });
  return bubble;
}

function appendFlyerMessage(role, content) {
  const bubble = document.createElement("div");
  bubble.className = `message ${role}`;
  bubble.textContent = content;
  $("#flyer-messages").append(bubble);
  bubble.scrollIntoView({ block: "nearest" });
  return bubble;
}

function showFlyerImage() {
  $("#flyer-empty").hidden = currentFlyer.has_image;
  $("#flyer-download").disabled = !currentFlyer.has_image;
  if (currentFlyer.has_image) {
    let image = $("#flyer-preview");
    if (!image) {
      image = document.createElement("img");
      image.id = "flyer-preview";
      image.alt = "AIが作成したチラシ";
      $(".flyer-preview-pane").append(image);
    }
    image.src = `/api/flyers/${
      encodeURIComponent(currentFlyer.id)
    }/image?v=${Date.now()}`;
  } else {
    $("#flyer-preview")?.remove();
  }
}

async function openFlyer(id, recordHistory = true) {
  currentFlyer = await api(`/api/flyers/${id}`);
  if (recordHistory) history.pushState({ view: "flyer", id }, "");
  show("flyer-editor");
  $("#flyer-title").textContent = currentFlyer.title;
  $("#flyer-messages").replaceChildren();
  for (const message of currentFlyer.messages) {
    appendFlyerMessage(message.role, message.content);
  }
  showFlyerImage();
}

function updatePublicLink() {
  const link = $("#public-url");
  link.hidden = !currentSite.is_published;
  link.href = `/${encodeURIComponent(user.id)}/${
    encodeURIComponent(currentSite.id)
  }`;
  link.textContent = "公開ページ ↗";
  $("#share").disabled = !currentSite.is_published;
}

function showPreview(html) {
  const pane = $("#preview-pane");
  const previous = $("#preview");
  const preview = document.createElement("iframe");
  preview.id = "preview";
  preview.title = "ウェブサイトのプレビュー";
  preview.setAttribute("sandbox", "allow-scripts");
  pane.dataset.loading = "true";
  pane.setAttribute("aria-busy", "true");
  preview.addEventListener("load", () => {
    pane.dataset.loading = "false";
    pane.removeAttribute("aria-busy");
  }, { once: true });
  preview.srcdoc = html;
  previous.replaceWith(preview);
}

async function openSite(id, recordHistory = true) {
  openingSiteId = id;
  const site = await api(`/api/sites/${id}`);
  if (openingSiteId !== id) return;
  currentSite = site;
  if (recordHistory) history.pushState({ view: "site", id }, "");
  show("editor");
  $("#site-title").textContent = currentSite.title;
  $("#publish").checked = Boolean(currentSite.is_published);
  showPreview(currentSite.html);
  renderMessages(currentSite.messages);
  updatePublicLink();
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function resizeLargeJpeg(file) {
  if (file.type !== "image/jpeg" || file.size <= 2 * 1024 * 1024) {
    const bitmap = file.type === "image/jpeg"
      ? await createImageBitmap(file)
      : null;
    if (!bitmap || Math.max(bitmap.width, bitmap.height) <= 2560) {
      bitmap?.close();
      return file;
    }
    bitmap.close();
  }
  if (file.type !== "image/jpeg") return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(
    bitmap,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  bitmap.close();
  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.85)
  );
  if (!blob) throw new Error("JPEG画像を縮小できませんでした");
  return new File([blob], file.name, {
    type: "image/jpeg",
    lastModified: file.lastModified,
  });
}

function contentPreview(content) {
  if (content.mime_type.startsWith("image/")) {
    const image = document.createElement("img");
    image.src = content.url;
    image.alt = content.name;
    image.loading = "lazy";
    return image;
  }
  if (content.mime_type.startsWith("audio/")) {
    const audio = document.createElement("audio");
    audio.src = content.url;
    audio.controls = true;
    return audio;
  }
  const link = document.createElement("a");
  link.href = content.url;
  link.target = "_blank";
  link.rel = "noopener";
  link.className = "file-preview";
  link.textContent = content.mime_type === "text/csv" ? "CSV" : "PDF";
  return link;
}

async function loadContents() {
  const contents = await api("/api/contents");
  const list = $("#contents-list");
  const source = $("#image-form select");
  list.replaceChildren();
  source.replaceChildren(new Option("新しい画像を生成", ""));
  for (const content of contents) {
    const card = document.createElement("article");
    card.className = "content-card";
    const preview = document.createElement("div");
    preview.className = "content-preview";
    preview.append(contentPreview(content));
    const name = document.createElement("strong");
    name.textContent = content.name;
    name.title = content.name;
    const meta = document.createElement("small");
    meta.textContent = formatSize(content.size);
    const description = document.createElement("p");
    description.className = "content-description";
    description.textContent = content.description || content.prompt ||
      content.name;
    const actions = document.createElement("div");
    actions.className = "content-actions";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "quiet";
    copy.textContent = "URLをコピー";
    copy.addEventListener("click", async () => {
      await navigator.clipboard.writeText(`${location.origin}${content.url}`);
      $("#content-status").textContent =
        "URLをコピーしました。チャットの指示に貼り付けて使えます。";
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "quiet danger";
    remove.textContent = "削除";
    remove.addEventListener("click", async () => {
      if (!confirm(`「${content.name}」を削除しますか？`)) return;
      await api(`/api/contents/${content.id}`, { method: "DELETE" });
      await loadContents();
    });
    actions.append(copy, remove);
    card.append(preview, name, meta, description, actions);
    list.append(card);
    if (["image/png", "image/jpeg", "image/webp"].includes(content.mime_type)) {
      source.add(new Option(content.name, content.id));
    }
  }
  if (!contents.length) {
    list.innerHTML = '<p class="empty">コンテンツはまだありません。</p>';
  }
}

$("#contents-button").addEventListener("click", async () => {
  $("#content-status").textContent = "";
  $("#contents-dialog").showModal();
  try {
    await loadContents();
  } catch (error) {
    $("#content-status").textContent = error.message;
  }
});
$("#contents-close").addEventListener("click", () => {
  $("#contents-dialog").close();
});

$("#user-id").addEventListener("click", () => {
  $("#mypage-user-id").textContent = user.id;
  $("#mypage-points").textContent = `${user.points} pt`;
  $("#mypage-password-form").reset();
  $("#mypage-password-form .error").textContent = "";
  $("#mypage-dialog").showModal();
});
$("#mypage-close").addEventListener("click", () => {
  $("#mypage-dialog").close();
});
$("#mypage-password-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await api("/api/password", {
      method: "PUT",
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    form.reset();
    form.querySelector(".error").textContent = "パスワードを変更しました。";
  } catch (error) {
    form.querySelector(".error").textContent = error.message;
  }
});

$("#upload-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button");
  button.disabled = true;
  $("#content-status").textContent = "アップロード中・・・";
  try {
    const formData = new FormData(form);
    const original = formData.get("file");
    if (original instanceof File && original.type === "image/jpeg") {
      $("#content-status").textContent = "JPEG画像を確認中・・・";
      const resized = await resizeLargeJpeg(original);
      formData.set("file", resized);
      $("#content-status").textContent = resized === original
        ? "アップロード中・・・"
        : `画像を縮小しました（${formatSize(original.size)} → ${
          formatSize(resized.size)
        }）。アップロード中・・・`;
    }
    await api("/api/contents", {
      method: "POST",
      body: formData,
    });
    form.reset();
    $("#content-status").textContent = "アップロードしました。";
    await loadContents();
  } catch (error) {
    $("#content-status").textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$("#image-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button");
  const values = Object.fromEntries(new FormData(form));
  button.disabled = true;
  $("#content-status").textContent = values.sourceId
    ? "AIが画像を加工中・・・"
    : "AIが画像を生成中・・・";
  try {
    const generated = await api(
      "/api/contents/generate",
      {
        method: "POST",
        body: JSON.stringify(values),
      },
    );
    updatePoints(generated.points_remaining);
    form.elements.prompt.value = "";
    $("#content-status").textContent = "画像を保存しました。";
    await loadContents();
  } catch (error) {
    $("#content-status").textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$("#auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  const action = event.submitter.value;
  try {
    if (action === "register") {
      if (!event.currentTarget.elements.acceptedTerms.checked) {
        throw new Error("新規登録には利用規約への同意が必要です");
      }
      values.acceptedTerms = true;
      await api("/api/register", {
        method: "POST",
        body: JSON.stringify(values),
      });
    }
    await api("/api/login", { method: "POST", body: JSON.stringify(values) });
    $("#auth-error").textContent = "";
    await loadUser();
  } catch (error) {
    $("#auth-error").textContent = error.message;
  }
});

$("#password-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  try {
    await api("/api/password", { method: "PUT", body: JSON.stringify(values) });
    user.must_change_password = 0;
    if (user.is_admin) location.reload();
    else await showDashboard();
  } catch (error) {
    form.querySelector(".error").textContent = error.message;
  }
});

$("#logout").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  user = null;
  clearUserDisplay();
  show("auth");
});
$("#new-site").addEventListener(
  "click",
  async () => {
    const created = await api("/api/sites", { method: "POST" });
    await openSite(created.id);
  },
);
$("#new-app").addEventListener(
  "click",
  async () => {
    const created = await api("/api/apps", { method: "POST" });
    await openSite(created.id);
  },
);
$("#new-plan").addEventListener(
  "click",
  async () => {
    const created = await api("/api/plans", { method: "POST" });
    user.level = created.level;
    await openPlan(created.id);
  },
);
$("#new-flyer").addEventListener(
  "click",
  async () => {
    const created = await api("/api/flyers", { method: "POST" });
    user.level = created.level;
    await openFlyer(created.id);
  },
);
async function returnToDashboard() {
  openingSiteId = undefined;
  await showDashboard();
  history.replaceState({ view: "dashboard" }, "");
}

$("#back").addEventListener("click", returnToDashboard);
$("#flyer-back").addEventListener("click", returnToDashboard);
$("#plan-back").addEventListener("click", returnToDashboard);
$("#plan-markdown-copy").addEventListener("click", async (event) => {
  if (!currentPlan?.markdown) return;
  const button = event.currentTarget;
  try {
    await navigator.clipboard.writeText(currentPlan.markdown);
    button.textContent = "コピーしました";
    setTimeout(() => {
      if (button.isConnected) button.textContent = "Markdown";
    }, 1600);
  } catch {
    button.textContent = "コピーできませんでした";
  }
});
$("#plan-message-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const textarea = form.elements.content;
  const button = form.querySelector("button");
  const content = textarea.value.trim();
  if (!content) return;
  textarea.value = "";
  textarea.disabled = true;
  button.disabled = true;
  appendPlanMessage("user", content);
  const thinking = appendPlanMessage("assistant", "");
  thinking.classList.add("thinking");
  thinking.innerHTML =
    '<span class="thinking-label">AIが作成中</span><span class="thinking-dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span>';
  try {
    const result = await api(`/api/plans/${currentPlan.id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content }),
    });
    updatePoints(result.points_remaining);
    currentPlan = await api(`/api/plans/${currentPlan.id}`);
    $("#plan-title").textContent = currentPlan.title;
    $("#plan-messages").replaceChildren();
    for (const message of currentPlan.messages) {
      appendPlanMessage(message.role, message.content);
    }
    $("#plan-empty").hidden = true;
    $("#plan-preview").hidden = false;
    $("#plan-markdown-copy").disabled = false;
    $("#plan-markdown-copy").textContent = "Markdown";
    renderMarkdown(currentPlan.markdown);
  } catch (error) {
    thinking.classList.replace("thinking", "failed");
    thinking.textContent = "作成できませんでした。もう一度お試しください。";
    textarea.value = content;
    alert(error.message);
  } finally {
    textarea.disabled = false;
    button.disabled = false;
    textarea.focus();
  }
});
$("#flyer-message-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const textarea = form.elements.content;
  const button = form.querySelector("button");
  const content = textarea.value.trim();
  if (!content) return;
  textarea.value = "";
  textarea.disabled = true;
  button.disabled = true;
  appendFlyerMessage("user", content);
  const thinking = appendFlyerMessage("assistant", "");
  thinking.classList.add("thinking");
  thinking.setAttribute("role", "status");
  thinking.setAttribute("aria-label", "AIがチラシを作成しています");
  thinking.innerHTML =
    '<span class="thinking-label">AIが作成中</span><span class="thinking-dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span>';
  try {
    const result = await api(`/api/flyers/${currentFlyer.id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content }),
    });
    updatePoints(result.points_remaining);
    currentFlyer = await api(`/api/flyers/${currentFlyer.id}`);
    $("#flyer-title").textContent = currentFlyer.title;
    $("#flyer-messages").replaceChildren();
    for (const message of currentFlyer.messages) {
      appendFlyerMessage(message.role, message.content);
    }
    showFlyerImage();
  } catch (error) {
    thinking.classList.replace("thinking", "failed");
    thinking.textContent = "作成できませんでした。もう一度お試しください。";
    textarea.value = content;
    alert(error.message);
  } finally {
    textarea.disabled = false;
    button.disabled = false;
    textarea.focus();
  }
});
$("#flyer-download").addEventListener("click", async () => {
  if (!currentFlyer?.has_image) return;
  const source = $("#flyer-preview");
  try {
    await source.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 2480;
    canvas.height = 3508;
    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(
      canvas.width / source.naturalWidth,
      canvas.height / source.naturalHeight,
    );
    const width = source.naturalWidth * scale;
    const height = source.naturalHeight * scale;
    context.drawImage(
      source,
      (canvas.width - width) / 2,
      (canvas.height - height) / 2,
      width,
      height,
    );
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.92)
    );
    if (!blob) throw new Error("JPEGへの変換に失敗しました");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${currentFlyer.title || "flyer"}.jpg`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  } catch (error) {
    alert(error.message);
  }
});
$("#preview-reload").addEventListener("click", () => {
  if (currentSite?.html) showPreview(currentSite.html);
});
$("#share").addEventListener("click", () => {
  if (!currentSite?.is_published) return;
  const publicUrl = `${location.origin}/${encodeURIComponent(user.id)}/${
    encodeURIComponent(currentSite.id)
  }`;
  $("#share-message").textContent = "";
  $("#share-content").hidden = false;
  $("#share-url").href = publicUrl;
  $("#share-url").textContent = publicUrl;
  $("#share-qr").src = `/api/sites/${encodeURIComponent(currentSite.id)}/qr`;
  $("#share-dialog").showModal();
});
$("#share-close").addEventListener("click", () => {
  $("#share-dialog").close();
  $("#share-qr").removeAttribute("src");
});

async function openHistory(type) {
  historyType = type;
  const current = type === "site" ? currentSite : currentFlyer;
  const list = $("#history-list");
  list.replaceChildren();
  list.classList.toggle("flyer-history", type === "flyer");
  $("#history-status").textContent = "読み込み中・・・";
  $("#history-dialog").showModal();
  try {
    const versions = await api(
      `/api/${type === "site" ? "sites" : "flyers"}/${current.id}/versions`,
    );
    $("#history-status").textContent = "";
    for (const version of versions) {
      const restoreVersion = async (button) => {
        button.disabled = true;
        $("#history-status").textContent = "復元中・・・";
        try {
          await api(
            `/api/${
              type === "site" ? "sites" : "flyers"
            }/${current.id}/versions/${version.id}/restore`,
            { method: "POST" },
          );
          if (historyType === "site") await openSite(current.id, false);
          else await openFlyer(current.id, false);
          $("#history-dialog").close();
        } catch (error) {
          $("#history-status").textContent = error.message;
          button.disabled = false;
        }
      };
      if (type === "flyer") {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "history-thumbnail";
        const image = document.createElement("img");
        image.src = `/api/flyers/${current.id}/versions/${version.id}/image`;
        image.alt = `${
          new Date(`${version.created_at}Z`).toLocaleString()
        }の版`;
        image.loading = "lazy";
        const date = document.createElement("small");
        date.textContent = new Date(`${version.created_at}Z`).toLocaleString();
        card.append(image, date);
        card.addEventListener("click", () => restoreVersion(card));
        list.append(card);
        continue;
      }
      const row = document.createElement("div");
      row.className = "history-row";
      const detail = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = version.title;
      const date = document.createElement("small");
      date.textContent = new Date(`${version.created_at}Z`).toLocaleString();
      detail.append(title, date);
      const restore = document.createElement("button");
      restore.type = "button";
      restore.textContent = "この版に戻す";
      restore.addEventListener("click", () => restoreVersion(restore));
      row.append(detail, restore);
      list.append(row);
    }
    if (!versions.length) {
      list.innerHTML = '<p class="empty">履歴はまだありません。</p>';
    }
  } catch (error) {
    $("#history-status").textContent = error.message;
  }
}

$("#site-history").addEventListener("click", () => openHistory("site"));
$("#flyer-history").addEventListener("click", () => openHistory("flyer"));
$("#history-close").addEventListener("click", () => {
  $("#history-dialog").close();
});

$("#message-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const textarea = event.currentTarget.elements.content;
  const submitButton = event.currentTarget.querySelector("button");
  const content = textarea.value.trim();
  if (!content) return;
  textarea.value = "";
  textarea.disabled = true;
  submitButton.disabled = true;
  appendMessage("user", content);
  const thinking = appendThinking();
  try {
    const result = await api(`/api/sites/${currentSite.id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content }),
    });
    updatePoints(result.points_remaining);
    currentSite = await api(`/api/sites/${currentSite.id}`);
    $("#site-title").textContent = result.title;
    showPreview(result.html);
    renderMessages(currentSite.messages);
  } catch (error) {
    thinking.classList.replace("thinking", "failed");
    thinking.textContent =
      "回答を取得できませんでした。もう一度お試しください。";
    textarea.value = content;
    alert(error.message);
  } finally {
    textarea.disabled = false;
    submitButton.disabled = false;
    textarea.focus();
  }
});

$("#publish").addEventListener("change", async (event) => {
  try {
    const result = await api(`/api/sites/${currentSite.id}/publish`, {
      method: "PUT",
      body: JSON.stringify({ published: event.target.checked }),
    });
    currentSite.is_published = result.published ? 1 : 0;
    updatePublicLink();
  } catch (error) {
    event.target.checked = !event.target.checked;
    alert(error.message);
  }
});

for (const tab of document.querySelectorAll(".mobile-tabs button")) {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".mobile-tabs button").forEach((item) =>
      item.classList.toggle("active", item === tab)
    );
    $(".editor-panes").dataset.pane = tab.dataset.pane;
  });
}

addEventListener("popstate", async (event) => {
  if (!user) return;
  try {
    if (event.state?.view === "site") {
      await openSite(event.state.id, false);
    } else if (event.state?.view === "flyer") {
      await openFlyer(event.state.id, false);
    } else if (event.state?.view === "plan") {
      await openPlan(event.state.id, false);
    } else {
      await showDashboard();
    }
  } catch {
    await showDashboard();
    history.replaceState({ view: "dashboard" }, "");
  }
});

loadUser();
