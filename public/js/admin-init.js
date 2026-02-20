let adminSession = null;

async function init() {
  adminSession = await Auth.requireAdmin("/index.html");
  if (!adminSession) return;

  const { data: cameras } = await window.sb
    .from("cameras")
    .select("id, name")
    .eq("is_active", true)
    .limit(1);

  const cameraId = cameras?.[0]?.id;

  const video = document.getElementById("admin-video");
  await Stream.init(video);

  video.addEventListener("loadedmetadata", () => {
    const canvas = document.getElementById("line-canvas");
    AdminLine.init(video, canvas, cameraId);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const logoutBtn = document.getElementById("btn-logout");
  if (logoutBtn) logoutBtn.addEventListener("click", () => Auth.logout());

  document.getElementById("round-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById("round-error");
    const successEl = document.getElementById("round-success");
    const btn = document.getElementById("round-submit-btn");

    errorEl.textContent = "";
    successEl.textContent = "";
    btn.disabled = true;

    const jwt = adminSession?.access_token;
    if (!jwt) return;

    const marketType = document.getElementById("market-type").value;
    const threshold = parseInt(document.getElementById("threshold").value, 10);
    const opensAt = new Date(document.getElementById("opens-at").value).toISOString();
    const closesAt = new Date(document.getElementById("closes-at").value).toISOString();
    const endsAt = new Date(document.getElementById("ends-at").value).toISOString();

    const { data: cameras } = await window.sb
      .from("cameras").select("id").eq("is_active", true).limit(1);
    const cameraId = cameras?.[0]?.id;

    const markets = marketType === "over_under"
      ? [
          { label: `Over ${threshold} vehicles`, outcome_key: "over", odds: 1.90 },
          { label: `Under ${threshold} vehicles`, outcome_key: "under", odds: 1.90 },
          { label: `Exactly ${threshold} vehicles`, outcome_key: "exact", odds: 15.00 },
        ]
      : [
          { label: "Cars lead", outcome_key: "car", odds: 2.00 },
          { label: "Trucks lead", outcome_key: "truck", odds: 3.50 },
          { label: "Buses lead", outcome_key: "bus", odds: 4.00 },
          { label: "Motorcycles lead", outcome_key: "motorcycle", odds: 5.00 },
        ];

    try {
      const railwayRes = await fetch("/api/admin/rounds", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({
          camera_id: cameraId,
          market_type: marketType,
          params: { threshold, duration_sec: Math.floor((new Date(endsAt) - new Date(opensAt)) / 1000) },
          opens_at: opensAt,
          closes_at: closesAt,
          ends_at: endsAt,
          markets,
        }),
      });

      if (!railwayRes.ok) {
        const err = await railwayRes.json();
        throw new Error(err.detail || "Failed to create round");
      }

      successEl.textContent = "Round created successfully!";
    } catch (err) {
      errorEl.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });
});

init();
