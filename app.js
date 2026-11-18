(function () {
  'use strict';
  var BASE = 'https://wanan99999.github.io/';
  var SITES = {
    review: BASE + 'market-review/index.html',
    news: BASE + 'finance-news-daily/index.html',
    alert: BASE + 'astock-daily-alert/',
    quant: BASE + 'quant-strategies/index.html'
  };
  var STALE_MS = 10 * 60 * 1000;      // 切回标签时，超过 10 分钟未刷新就重新加载网页
  var frames = {};                    // tab -> {el, loadedAt, ver}
  var latest = {};                    // tab -> 最新版本标识（日期/更新时间）

  function $(id) { return document.getElementById(id); }
  function store(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; }
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function getJSON(url) {
    // 加时间戳绕过 GitHub Pages 的 10 分钟缓存，保证拿到网站最新内容
    return fetch(url + (url.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
  }
  function getText(url) {
    return fetch(url + '?t=' + Date.now(), { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(r.status); return r.text();
    });
  }
  function pct(v) {
    if (v == null || isNaN(v)) return '';
    var cls = v > 0 ? 'up' : v < 0 ? 'down' : '';
    return '<em class="' + cls + '">' + (v > 0 ? '+' : '') + Number(v).toFixed(2) + '%</em>';
  }
  function md(d) { // 2026-11-17 -> 11月17日
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || '');
    return m ? (+m[2]) + '月' + (+m[3]) + '日' : (d || '');
  }
  function setCard(tab, when, html, ver) {
    var c = $('c-' + tab);
    var w = c.querySelector('.when');
    w.textContent = when || '';
    var seen = store('seen-' + tab);
    w.classList.toggle('new', !!ver && seen !== null && seen !== ver);
    if (seen === null && ver) store('seen-' + tab, ver);
    var b = c.querySelector('.card-b');
    b.className = 'card-b';
    b.innerHTML = html;
    if (ver) {
      latest[tab] = ver;
      // 打开着的网页落后于最新数据 -> 自动刷新
      var f = frames[tab];
      if (f && f.ver && f.ver !== ver) reloadFrame(tab);
      else if (f && !f.ver) f.ver = ver;
    }
  }
  function failCard(tab) {
    setCard(tab, '', '<p class="err">暂时没连上网站，点刷新按钮重试；也可以直接点这里打开网页。</p>');
  }

  /* ---------- 四个数据源 ---------- */
  function loadAlert() {
    var root = BASE + 'astock-daily-alert/data/';
    return Promise.all([
      getJSON(root + 'signals.json'),
      getJSON(root + 'chinext/signals.json').catch(function () { return null; }),
      getJSON(root + 'star/signals.json').catch(function () { return null; })
    ]).then(function (r) {
      var m = r[0], L = m.latest || {};
      var bt = L.bottoming === 'robust' ? ['p-on', '触发'] : L.bottoming === 'watching' ? ['p-watch', '观察窗口'] : ['p-off', '无信号'];
      var anyOn = !!L.crash || L.bottoming === 'robust';
      var h = '<div class="row3" style="grid-template-columns:1fr"><div class="idx"><b>上证指数 ' + esc(md(L.date)) + '</b><span>' +
        esc(L.idx_close) + '</span>' + pct(L.idx_ret) + '</div></div>';
      h += '<div class="sig"><span class="n">主站 · 大跌预警</span><span class="pill ' + (L.crash ? 'p-on">触发' : 'p-off">未触发') + '</span></div>';
      h += '<div class="sig"><span class="n">主站 · 筑底提醒</span><span class="pill ' + bt[0] + '">' + bt[1] + '</span></div>';
      [[r[1], '创业板'], [r[2], '科创板']].forEach(function (p) {
        if (!p[0] || !p[0].latest) return;
        var b = p[0].latest;
        if (b.crash || b.bottoming) anyOn = true;
        h += '<div class="sig"><span class="n">' + p[1] + ' · 大跌 / 筑底</span>' +
          '<span class="pill ' + (b.crash ? 'p-on">大跌触发' : 'p-off">大跌无') + '</span>' +
          '<span class="pill ' + (b.bottoming ? 'p-on">筑底触发' : 'p-off">筑底无') + '</span></div>';
      });
      $('alert-dot').classList.toggle('show', anyOn);
      setCard('alert', '更新于 ' + (m.updated || ''), h, m.updated);
    }).catch(function () { failCard('alert'); });
  }

  function loadReview() {
    var root = BASE + 'market-review/';
    return getJSON(root + 'days.json').then(function (days) {
      var last = days[days.length - 1];
      return getJSON(root + 'data/' + last.date + '.json').then(function (d) {
        var h = '<p class="title">' + esc(d.title || last.title) + '</p>';
        if (d.headline) h += '<p class="muted" style="margin:0">' + esc(d.headline) + '</p>';
        h += '<div class="row3">' + (d.indices || []).slice(0, 3).map(function (x) {
          return '<div class="idx"><b>' + esc(x.name) + '</b><span>' + esc(x.close) + '</span><br>' + pct(x.chg) + '</div>';
        }).join('') + '</div>';
        var bits = [];
        if (d.breadth && d.breadth.up != null) bits.push('上涨 <span class="up">' + Math.round(d.breadth.up) + '</span> / 下跌 <span class="down">' + Math.round(d.breadth.down) + '</span>');
        if (d.turnover) bits.push('成交额 ' + (d.turnover / 10000).toFixed(2) + ' 万亿' + (d.volume ? '（' + esc(d.volume) + '）' : ''));
        if (bits.length) h += '<p class="muted" style="margin:4px 0 0">' + bits.join(' · ') + '</p>';
        if (d.top && d.top.length) h += '<div class="chips">' + d.top.slice(0, 3).map(function (x) {
          return '<span>' + esc(x.name) + ' ' + pct(x.chg) + '</span>';
        }).join('') + '</div>';
        setCard('review', md(last.date), h, last.date);
      });
    }).catch(function () { failCard('review'); });
  }

  function loadNews() {
    var root = BASE + 'finance-news-daily/';
    return getJSON(root + 'days.json').then(function (days) {
      var last = days[days.length - 1];
      return getJSON(root + 'data/' + last.date + '.json').then(function (d) {
        var pts = (d.conclusions || []).slice(0, 4).map(function (c) {
          var t = Array.isArray(c) ? c[0] : (c.title || c);
          return '<li>' + esc(String(t).replace(/[：:]\s*$/, '')) + '</li>';
        }).join('');
        var h = '<p class="title">' + esc(d.title) + '</p><ul class="pts">' + pts + '</ul>';
        setCard('news', md(last.date), h, last.date);
      });
    }).catch(function () { failCard('news'); });
  }

  function loadQuant() {
    return getText(SITES.quant).then(function (html) {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var names = Array.prototype.map.call(doc.querySelectorAll('a.card h3, a[href^="s/"] h3'), function (e) {
        return e.textContent.trim();
      });
      var groups = Array.prototype.map.call(doc.querySelectorAll('h2'), function (e) {
        return e.textContent.trim();
      }).filter(Boolean);
      var h = '<p class="title">共 ' + names.length + ' 个策略</p>';
      if (groups.length) h += '<p class="muted" style="margin:0">' + groups.map(esc).join(' · ') + '</p>';
      h += '<div class="chips">' + names.slice(0, 6).map(function (n) { return '<span>' + esc(n) + '</span>'; }).join('') +
        (names.length > 6 ? '<span>…</span>' : '') + '</div>';
      setCard('quant', '', h, names.join('|'));
    }).catch(function () { failCard('quant'); });
  }

  function refreshAll() {
    var btn = $('refresh');
    btn.classList.add('spin');
    return Promise.all([loadAlert(), loadReview(), loadNews(), loadQuant()]).then(function () {
      btn.classList.remove('spin');
      var n = new Date();
      $('checked').textContent = '已同步四个网站 · ' + n.getHours() + ':' + String(n.getMinutes()).padStart(2, '0');
      store('lastCheck', String(Date.now()));
    });
  }

  /* ---------- 标签与网页 ---------- */
  function ensureFrame(tab) {
    if (frames[tab]) return;
    var v = $('v-' + tab);
    v.innerHTML = '<div class="loading">正在打开…</div>';
    var f = document.createElement('iframe');
    f.src = SITES[tab];
    f.title = tab;
    f.onload = function () { var l = v.querySelector('.loading'); if (l) l.remove(); };
    v.appendChild(f);
    frames[tab] = { el: f, loadedAt: Date.now(), ver: latest[tab] };
  }
  function reloadFrame(tab) {
    var f = frames[tab];
    if (!f) return;
    // 加时间戳强制拿网站最新版本
    f.el.src = SITES[tab] + (SITES[tab].indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now();
    f.loadedAt = Date.now();
    f.ver = latest[tab];
  }
  function show(tab) {
    if (!/^(home|review|news|alert|quant)$/.test(tab)) tab = 'home';
    document.querySelectorAll('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'v-' + tab); });
    document.querySelectorAll('#tabbar button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === tab); });
    if (tab === 'home') return;
    if (latest[tab]) store('seen-' + tab, latest[tab]);
    var w = $('c-' + tab).querySelector('.when');
    if (w) w.classList.remove('new');
    if (!frames[tab]) ensureFrame(tab);
    else if (Date.now() - frames[tab].loadedAt > STALE_MS) reloadFrame(tab);
  }
  function go(tab) {
    if (location.hash.slice(1) === tab) show(tab);
    else location.hash = tab === 'home' ? '' : tab;
  }

  $('tabbar').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    var tab = b.dataset.tab;
    if (b.classList.contains('on') && tab !== 'home') { reloadFrame(tab); return; } // 再点一次当前标签 = 刷新网页
    go(tab);
  });
  $('cards').addEventListener('click', function (e) {
    var c = e.target.closest('.card');
    if (c) go(c.dataset.go);
  });
  window.addEventListener('hashchange', function () { show(location.hash.slice(1) || 'home'); });
  $('refresh').addEventListener('click', function () { refreshAll(); });
  $('install-tip').addEventListener('click', function (e) { e.preventDefault(); $('sheet').hidden = false; });
  $('sheet-close').addEventListener('click', function () { $('sheet').hidden = true; });

  // 从后台切回来时，超过 10 分钟就重新同步
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - (+store('lastCheck') || 0) > STALE_MS) refreshAll();
  });

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  show(location.hash.slice(1) || 'home');
  refreshAll();
})();
