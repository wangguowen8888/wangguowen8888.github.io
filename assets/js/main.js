(() => {
  const config = window.siteConfig || {};
  const byId = (id) => document.getElementById(id);
  const LOCALE_KEY = "site-locale";
  const GT_COOKIE = "googtrans";
  const GT_CONTAINER_ID = "google_translate_element_hidden";
  const GT_SCRIPT_ID = "google-translate-script";
  const GT_CALLBACK = "__onGoogleTranslateLoaded";
  const normalizeLocale = (value) => (value === "en" ? "en" : "zh");
  const getGtLang = () => {
    const match = document.cookie.match(/(?:^|;\s*)googtrans=([^;]+)/);
    if (!match) return "zh";
    const value = decodeURIComponent(match[1] || "");
    if (/\/en$/i.test(value)) return "en";
    return "zh";
  };
  const getSavedLocale = () => normalizeLocale(localStorage.getItem(LOCALE_KEY) || getGtLang());
  const saveLocale = (locale) => {
    localStorage.setItem(LOCALE_KEY, normalizeLocale(locale));
  };
  const setGtCookie = (lang) => {
    const value = lang === "en" ? "/auto/en" : "/auto/zh-CN";
    const encoded = encodeURIComponent(value);
    const maxAge = 60 * 60 * 24 * 365;
    document.cookie = `${GT_COOKIE}=${encoded}; path=/; max-age=${maxAge}; samesite=lax`;
  };
  const clearGtCookie = () => {
    // Clear broadly to avoid stale cookie scope/path variants.
    document.cookie = `${GT_COOKIE}=; path=/; max-age=0; samesite=lax`;
    document.cookie = `${GT_COOKIE}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; samesite=lax`;
  };
  const ensureGoogleTranslateContainer = () => {
    let container = byId(GT_CONTAINER_ID);
    if (!container) {
      container = document.createElement("div");
      container.id = GT_CONTAINER_ID;
      container.style.position = "fixed";
      container.style.left = "-9999px";
      container.style.top = "0";
      container.style.opacity = "0";
      container.setAttribute("aria-hidden", "true");
      document.body.appendChild(container);
    }
    return container;
  };
  let translateReadyPromise;
  const ensureGoogleTranslate = () => {
    if (translateReadyPromise) return translateReadyPromise;
    translateReadyPromise = new Promise((resolve, reject) => {
      ensureGoogleTranslateContainer();
      const resolveReady = () => {
        try {
          if (!window.google?.translate?.TranslateElement) return;
          if (!window.__googleTranslateElement) {
            window.__googleTranslateElement = new window.google.translate.TranslateElement(
              {
                pageLanguage: "zh-CN",
                includedLanguages: "zh-CN,en",
                autoDisplay: false
              },
              GT_CONTAINER_ID
            );
          }
          resolve();
        } catch (error) {
          reject(error);
        }
      };
      if (window.google?.translate?.TranslateElement) {
        resolveReady();
        return;
      }
      window[GT_CALLBACK] = () => resolveReady();
      const existingScript = byId(GT_SCRIPT_ID);
      if (existingScript) {
        existingScript.addEventListener("error", () => reject(new Error("translate script load failed")), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.id = GT_SCRIPT_ID;
      script.src = `https://translate.google.com/translate_a/element.js?cb=${GT_CALLBACK}`;
      script.async = true;
      script.onerror = () => reject(new Error("translate script load failed"));
      document.head.appendChild(script);
    });
    return translateReadyPromise;
  };
  const waitForTranslateCombo = async (maxAttempt = 50, waitMs = 120) => {
    for (let i = 0; i < maxAttempt; i += 1) {
      const combo = document.querySelector(".goog-te-combo");
      if (combo) return combo;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    return null;
  };
  const triggerTranslateLocale = async (target) => {
    await ensureGoogleTranslate();
    const combo = await waitForTranslateCombo();
    if (!combo) throw new Error("translate combo not found");
    const normalizeTarget = target === "zh" ? "zh-CN" : target;
    const options = Array.from(combo.options || []);
    const hasOption = options.some((option) => option.value === normalizeTarget);
    if (!hasOption) {
      if (normalizeTarget === "zh-CN") {
        // For Chinese source pages, Google Translate may not expose zh-CN in combo.
        // Treat this as no-op instead of failing locale initialization.
        return;
      }
      throw new Error(`translate combo missing ${normalizeTarget} option`);
    }
    combo.value = normalizeTarget;
    combo.dispatchEvent(new Event("input", { bubbles: true }));
    combo.dispatchEvent(new Event("change", { bubbles: true }));
    if (typeof document.createEvent === "function") {
      const legacyEvent = document.createEvent("HTMLEvents");
      legacyEvent.initEvent("change", true, true);
      combo.dispatchEvent(legacyEvent);
    }
  };
  const retriggerTranslation = (target) => {
    setTimeout(async () => {
      try {
        await triggerTranslateLocale(target);
      } catch (error) {
        // Ignore retrigger failures; initial load already attempted.
      }
    }, 1200);
  };
  const setLocaleLoadingState = (isLoading) => {
    document.body.classList.toggle("is-locale-loading", isLoading);
    for (const button of document.querySelectorAll("[data-locale-choice]")) {
      button.classList.toggle("is-loading", isLoading);
      button.setAttribute("aria-busy", isLoading ? "true" : "false");
    }
  };
  const activeGlobalLoadingReasons = new Set();
  const ensureGlobalLoadingNode = () => {
    let overlay = byId("global-loading-overlay");
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.id = "global-loading-overlay";
    overlay.className = "global-loading-overlay";
    overlay.setAttribute("aria-live", "polite");
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML = '<div class="global-loading-spinner" aria-hidden="true"></div><div class="global-loading-text">加载中...</div>';
    document.body.appendChild(overlay);
    return overlay;
  };
  const setGlobalLoadingState = (isLoading, reason = "generic") => {
    if (isLoading) activeGlobalLoadingReasons.add(reason);
    else activeGlobalLoadingReasons.delete(reason);
    const visible = activeGlobalLoadingReasons.size > 0;
    const overlay = ensureGlobalLoadingNode();
    document.body.classList.toggle("is-global-loading", visible);
    overlay.setAttribute("aria-hidden", visible ? "false" : "true");
  };
  const setLocaleButtonState = (locale) => {
    for (const button of document.querySelectorAll("[data-locale-choice]")) {
      const selected = (button.dataset.localeChoice || "zh") === normalizeLocale(locale);
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-current", selected ? "page" : "false");
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    }
  };
  const applyPageLocale = async (locale) => {
    const target = normalizeLocale(locale);
    setLocaleButtonState(target);
    saveLocale(target);
    setLocaleLoadingState(true);
    setGlobalLoadingState(true, "locale-switch");
    try {
      if (target === "zh") {
        setGtCookie("zh");
        await triggerTranslateLocale("zh-CN");
        retriggerTranslation("zh-CN");
      } else {
        setGtCookie("en");
        await triggerTranslateLocale("en");
        retriggerTranslation("en");
      }
      setTimeout(() => setLocaleLoadingState(false), 650);
      setTimeout(() => setGlobalLoadingState(false, "locale-switch"), 650);
    } catch (error) {
      if (target === "en") {
        setGtCookie("en");
      } else {
        clearGtCookie();
      }
      location.reload();
    }
  };
  const normalizePath = (path) => {
    const trimmed = (path || "/").replace(/index\.html$/i, "");
    return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
  };
  const root = document.body?.dataset.root || ".";
  const pageKind = document.body?.dataset.pageKind || "page";
  const footerKind = document.body?.dataset.footerKind || (pageKind === "home" ? "home" : "default");
  const currentLocale = getSavedLocale();
  const contentTypeLabelMap = {
    news: "资讯",
    paper: "论文",
    tool: "工具",
    product: "产品",
    discussion: "讨论"
  };
  const localizeContentTypeLabel = (value) => {
    const key = String(value || "").trim().toLowerCase();
    return contentTypeLabelMap[key] || value;
  };
  const joinHref = (base, path) => {
    if (!path) return `${base}/`;
    return `${base}/${path}`.replace(/\/+/g, "/").replace(":/", "://");
  };
  const createLink = (href, label, className) => {
    const link = document.createElement("a");
    link.href = href;
    link.textContent = label;
    if (className) link.className = className;
    return link;
  };
  const ensureFavicon = () => {
    const href = joinHref(root, config.faviconPath || "assets/favicon.svg");
    let link = document.querySelector('link[rel="icon"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      link.type = "image/svg+xml";
      document.head.appendChild(link);
    }
    link.href = href;
  };
  const renderTopbar = () => {
    const mount = document.querySelector("[data-site-topbar]");
    if (!mount) return;
    const wrapper = document.createElement("div");
    wrapper.className = "topbar";

    const inner = document.createElement("div");
    inner.className = "container topbar-inner";

    const siteName = config.siteName || "AI 工具导航";
    const brand = createLink(joinHref(root, ""), siteName, "brand");
    const logo = document.createElement("span");
    logo.className = "logo";
    logo.setAttribute("aria-hidden", "true");
    const brandText = document.createElement("span");
    brandText.textContent = siteName;
    brand.replaceChildren(logo, brandText);

    const right = document.createElement("div");
    right.className = "topbar-right";

    const nav = document.createElement("nav");
    nav.className = "nav";
    nav.setAttribute("aria-label", "主导航");
    for (const item of config.navItems || []) {
      nav.appendChild(createLink(joinHref(root, item.href), item.label));
    }
    if (pageKind === "home" && config.featuredNavItem) {
      nav.appendChild(
        createLink(
          joinHref(root, config.featuredNavItem.href),
          config.featuredNavItem.label,
          "cta"
        )
      );
    }

    const localeSwitch = document.createElement("div");
    localeSwitch.className = "locale-switch";
    localeSwitch.setAttribute("role", "group");
    localeSwitch.setAttribute("aria-label", "Language switch");

    const zhBtn = createLink("#", "中文", "btn ghost locale-choice");
    zhBtn.dataset.localeChoice = "zh";
    zhBtn.setAttribute("aria-current", currentLocale === "zh" ? "page" : "false");
    zhBtn.setAttribute("aria-pressed", currentLocale === "zh" ? "true" : "false");
    if (currentLocale === "zh") zhBtn.classList.add("is-active");
    zhBtn.textContent = "中文";

    const enBtn = createLink("#", "EN", "btn ghost locale-choice");
    enBtn.dataset.localeChoice = "en";
    enBtn.setAttribute("aria-current", currentLocale === "en" ? "page" : "false");
    enBtn.setAttribute("aria-pressed", currentLocale === "en" ? "true" : "false");
    if (currentLocale === "en") enBtn.classList.add("is-active");
    enBtn.textContent = "EN";

    localeSwitch.append(zhBtn, enBtn);
    right.append(nav, localeSwitch);
    inner.append(brand, right);
    wrapper.appendChild(inner);
    mount.replaceWith(wrapper);
  };
  const renderBreadcrumb = () => {
    const mount = document.querySelector("[data-site-breadcrumb]");
    if (!mount) return;
    const current = document.body?.dataset.breadcrumbCurrent;
    if (!current) {
      mount.remove();
      return;
    }
    const parentLabel = document.body?.dataset.breadcrumbParentLabel;
    const parentHref = document.body?.dataset.breadcrumbParentHref;
    const nav = document.createElement("nav");
    nav.className = "breadcrumb";
    nav.setAttribute("aria-label", "面包屑导航");
    const appendSlash = () => {
      const sep = document.createElement("span");
      sep.textContent = "/";
      nav.appendChild(sep);
    };
    nav.appendChild(createLink(joinHref(root, ""), "首页"));
    if (parentLabel) {
      appendSlash();
      if (parentHref) {
        nav.appendChild(createLink(joinHref(root, parentHref), parentLabel));
      } else {
        const parentSpan = document.createElement("span");
        parentSpan.className = "current";
        parentSpan.textContent = parentLabel;
        nav.appendChild(parentSpan);
      }
    }
    if (!parentLabel || current !== parentLabel) {
      appendSlash();
      const currentSpan = document.createElement("span");
      currentSpan.className = "current";
      currentSpan.textContent = current;
      nav.appendChild(currentSpan);
    }
    mount.replaceWith(nav);
  };
  const renderFooter = () => {
    const mount = document.querySelector("[data-site-footer]");
    if (!mount) return;
    const footer = config.footers?.[footerKind] || config.footers?.default || { text: config.siteName || "" };
    const wrapper = document.createElement("footer");
    wrapper.className = "footer";

    const inner = document.createElement("div");
    inner.className = "container footer-inner";

    const left = document.createElement("div");
    left.append("© ");
    const year = document.createElement("span");
    year.id = "y";
    year.textContent = `${new Date().getFullYear()}`;
    left.append(year, ` ${footer.text || ""}`);

    const linksWrap = document.createElement("div");
    linksWrap.className = "footer-links";
    for (const link of footer.links || []) {
      linksWrap.appendChild(createLink(joinHref(root, link.href), link.label));
    }

    inner.append(left, linksWrap);
    wrapper.appendChild(inner);
    mount.replaceWith(wrapper);
  };

  ensureFavicon();
  renderTopbar();
  renderBreadcrumb();
  renderFooter();

  // Language switch: rely on full-page browser translation.
  const setupLocaleToggle = () => {
    const choiceButtons = Array.from(document.querySelectorAll("[data-locale-choice]"));
    if (!choiceButtons.length) return;
    for (const button of choiceButtons) {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        const nextLocale = button.dataset.localeChoice === "en" ? "en" : "zh";
        if (nextLocale === getSavedLocale()) return;
        await applyPageLocale(nextLocale);
      });
    }
  };

  // Init after topbar is rendered.
  setupLocaleToggle();
  const initSavedLocale = async () => {
    setLocaleLoadingState(true);
    setGlobalLoadingState(true, "locale-init");
    const withTimeout = (promise, ms, message) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(message || `timeout after ${ms}ms`)), ms);
        promise.then((value) => {
          clearTimeout(timer);
          resolve(value);
        }).catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
      });
    try {
      if (currentLocale === "en") {
        setGtCookie("en");
        await withTimeout(triggerTranslateLocale("en"), 5000, "Google Translate init timeout");
        retriggerTranslation("en");
      } else {
        setGtCookie("zh");
        await withTimeout(triggerTranslateLocale("zh-CN"), 5000, "Google Translate init timeout");
        retriggerTranslation("zh-CN");
      }
    } catch (error) {
      // Ignore init failures; locale buttons still work.
    } finally {
      setTimeout(() => setLocaleLoadingState(false), 650);
      setTimeout(() => setGlobalLoadingState(false, "locale-init"), 650);
    }
  };
  initSavedLocale();

  const localizeDailyPageForZh = () => {
    if (currentLocale !== "zh") return;
    for (const heading of document.querySelectorAll(".section-title h2")) {
      heading.textContent = localizeContentTypeLabel(heading.textContent);
    }
    for (const paragraph of document.querySelectorAll(".post p")) {
      paragraph.textContent = paragraph.textContent
        .replace(/类型：\s*([a-z-]+)/gi, (_, type) => `类型：${localizeContentTypeLabel(type)}`)
        .replace(/\b(news|paper|tool|product|discussion)(\d+)条\b/gi, (_, type, count) => `${localizeContentTypeLabel(type)}${count}条`);
    }
  };
  localizeDailyPageForZh();
  const DAILY_TRANSLATION_CACHE_KEY = "daily-zh-translation-cache-v1";
  const readDailyTranslationCache = () => {
    try {
      const raw = localStorage.getItem(DAILY_TRANSLATION_CACHE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  };
  const writeDailyTranslationCache = (cache) => {
    try {
      localStorage.setItem(DAILY_TRANSLATION_CACHE_KEY, JSON.stringify(cache));
    } catch {
      // Ignore quota/write failures.
    }
  };
  const toTranslateEndpoint = (text) =>
    `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=${encodeURIComponent(text)}`;
  const hasEnglish = (text) => /[A-Za-z]/.test(String(text || ""));
  const hasChinese = (text) => /[\u4e00-\u9fff]/.test(String(text || ""));
  const translateToZh = async (text, cache) => {
    const input = String(text || "").trim();
    if (!input || !hasEnglish(input)) return input;
    if (cache[input]) return cache[input];
    try {
      const response = await fetch(toTranslateEndpoint(input), { method: "GET" });
      if (!response.ok) return input;
      const json = await response.json();
      const translated = Array.isArray(json?.[0])
        ? json[0].map((part) => (Array.isArray(part) ? part[0] : "")).join("").trim()
        : "";
      if (translated) {
        cache[input] = translated;
        return translated;
      }
      return input;
    } catch {
      return input;
    }
  };
  const mapWithConcurrency = async (items, limit, mapper) => {
    const list = Array.from(items || []);
    if (!list.length) return [];
    const results = new Array(list.length);
    let nextIndex = 0;
    const workers = new Array(Math.max(1, Math.min(limit || 1, list.length))).fill(0).map(async () => {
      while (nextIndex < list.length) {
        const current = nextIndex;
        nextIndex += 1;
        results[current] = await mapper(list[current], current);
      }
    });
    await Promise.all(workers);
    return results;
  };
  const translateDailyContentForZh = async () => {
    if (currentLocale !== "zh") return;
    if (!location.pathname.includes("/daily/")) return;
    setGlobalLoadingState(true, "daily-translate");
    const cache = readDailyTranslationCache();
    try {
      const titleLinks = Array.from(document.querySelectorAll(".post .card h3 a"));
      const titleTasks = titleLinks
        .map((link) => {
          const original = (link.dataset.originalText || link.textContent || "").trim();
          if (!original) return null;
          if (!link.dataset.originalText) link.dataset.originalText = original;
          return { node: link, original };
        })
        .filter(Boolean);
      await mapWithConcurrency(titleTasks, 4, async (task) => {
        const translated = await translateToZh(task.original, cache);
        if (translated && translated !== task.original) task.node.textContent = translated;
      });

      const summaryNodes = Array.from(document.querySelectorAll(".post .card p:not(.meta)"));
      const summaryTasks = summaryNodes
        .map((node) => {
          const original = (node.dataset.originalText || node.textContent || "").trim();
          if (!original) return null;
          if (!node.dataset.originalText) node.dataset.originalText = original;
          if (hasChinese(original)) {
            const match = original.match(/^(来源：.+?，类型：.+?，)([\s\S]+)$/);
            if (!match) return null;
            const prefix = match[1];
            const body = (match[2] || "").trim();
            if (!body || !hasEnglish(body)) return null;
            return { node, original, prefix, body, mode: "prefix" };
          }
          return { node, original, mode: "full" };
        })
        .filter(Boolean);
      await mapWithConcurrency(summaryTasks, 4, async (task) => {
        if (task.mode === "prefix") {
          const translatedBody = await translateToZh(task.body, cache);
          if (translatedBody && translatedBody !== task.body) task.node.textContent = `${task.prefix}${translatedBody}`;
          return;
        }
        const translated = await translateToZh(task.original, cache);
        if (translated && translated !== task.original) task.node.textContent = translated;
      });
      writeDailyTranslationCache(cache);
    } finally {
      setGlobalLoadingState(false, "daily-translate");
    }
  };
  translateDailyContentForZh();
  const setupGlobalLoadingForNavigation = () => {
    const isInternalHref = (href) => {
      if (!href) return false;
      if (href.startsWith("#")) return false;
      if (/^(mailto:|tel:|javascript:)/i.test(href)) return false;
      const url = new URL(href, location.href);
      return url.origin === location.origin;
    };
    document.addEventListener("click", (event) => {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!link) return;
      if (link.dataset.localeChoice) return;
      if (link.getAttribute("target") === "_blank") return;
      if (link.hasAttribute("download")) return;
      const href = link.getAttribute("href");
      if (!isInternalHref(href)) return;
      setGlobalLoadingState(true, "navigation");
    });
    window.addEventListener("pageshow", () => setGlobalLoadingState(false, "navigation"));
    window.addEventListener("load", () => setGlobalLoadingState(false, "navigation"));
  };
  setupGlobalLoadingForNavigation();

  // Highlight current navigation item.
  const currentPath = normalizePath(location.pathname);
  for (const link of document.querySelectorAll(".nav a")) {
    const href = link.getAttribute("href");
    if (!href || href.startsWith("http")) continue;
    const resolved = new URL(href, location.href);
    const linkPath = normalizePath(resolved.pathname);
    if (linkPath !== "/" && currentPath.startsWith(linkPath)) {
      link.setAttribute("aria-current", "page");
    }
  }

  // Lightweight client-side filter for lists/cards.
  const q = byId("site-search");
  if (q) {
    const targets = Array.from(document.querySelectorAll("[data-search-item]"));
    const getText = (el) => (el.getAttribute("data-search-text") || el.textContent || "").toLowerCase();
    const empty = byId("search-empty");
    const targetText = targets.map((el) => getText(el));
    const run = () => {
      const term = (q.value || "").trim().toLowerCase();
      for (let i = 0; i < targets.length; i += 1) {
        const el = targets[i];
        const hit = term === "" || targetText[i].includes(term);
        el.style.display = hit ? "" : "none";
      }
      if (empty) {
        const visible = targets.some((el) => el.style.display !== "none");
        empty.style.display = visible ? "none" : "";
      }
    };
    let raf = 0;
    q.addEventListener("input", () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = 0;
        run();
      });
    });
    run();
  }

  // Copy current page URL with a fallback for non-secure contexts.
  const copyBtn = document.querySelector("[data-copy-link]");
  const fallbackCopyText = (text) => {
    const input = document.createElement("textarea");
    input.value = text;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    input.setSelectionRange(0, input.value.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(input);
    return ok;
  };
  if (copyBtn) {
    const originalText = copyBtn.textContent;
    copyBtn.addEventListener("click", async () => {
      const text = location.href;
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
        } else if (!fallbackCopyText(text)) {
          throw new Error("copy failed");
        }
        copyBtn.textContent = "已复制链接";
      } catch {
        copyBtn.textContent = "复制失败，请手动复制";
      }
      setTimeout(() => {
        copyBtn.textContent = originalText;
      }, 1600);
    });
  }

  // AI chat tester with client-side usage limits.
  const chatTesterRoot = byId("chat-tester");
  if (chatTesterRoot) {
    const inputEl = byId("chat-input");
    const sendBtn = byId("chat-send");
    const messagesEl = byId("chat-messages");
    const inputWrapEl = document.querySelector("#chat-tester .chat-input-wrap");
    let loadingMessageEl = null;
    const DAILY_CHAT_LIMIT = 5;
    const CHAT_USAGE_KEY = "chat-usage-v1";
    const CHAT_HISTORY_KEY = `chat-history-v1:${location.pathname}`;
    const CHAT_HISTORY_MAX_ITEMS = 200;
    const CHAT_HISTORY_MAX_CHARS = 60000;
    const getLocalDateKey = () => {
      const parts = new Intl.DateTimeFormat("en-CA", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).formatToParts(new Date());
      const year = parts.find((p) => p.type === "year")?.value || "1970";
      const month = parts.find((p) => p.type === "month")?.value || "01";
      const day = parts.find((p) => p.type === "day")?.value || "01";
      return `${year}-${month}-${day}`;
    };
    const readChatUsage = () => {
      try {
        const raw = localStorage.getItem(CHAT_USAGE_KEY);
        if (!raw) return { dateKey: getLocalDateKey(), count: 0 };
        const parsed = JSON.parse(raw);
        const dateKey = String(parsed?.dateKey || "").trim() || getLocalDateKey();
        const count = Number(parsed?.count || 0);
        return { dateKey, count: Number.isFinite(count) && count > 0 ? Math.floor(count) : 0 };
      } catch {
        return { dateKey: getLocalDateKey(), count: 0 };
      }
    };
    const writeChatUsage = (usage) => {
      try {
        localStorage.setItem(CHAT_USAGE_KEY, JSON.stringify(usage));
      } catch {
        // Ignore quota/write failures.
      }
    };
    const getTodayUsage = () => {
      const today = getLocalDateKey();
      const stored = readChatUsage();
      if (stored.dateKey !== today) {
        const reset = { dateKey: today, count: 0 };
        writeChatUsage(reset);
        return reset;
      }
      return stored;
    };
    const incrementTodayUsage = () => {
      const usage = getTodayUsage();
      const next = { ...usage, count: usage.count + 1 };
      writeChatUsage(next);
      return next;
    };
    const ensureLimitHint = () => {
      let hint = chatTesterRoot.querySelector(".chat-limit-hint");
      if (hint) return hint;
      hint = document.createElement("div");
      hint.className = "chat-limit-hint";
      hint.setAttribute("aria-live", "polite");
      hint.setAttribute("role", "status");
      chatTesterRoot.prepend(hint);
      return hint;
    };
    const updateLimitUi = () => {
      const hint = ensureLimitHint();
      const usage = getTodayUsage();
      const remaining = Math.max(0, DAILY_CHAT_LIMIT - usage.count);
      hint.textContent = `今日剩余 ${remaining}/${DAILY_CHAT_LIMIT} 次`;
      if (sendBtn) {
        const busy = chatTesterRoot.classList.contains("is-busy");
        sendBtn.disabled = busy || remaining <= 0;
        if (!busy) {
          sendBtn.textContent = remaining <= 0 ? "今日次数用完" : "发送";
        }
      }
      if (inputEl) {
        inputEl.disabled = chatTesterRoot.classList.contains("is-busy") || remaining <= 0;
      }
      return { remaining };
    };
    const ensureBusyIndicator = () => {
      let indicator = chatTesterRoot.querySelector(".chat-busy-indicator");
      if (indicator) return indicator;
      indicator = document.createElement("div");
      indicator.className = "chat-busy-indicator";
      indicator.setAttribute("aria-hidden", "true");
      chatTesterRoot.appendChild(indicator);
      return indicator;
    };
    ensureBusyIndicator();
    updateLimitUi();
    const readHistory = () => {
      try {
        const raw = localStorage.getItem(CHAT_HISTORY_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    };
    const writeHistory = (items) => {
      try {
        localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(items));
      } catch {
        // Ignore quota/write failures.
      }
    };
    const trimHistory = (items) => {
      const list = Array.isArray(items) ? items.filter(Boolean) : [];
      const sliced = list.slice(-CHAT_HISTORY_MAX_ITEMS);
      let totalChars = 0;
      const kept = [];
      for (let i = sliced.length - 1; i >= 0; i -= 1) {
        const item = sliced[i];
        const role = String(item?.role || "").trim();
        const text = String(item?.text || "").trim();
        if (!role || !text) continue;
        totalChars += text.length;
        if (totalChars > CHAT_HISTORY_MAX_CHARS) break;
        kept.push({ role, text, ts: Number(item?.ts || Date.now()) });
      }
      kept.reverse();
      return kept;
    };
    const addMessage = (role, text, options = {}) => {
      if (!messagesEl) return;
      const item = document.createElement("div");
      item.className = `chat-message ${role}`;
      item.textContent = text;
      messagesEl.appendChild(item);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      const shouldPersist = options.persist !== false && role !== "loading";
      if (shouldPersist) {
        const history = readHistory();
        history.push({ role, text, ts: Date.now() });
        writeHistory(trimHistory(history));
      }
    };
    const restoreHistory = () => {
      if (!messagesEl) return;
      const history = trimHistory(readHistory());
      if (!history.length) return;
      for (const item of history) {
        addMessage(item.role, item.text, { persist: false });
      }
    };
    restoreHistory();
    const setChatBusy = (isBusy) => {
      chatTesterRoot.classList.toggle("is-busy", isBusy);
      updateLimitUi();
      if (sendBtn) {
        sendBtn.disabled = isBusy;
        sendBtn.textContent = isBusy ? "思考中..." : "发送";
      }
      if (inputEl) {
        inputEl.disabled = isBusy;
        inputEl.setAttribute("aria-busy", isBusy ? "true" : "false");
      }
      if (inputWrapEl) inputWrapEl.classList.toggle("is-busy", isBusy);
    };
    const showLoadingMessage = () => {
      if (!messagesEl || loadingMessageEl) return;
      loadingMessageEl = document.createElement("div");
      loadingMessageEl.className = "chat-message loading";
      loadingMessageEl.textContent = "AI 正在思考，请稍候...";
      messagesEl.appendChild(loadingMessageEl);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    };
    const hideLoadingMessage = () => {
      if (!loadingMessageEl) return;
      loadingMessageEl.remove();
      loadingMessageEl = null;
    };
    const canSend = () => {
      if (!inputEl) return false;
      const text = (inputEl.value || "").trim();
      if (!text) return false;
      const { remaining } = updateLimitUi();
      if (remaining <= 0) return false;
      return true;
    };
    const pickFirstText = (...values) => {
      for (const value of values) {
        if (typeof value === "string" && value.trim()) return value.trim();
      }
      return "";
    };
    const extractReplyFromPayload = (payload) => {
      if (!payload || typeof payload !== "object") return "";
      if (typeof payload.reply === "string") return payload.reply;
      const direct = pickFirstText(
        payload.output_text,
        payload.text,
        payload?.message,
        payload?.content
      );
      if (direct) return direct;
      const nested = pickFirstText(
        payload?.reply?.text,
        payload?.reply?.value,
        payload?.text?.value,
        payload?.data?.reply,
        payload?.data?.output_text,
        payload?.response?.reply,
        payload?.response?.output_text
      );
      if (nested) return nested;
      const choices = payload?.choices;
      if (Array.isArray(choices)) {
        for (const choice of choices) {
          const choiceText = pickFirstText(
            choice?.message?.content,
            choice?.message?.content?.text,
            choice?.message?.content?.value,
            choice?.delta?.content,
            choice?.delta?.content?.text,
            choice?.delta?.content?.value,
            choice?.text
          );
          if (choiceText) return choiceText;
        }
      }
      return "";
    };
    const callBackendApi = async (prompt) => {
      const endpoint = String(window.siteConfig?.chatApiEndpoint || "").trim();
      if (!endpoint) {
        return "当前未配置 chatApiEndpoint，请在 site-config.js 配置后端接口。";
      }
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt })
        });
        const rawText = await response.text().catch(() => "");
        let data = null;
        if (rawText) {
          try {
            data = JSON.parse(rawText);
          } catch {
            data = null;
          }
        }
        const reply = extractReplyFromPayload(data);
        if (reply) return reply;
        if (typeof data?.error === "string" && data.error.trim()) {
          return `后端错误：${data.error.trim()}`;
        }
        if (!response.ok) return `后端接口调用失败（HTTP ${response.status}）。`;
        const compactRaw = rawText.trim().slice(0, 260);
        if (compactRaw) {
          return `后端已返回，但未匹配到可展示文本。原始响应片段：${compactRaw}`;
        }
        return "后端返回为空，请检查 Worker 输出。";
      } catch {
        return "后端接口调用失败，请检查网络、接口地址或服务状态。";
      }
    };
    if (sendBtn && inputEl) {
      sendBtn.addEventListener("click", async () => {
        if (!canSend()) {
          const { remaining } = updateLimitUi();
          if (remaining <= 0) {
            addMessage("system", `今日已达到 ${DAILY_CHAT_LIMIT} 次上限，请明天再来。`);
          }
          return;
        }
        incrementTodayUsage();
        updateLimitUi();
        const prompt = inputEl.value.trim();
        addMessage("user", prompt);
        setChatBusy(true);
        showLoadingMessage();
        try {
          const reply = await callBackendApi(prompt);
          hideLoadingMessage();
          addMessage("assistant", reply);
        } finally {
          hideLoadingMessage();
          setChatBusy(false);
        }
        inputEl.value = "";
        inputEl.focus();
      });
    }
  }
})();

