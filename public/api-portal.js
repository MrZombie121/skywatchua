const authCard = document.getElementById("auth-card");
const dashboardCard = document.getElementById("dashboard-card");
const authStatus = document.getElementById("auth-status");
const dashboardStatus = document.getElementById("dashboard-status");
const registerForm = document.getElementById("register-form");
const loginForm = document.getElementById("login-form");
const createKeyForm = document.getElementById("create-key-form");
const keysList = document.getElementById("keys-list");
const userEmail = document.getElementById("user-email");
const logoutBtn = document.getElementById("logout-btn");
const newKeyBox = document.getElementById("new-key-box");
const newKeyValue = document.getElementById("new-key-value");

function setStatus(node, message, type = "") {
  node.textContent = message || "";
  node.className = `status ${type}`.trim();
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "request_failed");
  }
  return data;
}

function keySnippet(key) {
  const origin = window.location.origin;
  return `<iframe src="${origin}/embed/map?api_key=${key}" width="100%" height="640" style="border:0;border-radius:16px"></iframe>`;
}

function renderKeys(items) {
  keysList.innerHTML = "";
  if (!items.length) {
    keysList.innerHTML = "<div class=\"key-item\">Ключів ще немає.</div>";
    return;
  }

  items.forEach((item) => {
    const node = document.createElement("div");
    node.className = "key-item";
    const createdAt = item.created_at ? new Date(item.created_at).toLocaleString("uk-UA") : "—";
    const lastUsed = item.last_used_at ? new Date(item.last_used_at).toLocaleString("uk-UA") : "ще не використовувався";
    const revoked = item.revoked_at ? `<div class="meta">Відкликано: ${new Date(item.revoked_at).toLocaleString("uk-UA")}</div>` : "";
    node.innerHTML = `
      <div class="key-top">
        <div>
          <strong>${item.name}</strong>
          <div class="meta">${item.masked_key}</div>
        </div>
        ${item.revoked_at ? "" : `<button type="button" class="secondary" data-revoke="${item.id}">Відкликати</button>`}
      </div>
      <div class="meta">Створено: ${createdAt}</div>
      <div class="meta">Останнє використання: ${lastUsed}</div>
      ${revoked}
    `;
    keysList.appendChild(node);
  });
}

async function loadMe() {
  try {
    const data = await request("/api/auth/me", { method: "GET" });
    authCard.classList.add("hidden");
    dashboardCard.classList.remove("hidden");
    userEmail.textContent = data.user.email;
    renderKeys(data.api_keys || []);
  } catch {
    dashboardCard.classList.add("hidden");
    authCard.classList.remove("hidden");
  }
}

registerForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus(authStatus, "Створення акаунта...");
  const form = new FormData(registerForm);
  try {
    await request("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email: form.get("email"),
        password: form.get("password")
      })
    });
    setStatus(authStatus, "Акаунт створено.", "ok");
    await loadMe();
  } catch (error) {
    setStatus(authStatus, error.message, "error");
  }
});

loginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus(authStatus, "Вхід...");
  const form = new FormData(loginForm);
  try {
    await request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: form.get("email"),
        password: form.get("password")
      })
    });
    setStatus(authStatus, "Вхід виконано.", "ok");
    await loadMe();
  } catch (error) {
    setStatus(authStatus, error.message, "error");
  }
});

createKeyForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus(dashboardStatus, "Створюю ключ...");
  const form = new FormData(createKeyForm);
  try {
    const data = await request("/api/auth/api-keys", {
      method: "POST",
      body: JSON.stringify({ name: form.get("name") })
    });
    newKeyBox.classList.remove("hidden");
    newKeyValue.textContent = `${data.api_key}\n\n${keySnippet(data.api_key)}`;
    setStatus(dashboardStatus, "Ключ створено.", "ok");
    createKeyForm.reset();
    await loadMe();
  } catch (error) {
    setStatus(dashboardStatus, error.message, "error");
  }
});

keysList?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-revoke]");
  if (!button) return;
  try {
    await request(`/api/auth/api-keys/${button.dataset.revoke}`, { method: "DELETE" });
    setStatus(dashboardStatus, "Ключ відкликано.", "ok");
    await loadMe();
  } catch (error) {
    setStatus(dashboardStatus, error.message, "error");
  }
});

logoutBtn?.addEventListener("click", async () => {
  await request("/api/auth/logout", { method: "POST" });
  dashboardCard.classList.add("hidden");
  authCard.classList.remove("hidden");
  newKeyBox.classList.add("hidden");
  setStatus(authStatus, "Ви вийшли з акаунта.", "ok");
});

loadMe();
