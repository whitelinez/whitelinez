(async () => {
  const session = await Auth.getSession();
  if (session) {
    document.getElementById("nav-auth").classList.add("hidden");
    document.getElementById("nav-user").classList.remove("hidden");
  }

  // Play overlay
  document.getElementById("btn-play")?.addEventListener("click", () => {
    document.getElementById("live-video")?.play();
    document.getElementById("play-overlay")?.classList.add("hidden");
  });

  // Logout
  document.getElementById("btn-logout")?.addEventListener("click", () => Auth.logout());

  // Bet modal
  document.getElementById("modal-backdrop")?.addEventListener("click", () => Bet.closeModal());
  document.getElementById("modal-close")?.addEventListener("click", () => Bet.closeModal());
  document.getElementById("modal-amount")?.addEventListener("input", () => Bet.updatePayout());
  document.getElementById("modal-submit")?.addEventListener("click", () => Bet.submit());

  const video = document.getElementById("live-video");
  await Stream.init(video);

  const zoneCanvas = document.getElementById("zone-canvas");
  ZoneOverlay.init(video, zoneCanvas);

  const detectionCanvas = document.getElementById("detection-canvas");
  DetectionOverlay.init(video, detectionCanvas);

  Counter.init();
  Markets.init();

  window.addEventListener("bet:placed", () => {
    Markets.loadMarkets();
  });
})();
