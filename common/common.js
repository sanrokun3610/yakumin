// ==================================================================
// サンロくんのほけんしつ 共通 LIFF 認証 + UI (v3.17.13 / Phase 7)
// v3.17.10: sig キャッシュで 2回目以降 認証スキップ (体感速度大幅改善)
// v3.17.12: 認証中表示を控えめに (背景透明 + 小灰色 「読込中…」)
// v3.17.13: doFullAuth を init 外に出して hoisting 問題を回避 (体重/記録/血圧/設定の認証失敗修正)
// 各 Web App ページから読み込んで使う。
// 使用方法: window.__SANRO__ = { liffId, deployUrl, onReady } を定義 → SanroBoot.init() 呼び出し
// v3.17.9: ヘッダーに共通戻るボタン (グレー) を自動挿入
// ==================================================================
window.SanroBoot = (function() {
  var APP = { userId: '', sig: '', displayName: '', deployUrl: '', liffId: '' };

  function $(id) { return document.getElementById(id); }
  function esc(s) { var d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }

  function showLoading(container, msg) {
    if (!container) return;
    /* v3.17.12: 認証中表示を控えめに (画面が真っ白に見える違和感を軽減) */
    container.innerHTML = '<div class="sanro-loading" style="background:transparent;border:none;color:#999;font-weight:normal">読込中…</div>';
  }
  function showError(container, msg) {
    if (!container) return;
    container.innerHTML = '<div class="sanro-error">⚠ ' + esc(msg) + '</div>';
  }

  function toast(msg, type) {
    var t = $('sanro-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'sanro-toast';
      t.className = 'sanro-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.remove('hidden');
    t.style.background = type === 'success' ? 'rgba(22,163,74,0.95)' :
                         type === 'error'   ? 'rgba(220,38,38,0.95)' :
                                              'rgba(31,41,55,0.9)';
    t.onclick = function() { t.classList.add('hidden'); };
    if (type === 'success') setTimeout(function(){ t.classList.add('hidden'); }, 2500);
    else if (type === 'error') setTimeout(function(){ t.classList.add('hidden'); }, 8000);
  }

  function fetchJson(url, opts) {
    opts = opts || {};
    if (opts.method === 'POST') {
      opts.headers = Object.assign({ 'Content-Type': 'text/plain;charset=UTF-8' }, opts.headers || {});
      opts.redirect = 'follow';
    }
    return fetch(url, opts).then(function(r) {
      return r.text().then(function(txt) {
        try { return JSON.parse(txt); }
        catch (e) {
          // 生レスポンス(URLやHTML)は画面に出さず、console だけに残す
          try { console.error('parse_fail raw:', txt.substring(0, 500)); } catch (e2) {}
          throw new Error('サーバー応答エラー (再度開き直してください)');
        }
      });
    });
  }

  // v3.17.9 くまさんFB: 共通戻るボタンを sanro-header-title の左に自動挿入
  function injectBackButton() {
    try {
      var titleEl = document.querySelector('.sanro-header-title');
      if (!titleEl) return;
      // 既に存在すれば skip
      if (titleEl.querySelector('.sanro-back-btn')) return;
      // 既存の文字を保持して span でラップ
      var originalText = titleEl.textContent;
      titleEl.innerHTML = '';
      var backBtn = document.createElement('button');
      backBtn.className = 'sanro-back-btn';
      backBtn.textContent = '← 戻る';
      backBtn.setAttribute('style', 'background:#6b7280 !important;color:#fff !important;border-color:#4b5563 !important');
      backBtn.addEventListener('click', close);
      titleEl.appendChild(backBtn);
      var titleText = document.createElement('span');
      titleText.className = 'sanro-header-title-text';
      titleText.textContent = originalText;
      titleEl.appendChild(titleText);
    } catch (e) {}
  }

  // v3.17.10: 認証 sig キャッシュ (体感速度改善)
  // - 12h TTL でキャッシュ
  // - 2回目以降は LIFF init / getProfile / GAS sign API を全部スキップ → 即 onReady
  // - バックグラウンドで再認証 (期限間近なら sig 更新)
  var SIG_CACHE_TTL_MS = 12 * 60 * 60 * 1000;  // 12h
  function __sigCacheKey() { return 'sanro_sig_cache_' + (APP.liffId || 'default'); }
  function loadSigCache() {
    try {
      var raw = localStorage.getItem(__sigCacheKey());
      if (!raw) return null;
      var c = JSON.parse(raw);
      if (!c || !c.userId || !c.sig || !c.expireAt) return null;
      if (c.expireAt < Date.now()) return null;
      return c;
    } catch (e) { return null; }
  }
  function saveSigCache(userId, sig, displayName) {
    try {
      localStorage.setItem(__sigCacheKey(), JSON.stringify({
        userId: userId, sig: sig, displayName: displayName || '',
        expireAt: Date.now() + SIG_CACHE_TTL_MS,
        savedAt: Date.now(),
      }));
    } catch (e) {}
  }
  function clearSigCache() {
    try { localStorage.removeItem(__sigCacheKey()); } catch (e) {}
  }

  // v3.17.13: onReady を closure 外で参照できるよう module-level に保持
  var _onReadyCallback = function() {};

  // v3.17.13: doFullAuth を init 外に出して hoisting 問題を回避
  function doFullAuth(isBackground) {
    if (!window.liff || !APP.liffId) {
      if (!isBackground) showError($('sanro-status'), 'LIFFが利用できません。LINEメニューから開き直してください。');
      return;
    }
    if (!isBackground) showLoading($('sanro-status'), '読込中…');

    liff.init({ liffId: APP.liffId, withLoginOnExternalBrowser: false }).then(function() {
      return liff.getProfile();
    }).then(function(profile) {
      if (!profile) return;
      var accessToken = null;
      try { accessToken = liff.getAccessToken(); } catch (e) {}
      return fetchJson(APP.deployUrl + '?page=meal_input_sign', {
        method: 'POST',
        body: JSON.stringify({ userId: profile.userId, accessToken: accessToken, displayName: profile.displayName || '' }),
      }).then(function(data) {
        if (!data || !data.ok) {
          if (!isBackground) showError($('sanro-status'), '認証失敗: ' + (data && data.error ? data.error : 'unknown'));
          return;
        }
        APP.userId = data.userId;
        APP.sig = data.sig;
        APP.displayName = data.displayName || '';
        saveSigCache(APP.userId, APP.sig, APP.displayName);
        if (isBackground) return;  // バックグラウンドは UI 更新しない
        var nameEl = document.querySelector('.sanro-username');
        if (nameEl && APP.displayName) nameEl.textContent = APP.displayName + 'さん';
        var status = $('sanro-status');
        if (status) status.innerHTML = '';
        try { _onReadyCallback(APP); } catch (e) { showError($('sanro-status'), '初期化エラー: ' + e.message); }
      });
    }).catch(function(err) {
      if (isBackground) return;  // バックグラウンド失敗は無視
      var msg = err && err.message ? String(err.message) : (typeof err === 'string' ? err : '');
      msg = msg.replace(/https?:\/\/[^\s"<>]+/g, '').replace(/<[^>]+>/g, '').substring(0, 80);
      if (!msg) msg = '通信エラー';
      clearSigCache();
      showError($('sanro-status'), '認証エラー: ' + msg + '（リッチメニューから開き直してください）');
    });
  }

  function init(config) {
    APP.liffId = config.liffId || '';
    APP.deployUrl = config.deployUrl || '';
    _onReadyCallback = config.onReady || function(){};

    // v3.17.9: 戻るボタンを最初に挿入 (認証失敗時でも戻れるように)
    injectBackButton();

    // v3.17.10: sig キャッシュがあれば即 onReady (LIFF + GAS 認証スキップ)
    var cached = loadSigCache();
    if (cached) {
      APP.userId = cached.userId;
      APP.sig = cached.sig;
      APP.displayName = cached.displayName || '';
      var nameEl0 = document.querySelector('.sanro-username');
      if (nameEl0 && APP.displayName) nameEl0.textContent = APP.displayName + 'さん';
      var status0 = $('sanro-status');
      if (status0) status0.innerHTML = '';
      try { _onReadyCallback(APP); } catch (e) {}
      var remaining = cached.expireAt - Date.now();
      if (remaining < 4 * 60 * 60 * 1000) {
        setTimeout(function() { doFullAuth(true); }, 100);
      }
      return;
    }

    // キャッシュなし → 通常フル認証
    doFullAuth(false);
  }

  function close() {
    if (window.liff) {
      try { liff.closeWindow(); return; } catch (e) {}
    }
    try { window.close(); } catch (e) {}
  }

  function apiGet(page, params) {
    var qs = 'userId=' + encodeURIComponent(APP.userId) + '&sig=' + encodeURIComponent(APP.sig);
    if (params) {
      Object.keys(params).forEach(function(k) {
        qs += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
      });
    }
    return fetchJson(APP.deployUrl + '?page=' + encodeURIComponent(page) + '&' + qs);
  }
  function apiPost(page, body) {
    var bd = Object.assign({ userId: APP.userId, sig: APP.sig }, body || {});
    return fetchJson(APP.deployUrl + '?page=' + encodeURIComponent(page), {
      method: 'POST',
      body: JSON.stringify(bd),
    });
  }

  return { init: init, $: $, esc: esc, toast: toast, close: close, apiGet: apiGet, apiPost: apiPost, getApp: function(){ return APP; } };
})();
