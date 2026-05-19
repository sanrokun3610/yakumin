// ==================================================================
// サンロくんのほけんしつ 共通 LIFF 認証 + UI (v3.14.6 / Phase 7)
// 各 Web App ページから読み込んで使う。
// 使用方法: window.__SANRO__ = { liffId, deployUrl, onReady } を定義 → SanroBoot.init() 呼び出し
// ==================================================================
window.SanroBoot = (function() {
  var APP = { userId: '', sig: '', displayName: '', deployUrl: '', liffId: '' };

  function $(id) { return document.getElementById(id); }
  function esc(s) { var d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }

  function showLoading(container, msg) {
    if (!container) return;
    container.innerHTML = '<div class="sanro-loading">🔐 ' + esc(msg || '認証中…') + '</div>';
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

  function init(config) {
    APP.liffId = config.liffId || '';
    APP.deployUrl = config.deployUrl || '';
    var onReady = config.onReady || function(){};

    if (!window.liff || !APP.liffId) {
      showError($('sanro-status'), 'LIFFが利用できません。LINEメニューから開き直してください。');
      return;
    }
    showLoading($('sanro-status'), '認証中…');

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
          showError($('sanro-status'), '認証失敗: ' + (data && data.error ? data.error : 'unknown'));
          return;
        }
        APP.userId = data.userId;
        APP.sig = data.sig;
        APP.displayName = data.displayName || '';
        var nameEl = document.querySelector('.sanro-username');
        if (nameEl && APP.displayName) nameEl.textContent = APP.displayName + 'さん';
        var status = $('sanro-status');
        if (status) status.innerHTML = '';
        try { onReady(APP); } catch (e) { showError($('sanro-status'), '初期化エラー: ' + e.message); }
      });
    }).catch(function(err) {
      var msg = err && err.message ? String(err.message) : (typeof err === 'string' ? err : '');
      // URLやHTMLっぽい文字列は除去して短く
      msg = msg.replace(/https?:\/\/[^\s"<>]+/g, '').replace(/<[^>]+>/g, '').substring(0, 80);
      if (!msg) msg = '通信エラー';
      showError($('sanro-status'), '認証エラー: ' + msg + '（リッチメニューから開き直してください）');
    });
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
