(() => {
  const abs = raw => {
    if (!raw) return '';
    try { return new URL(raw, location.href).href; } catch { return ''; }
  };

  const cleanText = value => String(value || '').replace(/\s+/g, ' ').trim();
  const unique = arr => [...new Set(arr.map(cleanText).filter(Boolean))];
  const meta = (...names) => {
    for (const name of names) {
      const node = document.querySelector(`meta[property="${CSS.escape(name)}"],meta[name="${CSS.escape(name)}"]`);
      const value = node?.content?.trim();
      if (value) return value;
    }
    return '';
  };

  function readJsonLd() {
    const rows = [];
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const parsed = JSON.parse(script.textContent || 'null');
        if (Array.isArray(parsed)) rows.push(...parsed); else if (parsed) rows.push(parsed);
      } catch {}
    }
    return rows;
  }

  function collectVideoObjects(jsonLd) {
    const out = [];
    const visit = value => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) { value.forEach(visit); return; }
      const type = Array.isArray(value['@type']) ? value['@type'].join(' ') : String(value['@type'] || '');
      if (/VideoObject/i.test(type) || value.embedUrl || value.contentUrl) out.push(value);
      Object.values(value).forEach(visit);
    };
    jsonLd.forEach(visit);
    return out;
  }

  function tagCandidates() {
    const selectors = [
      'a[href*="/tags/"]','a[href*="/tag/"]','a[href*="/categories/"]','a[href*="/category/"]',
      '[class*="tag"] a','[class*="categories"] a','[class*="category"] a'
    ];
    const values = [];
    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        const text = cleanText(node.textContent);
        if (text && text.length <= 48) values.push(text);
        if (values.length > 80) break;
      }
    }
    values.push(...String(meta('keywords')).split(','));
    return unique(values).slice(0, 40);
  }

  function candidateRelated() {
    const host = location.hostname.replace(/^www\./, '');
    const current = location.href.split('#')[0];
    const patterns = host.includes('pornhub')
      ? ['a[href*="view_video.php?viewkey="]']
      : host.includes('xhamster')
        ? ['a[href*="/videos/"]']
        : host.includes('xvideos')
          ? ['a[href*="/video"]']
          : ['a[href*="/video"]','a[href*="/videos/"]','a[href*="watch"]'];
    const seen = new Set([current]);
    const out = [];
    for (const selector of patterns) {
      for (const a of document.querySelectorAll(selector)) {
        if (out.length >= 24) break;
        const url = abs(a.getAttribute('href'));
        if (!url || seen.has(url) || !/^https?:/i.test(url)) continue;
        try {
          const h = new URL(url).hostname.replace(/^www\./, '');
          if (h !== host && !h.endsWith(`.${host}`) && !host.endsWith(`.${h}`)) continue;
        } catch { continue; }
        const root = a.closest('article,li,[class*="video"],[class*="thumb"],[class*="item"],[class*="card"]') || a;
        const img = root.querySelector?.('img') || a.querySelector('img');
        const title = cleanText(a.getAttribute('title') || img?.alt || root.getAttribute?.('title') || root.textContent).slice(0, 220);
        const thumbnail = abs(img?.currentSrc || img?.src || img?.getAttribute('data-src') || img?.getAttribute('data-lazy-src') || img?.getAttribute('data-original') || '');
        if (!title && !thumbnail) continue;
        seen.add(url);
        out.push({ title: title || 'Related video', url, thumbnail });
      }
    }
    return out;
  }

  function scanPage() {
    const jsonLd = readJsonLd();
    const videos = collectVideoObjects(jsonLd);
    const firstVideo = videos[0] || {};
    const canonical = abs(document.querySelector('link[rel="canonical"]')?.href) || location.href;
    const title = cleanText(
      meta('og:title','twitter:title') ||
      firstVideo.name ||
      document.querySelector('h1')?.textContent ||
      document.title ||
      canonical
    );
    const thumbnailRaw = meta('og:image','twitter:image') ||
      (Array.isArray(firstVideo.thumbnailUrl) ? firstVideo.thumbnailUrl[0] : firstVideo.thumbnailUrl) ||
      document.querySelector('video[poster]')?.poster || '';
    const embedUrl = abs(meta('twitter:player') || firstVideo.embedUrl || document.querySelector('iframe[src*="embed"],iframe[src*="player"]')?.src || '');
    const mediaUrl = abs(meta('og:video:secure_url','og:video:url','og:video') || firstVideo.contentUrl || document.querySelector('video[src],video source[src]')?.src || '');
    const tags = unique([
      ...tagCandidates(),
      ...(Array.isArray(firstVideo.keywords) ? firstVideo.keywords : String(firstVideo.keywords || '').split(','))
    ]).slice(0, 40);
    return {
      url: canonical,
      pageUrl: location.href,
      title,
      description: cleanText(meta('og:description','description','twitter:description')).slice(0, 1000),
      thumbnail: abs(thumbnailRaw),
      embedUrl,
      mediaUrl,
      duration: firstVideo.duration || '',
      tags,
      related: candidateRelated(),
      source: location.hostname.replace(/^www\./, '')
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'NOX_SCAN_PAGE') {
      try { sendResponse({ ok: true, data: scanPage() }); }
      catch (error) { sendResponse({ ok: false, error: error?.message || String(error) }); }
    }
  });

  const allowedWebBridge = () => location.hostname === 'nox-vault.github.io' && location.pathname.startsWith('/noxvault');
  window.addEventListener('message', async event => {
    if (event.source !== window || !allowedWebBridge()) return;
    const msg = event.data;
    if (!msg || msg.source !== 'nox-vault-web' || !msg.requestId || !msg.type) return;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'WEB_BRIDGE', action: msg.type, payload: msg.payload || {} });
      window.postMessage({ source: 'nox-vault-extension', requestId: msg.requestId, response }, location.origin);
    } catch (error) {
      window.postMessage({ source: 'nox-vault-extension', requestId: msg.requestId, response: { ok: false, error: error?.message || String(error) } }, location.origin);
    }
  });
})();
