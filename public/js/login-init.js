Auth.getSession().then(s => {
  if (s) window.location.href = "/account.html";
});

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("auth-error");
  const btn = document.getElementById("submit-btn");
  errorEl.textContent = "";
  btn.disabled = true;
  btn.textContent = "Signing in...";

  try {
    await Auth.login(
      document.getElementById("email").value,
      document.getElementById("password").value
    );
    window.location.href = "/account.html";
  } catch (err) {
    errorEl.textContent = err.message || "Login failed";
    btn.disabled = false;
    btn.textContent = "Sign In";
  }
});
