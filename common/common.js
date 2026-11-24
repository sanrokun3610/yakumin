// ==================================================================
// サンロくんのほけんしつ 共通 LIFF 認証 + UI (v3.17.15 / Phase 7)
// v3.17.14: apiGet/apiPost で sig 期限切れ自動検知 → キャッシュクリア + 自動リロード
// v3.17.15: sig キャッシュ機構を一旦無効化 (くまさんFB「検索にでません」対応)
//   毎回フル認証で確実に動く状態へ戻す
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
    /* ローディング表示を全ページ共通の .g-loading(スピナー＋茶文字「読み込み中…」)に統一 */
    container.innerHTML = '<div class="g-loading"></div>';
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
    opts = Object.assign({}, opts || {});
    var write = opts.method === 'POST';
    if (write) {
      opts.headers = Object.assign({ 'Content-Type': 'text/plain;charset=UTF-8' }, opts.headers || {});
      opts.redirect = 'follow';
    }
    return new Promise(function(resolve, reject) {
      var controller = typeof AbortController === 'function' ? new AbortController() : null;
      if (controller) opts.signal = controller.signal;
      var finished = false;
      function done(error, value) {
        if (finished) return;
        finished = true; clearTimeout(timer);
        if (error) reject(error); else resolve(value);
      }
      function failure(code) {
        var error = new Error(write ? '処理の結果を確認できません。再送する前に記録を確認してください。' : '読み込めませんでした。もう一度お試しください。');
        error.code = write ? 'write_result_unknown' : code;
        return error;
      }
      var timer = setTimeout(function() {
        done(failure('read_timeout'));
        if (controller) controller.abort();
      }, write ? 45000 : 15000);
      Promise.resolve().then(function(){ return fetch(url, opts); }).then(function(r) {
        if (r.ok === false) throw failure('read_failed');
        return r.text();
      }).then(function(txt) {
        var data; try { data = JSON.parse(txt); } catch (ignored) { throw failure('read_failed'); }
        done(null, data);
      }).catch(function() { done(failure('read_failed')); });
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
    // v3.17.15: sig キャッシュ機構を一旦無効化
    return;
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
          if (!isBackground) {
            if (data && data.error === 'not_member') {
              // 会員ハードゲート: 非会員(会員番号未登録)は sig を取得できない。
              // 「会員登録してください」+ LINEトークへ戻る導線を表示する。
              var stEl = $('sanro-status');
              if (stEl) stEl.innerHTML =
                '<div style="margin:24px 12px;padding:22px 18px;border:1px solid #f0d39a;background:#fffdf4;border-radius:14px;text-align:center;line-height:1.8;">' +
                '<div style="font-size:34px;">💳</div>' +
                '<div style="font-weight:bold;font-size:16px;color:#b45309;margin:4px 0 8px;">会員登録が必要です</div>' +
                '<div style="font-size:13px;color:#555;">この機能を使うには会員番号の登録が必要です。<br>LINEのトーク画面に戻って、サンロくんの案内から<br><b>会員番号を登録</b>してね。</div>' +
                '<button onclick="try{liff.closeWindow()}catch(e){}" style="margin-top:16px;padding:11px 26px;border:none;border-radius:10px;background:#22c55e;color:#fff;font-weight:bold;font-size:15px;cursor:pointer;">LINEのトークに戻る</button>' +
                '</div>';
            } else {
              showError($('sanro-status'), data && data.error === 'authentication_failed' ? '本人確認ができませんでした。通信状況を確認し、LINEメニューから開き直してください。' : '認証失敗: ' + (data && data.error ? data.error : 'unknown'));
            }
          }
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

    // v3.17.15: sig キャッシュ機構を一旦無効化 (くまさんFB対応)
    // 古い sig が悪さしていた可能性 → 毎回フル認証で確実に動く状態へ
    try { localStorage.removeItem(__sigCacheKey()); } catch (e) {}
    doFullAuth(false);
  }

  function close() {
    if (window.liff) {
      try { liff.closeWindow(); return; } catch (e) {}
    }
    try { window.close(); } catch (e) {}
  }

  // v3.17.14: sig 期限切れ自動リカバリ
  var authRecoveryScheduled = false;
  function __checkAuthError(data) {
    if (!data || !data.error) return false;
    if (data.error === 'unauthorized' || data.error === 'signature_invalid' || data.error === 'no_user_id') {
      try { localStorage.removeItem(__sigCacheKey()); } catch (e) {}
      if (authRecoveryScheduled) return true;
      var current = new URL(location.href);
      if (current.searchParams.get('_auth_retry') === '1') { toast('認証を確認できません。LINEから画面を開き直してください。', 'error'); return true; }
      authRecoveryScheduled = true;
      toast('セッション期限切れ。再読み込みします...', 'info');
      setTimeout(function() {
        var source = new URL(location.href), next = new URL(source.pathname, source.origin);
        ['open', 'mode', 'liff.state', 'liff.referrer', 'v'].forEach(function(key) {
          if (source.searchParams.has(key)) next.searchParams.set(key, source.searchParams.get(key));
        });
        next.searchParams.set('_auth_retry', '1');
        next.searchParams.set('_t', String(Date.now()));
        location.replace(next.pathname + next.search + next.hash);
      }, 800);
      return true;
    }
    return false;
  }

  var pendingReads = Object.create(null), readEpoch = 0;
  function apiGet(page, params) {
    var qs = 'userId=' + encodeURIComponent(APP.userId) + '&sig=' + encodeURIComponent(APP.sig);
    if (params) {
      Object.keys(params).sort().forEach(function(k) {
        qs += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
      });
    }
    var url = APP.deployUrl + '?page=' + encodeURIComponent(page) + '&' + qs;
    // Only in-flight reads are shared, scoped to current identity/signature/parameters.
    // No browser storage or automatic write retries.
    var key = readEpoch + ':' + url;
    if (pendingReads[key]) return pendingReads[key];
    var request = fetchJson(url).then(function(d) { __checkAuthError(d); return d; });
    pendingReads[key] = request;
    function clear() { if (pendingReads[key] === request) delete pendingReads[key]; }
    request.then(clear, clear);
    return request;
  }
  var pendingWrites = 0;
  function showWriteProgress(page) {
    pendingWrites++;
    var box = document.getElementById('sanro-write-progress');
    if (!box) { box = document.createElement('div'); box.id = 'sanro-write-progress'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); box.style.cssText = 'position:fixed;top:38%;left:10%;width:80%;box-sizing:border-box;padding:26px;background:#fff8df;border:2px solid #b45309;border-radius:12px;color:#422006;font-size:23px;font-weight:bold;text-align:center;z-index:9999;box-shadow:0 8px 28px #0003'; document.body.appendChild(box); }
    box.textContent = page.indexOf('delete') >= 0 ? '削除中…' : '保存中…';
  }
  function hideWriteProgress() {
    pendingWrites = Math.max(0, pendingWrites - 1);
    var box = document.getElementById('sanro-write-progress'); if (!pendingWrites && box) box.remove();
  }
  function apiPost(page, body) {
    readEpoch++; // Reads after a mutation must not join pre-mutation requests.
    showWriteProgress(page);
    var bd = Object.assign({ userId: APP.userId, sig: APP.sig }, body || {});
    return fetchJson(APP.deployUrl + '?page=' + encodeURIComponent(page), {
      method: 'POST',
      body: JSON.stringify(bd),
    }).then(function(d) { __checkAuthError(d); return d; }).finally(function(){readEpoch++;hideWriteProgress();});
  }

  return { init: init, $: $, esc: esc, toast: toast, close: close, apiGet: apiGet, apiPost: apiPost, getApp: function(){ return APP; } };
})();
