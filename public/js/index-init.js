(async () => {
  const session = await Auth.getSession();
  if (session) {
    document.getElementById("nav-auth").classList.add("hidden");
    document.getElementById("nav-user").classList.remove("hidden");
  }

  const video = document.getElementById("live-video");
  await Stream.init(video);

  Counter.init();
  Markets.init();

  window.addEventListener("bet:placed", () => {
    Markets.loadMarkets();
  });
})();
