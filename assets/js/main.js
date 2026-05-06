(() => {
  const config = window.siteConfig || {};
  const byId = (id) => document.getElementById(id);
  const debugLog = (...args) => console.log("[locale-debug]", ...args);
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
    debugLog("set cookie", { key: GT_COOKIE, value, cookie: document.cookie });
  };
  const clearGtCookie = () => {
    // Clear broadly to avoid stale cookie scope/path variants.
    document.cookie = `${GT_COOKIE}=; path=/; max-age=0; samesite=lax`;
    document.cookie = `${GT_COOKIE}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; samesite=lax`;
    debugLog("clear cookie", { key: GT_COOKIE, cookie: document.cookie });
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
        debugLog("retrigger translation finished");
      } catch (error) {
        debugLog("retrigger translation failed", error);
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
  const normalizeTranslateOverlay = () => {
    const selectors = [
      ".goog-te-banner-frame.skiptranslate",
      "iframe.goog-te-banner-frame",
      "body > .skiptranslate",
      "body > .skiptranslate > iframe.skiptranslate",
      ".VIpgJd-ZVi9od-ORHb-OEVmcd"
    ];
    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        node.style.setProperty("display", "none", "important");
        node.style.setProperty("visibility", "hidden", "important");
        node.setAttribute("aria-hidden", "true");
      }
    }
    document.body.style.setProperty("top", "0px", "important");
    document.body.style.setProperty("position", "static", "important");
    document.documentElement.style.setProperty("top", "0px", "important");
  };
  const setupTranslateOverlayGuard = () => {
    normalizeTranslateOverlay();
    const observer = new MutationObserver(() => normalizeTranslateOverlay());
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class"]
    });
    setInterval(normalizeTranslateOverlay, 800);
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
    debugLog("applyPageLocale start", { target, savedLocale: getSavedLocale(), cookieLang: getGtLang() });
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
      debugLog("translation runtime failed; fallback to reload", error);
      if (target === "en") {
        setGtCookie("en");
      } else {
        clearGtCookie();
      }
      debugLog("reload page for deterministic full-language switch", { target });
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
    linksWrap.style.display = "flex";
    linksWrap.style.gap = "12px";
    linksWrap.style.flexWrap = "wrap";
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
        debugLog("locale button clicked", {
          nextLocale,
          currentSaved: getSavedLocale(),
          currentCookie: getGtLang()
        });
        if (nextLocale === getSavedLocale()) return;
        await applyPageLocale(nextLocale);
      });
    }
  };

  // Init after topbar is rendered.
  setupLocaleToggle();
  setupTranslateOverlayGuard();
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
      debugLog("init locale failed", error);
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
  const translateDailyContentForZh = async () => {
    if (currentLocale !== "zh") return;
    if (!location.pathname.includes("/daily/")) return;
    setGlobalLoadingState(true, "daily-translate");
    const cache = readDailyTranslationCache();
    try {
      const titleLinks = Array.from(document.querySelectorAll(".post .card h3 a"));
      for (const link of titleLinks) {
        const original = (link.dataset.originalText || link.textContent || "").trim();
        if (!original) continue;
        if (!link.dataset.originalText) link.dataset.originalText = original;
        const translated = await translateToZh(original, cache);
        if (translated && translated !== original) {
          link.textContent = translated;
        }
      }
      const summaryNodes = Array.from(document.querySelectorAll(".post .card p:not(.meta)"));
      for (const node of summaryNodes) {
        const original = (node.dataset.originalText || node.textContent || "").trim();
        if (!original) continue;
        if (!node.dataset.originalText) node.dataset.originalText = original;
        if (hasChinese(original)) {
          const match = original.match(/^(来源：.+?，类型：.+?，)([\s\S]+)$/);
          if (!match) continue;
          const prefix = match[1];
          const body = (match[2] || "").trim();
          if (!body || !hasEnglish(body)) continue;
          const translatedBody = await translateToZh(body, cache);
          if (translatedBody && translatedBody !== body) {
            node.textContent = `${prefix}${translatedBody}`;
          }
          continue;
        }
        const translated = await translateToZh(original, cache);
        if (translated && translated !== original) {
          node.textContent = translated;
        }
      }
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
    const CHAT_DEBUG_FLAG = "chat-debug";
    const isChatDebugEnabled = () => {
      const fromStorage = String(localStorage.getItem(CHAT_DEBUG_FLAG) || "").trim().toLowerCase();
      const fromQuery = new URLSearchParams(location.search).get("chat_debug");
      return fromStorage === "1" || fromStorage === "true" || fromQuery === "1" || fromQuery === "true";
    };
    const chatDebugEnabled = isChatDebugEnabled();
    const addMessage = (role, text) => {
      if (!messagesEl) return;
      const item = document.createElement("div");
      item.className = `chat-message ${role}`;
      item.textContent = text;
      messagesEl.appendChild(item);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    };
    const formatDebugValue = (value) => {
      if (typeof value === "string") return value;
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return String(value);
      }
    };
    const addDebugMessage = (label, value) => {
      if (!chatDebugEnabled) return;
      const body = formatDebugValue(value);
      addMessage("system", `[debug] ${label}\n${body}`);
      console.log(`[chat-debug] ${label}`, value);
    };
    const setChatBusy = (isBusy) => {
      chatTesterRoot.classList.toggle("is-busy", isBusy);
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
      const direct = pickFirstText(
        payload.reply,
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
      const debugEnabled = true;
      addDebugMessage("endpoint", endpoint);
      addDebugMessage("prompt", prompt);
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, debug: debugEnabled ? "1" : "0" }),
        });
        addDebugMessage("http_status", response.status);
        addDebugMessage("content_type", response.headers.get("content-type") || "");
        const rawText = await response.text().catch(() => "");
        addDebugMessage("raw_response", rawText.slice(0, 1600));
        const data = rawText ? JSON.parse(rawText) : null;
        addDebugMessage("json_response", data);
        const reply = extractReplyFromPayload(data);
        addDebugMessage("parsed_reply", reply || "(empty)");
        if (reply) return reply;
        if (typeof data?.error === "string" && data.error.trim()) {
          let debugText = "";
          if (Array.isArray(data?.upstream_attempts) && data.upstream_attempts.length) {
            const detail = data.upstream_attempts
              .map((attempt) => {
                const tag = String(attempt?.tag || "unknown");
                const status = String(attempt?.status || "-");
                const hasText = attempt?.has_text ? "yes" : "no";
                return `${tag} [status=${status}, has_text=${hasText}]`;
              })
              .join(" | ");
            debugText = `\n\n[debug] upstream_attempts: ${detail}`;
          }
          if (typeof data?.upstream_attempt === "string" && data.upstream_attempt.trim()) {
            debugText += `\n[debug] upstream_attempt: ${data.upstream_attempt.trim()}`;
          }
          if (typeof data?.upstream_content_type === "string" && data.upstream_content_type.trim()) {
            debugText += `\n[debug] upstream_content_type: ${data.upstream_content_type.trim()}`;
          }
          if (typeof data?.upstream_status !== "undefined") {
            debugText += `\n[debug] upstream_status: ${data.upstream_status}`;
          }
          return `后端错误：${data.error.trim()}${debugText}`;
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
          return;
        }
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

