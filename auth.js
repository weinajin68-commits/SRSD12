function $(selector) {
  return document.querySelector(selector);
}

function showError(message) {
  const box = $("#auth-error");
  if (!message) {
    box.classList.add("hidden");
    box.textContent = "";
    return;
  }
  box.textContent = message;
  box.classList.remove("hidden");
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }
  return data;
}

function switchTab(mode) {
  const loginBtn = $("#show-login");
  const registerBtn = $("#show-register");
  const loginForm = $("#login-form");
  const registerForm = $("#register-form");
  const isLogin = mode === "login";

  loginBtn.classList.toggle("active", isLogin);
  registerBtn.classList.toggle("active", !isLogin);
  loginForm.classList.toggle("hidden", !isLogin);
  registerForm.classList.toggle("hidden", isLogin);
  showError("");
}

$("#show-login").addEventListener("click", () => switchTab("login"));
$("#show-register").addEventListener("click", () => switchTab("register"));

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  showError("");
  const form = new FormData(event.currentTarget);
  try {
    await postJson("/api/login", {
      username: form.get("username"),
      password: form.get("password"),
    });
    window.location.href = "/app";
  } catch (error) {
    showError(error.message);
  }
});

$("#register-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  showError("");
  const form = new FormData(event.currentTarget);
  try {
    await postJson("/api/register", {
      username: form.get("username"),
      fullName: form.get("fullName"),
      studentId: form.get("studentId"),
      password: form.get("password"),
    });
    window.location.href = "/app";
  } catch (error) {
    showError(error.message);
  }
});
