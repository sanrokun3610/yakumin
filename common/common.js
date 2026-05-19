// ==================================================================
// サンロくんのほけんしつ 共通 LIFF 認証 + UI (v3.14.0 / Phase 7)
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
        catch (e) { throw new Error('parse_fail: ' + txt.substring(0, 100)); }
      });
    });
  }

  function debugStep(msg) {
    var st = $('sanro-status');
    if (!st) return;
    var line = document.createElement('div');
    line.style.cssText = 'padding:6px 12px;margin:4px 0;background:#fffbeb;border-left:3px solid #f59e0b;font-size:11px;color:#78350f;text-align:left;word-break:break-all;font-family:monospace';
    line.textContent = msg;
    st.appendChild(line);
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
    debugStep('1. URL: ' + window.location.href.substring(0, 80));
    debugStep('2. liff exists: ' + !!window.liff + ', liffId: ' + APP.liffId);

    // タイムアウト: 12秒で「タイムアウト」表示
    var timeoutTimer = setTimeout(function() {
      debugStep('⚠ タイムアウト (12秒経過): LIFF が応答していません');
    }, 12000);

    liff.init({ liffId: APP.liffId }).then(function() {
      debugStep('3. liff.init OK');
      debugStep('4. isInClient: ' + liff.isInClient() + ', isLoggedIn: ' + liff.isLoggedIn());
      if (!liff.isInClient() && !liff.isLoggedIn()) {
        debugStep('5a. LINE外なので login() 呼ぶ');
        liff.login();
        return null;
      }
      debugStep('5b. getProfile() 開始');
      return liff.getProfile();
    }).then(function(profile) {
      if (!profile) {
        debugStep('6. profile = null (login redirect 中の可能性)');
        return;
      }
      debugStep('6. getProfile OK: userId=' + (profile.userId || '').substring(0, 10) + '...');
      var accessToken = null;
      try { accessToken = liff.getAccessToken(); } catch (e) { debugStep('7. getAccessToken エラー: ' + e); }
      debugStep('7. accessToken: ' + (accessToken ? 'あり(' + accessToken.length + ')' : 'なし'));
      debugStep('8. sign API へ POST');
      return fetchJson(APP.deployUrl + '?page=meal_input_sign', {
        method: 'POST',
        body: JSON.stringify({ userId: profile.userId, accessToken: accessToken, displayName: profile.displayName || '' }),
      }).then(function(data) {
        debugStep('9. sign 応答: ' + JSON.stringify(data).substring(0, 100));
        if (!data || !data.ok) {
          showError($('sanro-status'), '認証失敗: ' + (data && data.error ? data.error : 'unknown'));
          return;
        }
        clearTimeout(timeoutTimer);
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
      clearTimeout(timeoutTimer);
      var msg = err && err.message ? err.message : (typeof err === 'string' ? err : JSON.stringify(err));
      debugStep('⚠ catch: ' + msg);
      showError($('sanro-status'), 'LIFF初期化失敗: ' + msg);
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
