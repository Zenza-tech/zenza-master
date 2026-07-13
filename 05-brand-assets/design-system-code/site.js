/* Zenza FID — shared site behavior: theme toggle + scroll reveal + nav active state */

(function () {
  // ---- theme: light / dark / system --------------------------------------
  // Three modes. "system" is the default — it follows the visitor's OS
  // setting live (including if they change it while the page is open).
  // Session-only by design — no localStorage/cookies, so it resets to
  // "system" on a fresh page load rather than remembering a manual choice.
  const root = document.documentElement;
  const mql = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;
  let currentMode = "system";

  function resolvedTheme() {
    if (currentMode === "light") return "light";
    if (currentMode === "dark") return "dark";
    return mql && mql.matches ? "light" : "dark"; // system
  }

  function render() {
    root.setAttribute("data-theme", resolvedTheme());
    document.querySelectorAll(".theme-toggle button").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === currentMode);
    });
  }

  function setMode(mode) {
    currentMode = mode;
    render();
  }

  render();

  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".theme-toggle button");
    if (!btn) return;
    setMode(btn.dataset.mode);
  });

  // live-update while in "system" mode if the OS theme changes
  if (mql) {
    const onChange = () => {
      if (currentMode === "system") render();
    };
    if (mql.addEventListener) mql.addEventListener("change", onChange);
    else if (mql.addListener) mql.addListener(onChange); // older Safari fallback
  }

  // ---- scroll reveal ------------------------------------------------------
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) e.target.classList.add("in");
      });
    },
    { threshold: 0.1 }
  );
  window.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("section .wrap > *").forEach((el) => {
      el.classList.add("reveal");
      io.observe(el);
    });

    // ---- nav active state based on current page ----
    const current = location.pathname.split("/").pop() || "index.html";
    document.querySelectorAll(".navlinks a").forEach((a) => {
      const href = a.getAttribute("href") || "";
      if (href === current) a.classList.add("active");
    });
  });
})();
