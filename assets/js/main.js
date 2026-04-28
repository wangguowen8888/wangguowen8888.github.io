(() => {
  const byId = (id) => document.getElementById(id);

  // Lightweight client-side filter for lists/cards.
  const q = byId("site-search");
  if (q) {
    const targets = Array.from(document.querySelectorAll("[data-search-item]"));
    const getText = (el) => (el.getAttribute("data-search-text") || el.textContent || "").toLowerCase();
    const run = () => {
      const term = (q.value || "").trim().toLowerCase();
      for (const el of targets) {
        const hit = term === "" || getText(el).includes(term);
        el.style.display = hit ? "" : "none";
      }
      const empty = byId("search-empty");
      if (empty) {
        const visible = targets.some((el) => el.style.display !== "none");
        empty.style.display = visible ? "none" : "";
      }
    };
    q.addEventListener("input", run);
    run();
  }

  // Copy current page URL.
  const copyBtn = document.querySelector("[data-copy-link]");
  if (copyBtn && navigator.clipboard) {
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(location.href);
        copyBtn.textContent = "已复制链接";
        setTimeout(() => (copyBtn.textContent = "复制本文链接"), 1400);
      } catch {
        // ignore
      }
    });
  }
})();

