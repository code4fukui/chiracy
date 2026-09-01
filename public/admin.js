const $ = (selector) => document.querySelector(selector);

function formatDate(value) {
  if (!value) return "未記録";
  return new Date(`${value.replace(" ", "T")}Z`).toLocaleString("ja-JP");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: options.body
      ? { "content-type": "application/json", ...options.headers }
      : options.headers,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "エラーが発生しました");
  return data;
}

async function loadAdmin() {
  try {
    const [users, settings] = await Promise.all([
      api("/api/admin/users"),
      api("/api/admin/settings"),
    ]);
    $("#admin-logout").hidden = false;
    $("#initial-points-form").elements.initial_points.value =
      settings.initial_points;
    const tbody = $("#admin-users");
    tbody.replaceChildren();
    for (const user of users) {
      const row = document.createElement("tr");
      const id = document.createElement("td");
      id.textContent = user.id;
      const points = document.createElement("td");
      const pointsInput = document.createElement("input");
      pointsInput.type = "number";
      pointsInput.min = "0";
      pointsInput.max = "1000000";
      pointsInput.step = "1";
      pointsInput.value = user.points;
      pointsInput.setAttribute("aria-label", `${user.id}のポイント`);
      points.append(pointsInput);
      const totalPoints = document.createElement("td");
      totalPoints.textContent = user.total_points_used.toLocaleString();
      const level = document.createElement("td");
      level.textContent = `Lv.${user.level}`;
      const state = document.createElement("td");
      state.textContent = user.is_banned ? "BAN中" : "有効";
      const createdAt = document.createElement("td");
      createdAt.textContent = formatDate(user.created_at);
      const lastLoginAt = document.createElement("td");
      lastLoginAt.textContent = formatDate(user.last_login_at);
      const actions = document.createElement("td");
      const save = document.createElement("button");
      save.textContent = "保存";
      save.addEventListener("click", async () => {
        const value = Number(pointsInput.value);
        if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000) {
          pointsInput.reportValidity();
          return;
        }
        await api(`/api/admin/users/${encodeURIComponent(user.id)}/points`, {
          method: "PUT",
          body: JSON.stringify({ points: value }),
        });
        await loadAdmin();
      });
      const ban = document.createElement("button");
      ban.className = user.is_banned ? "secondary" : "danger-button";
      ban.textContent = user.is_banned ? "BAN解除" : "BAN";
      ban.addEventListener("click", async () => {
        await api(`/api/admin/users/${encodeURIComponent(user.id)}/ban`, {
          method: "PUT",
          body: JSON.stringify({ banned: !user.is_banned }),
        });
        await loadAdmin();
      });
      actions.append(save, ban);
      row.append(
        id,
        points,
        totalPoints,
        level,
        state,
        createdAt,
        lastLoginAt,
        actions,
      );
      tbody.append(row);
    }
  } catch {
    location.href = "/";
  }
}

$("#initial-points-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const points = Number(event.currentTarget.elements.initial_points.value);
  try {
    await api("/api/admin/settings", {
      method: "PUT",
      body: JSON.stringify({ initial_points: points }),
    });
    $("#admin-status").textContent = "初期ポイントを保存しました。";
  } catch (error) {
    $("#admin-status").textContent = error.message;
  }
});

$("#admin-logout").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  location.href = "/";
});

loadAdmin();
