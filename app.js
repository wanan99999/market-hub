(function () {
  'use strict';
  var BASE = 'https://wanan99999.github.io/';
  var SITES = {
    signal: BASE + 'signal-monitor/',
    review: BASE + 'market-review/index.html',
    news: BASE + 'finance-news-daily/index.html',
    alert: BASE + 'astock-daily-alert/',
    quant: BASE + 'quant-strategies/index.html'
  };
  var STALE_MS = 10 * 60 * 1000;      // 切回标签时，超过 10 分钟未刷新就重新加载网页
  var frames = {};                    // tab -> {el, loadedAt, ver}
  var latest = {};                    // tab -> 最新版本标识（日期/更新时间）
  var current = 'home';

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

  /* ---------- 五个数据源 ---------- */
  // 策略信号：和 signal-monitor 同一个域名，直接读它存在浏览器里的「看哪些策略 / 从哪天开始跟」
  function loadSignal() {
    var root = BASE + 'signal-monitor/data/';
    return getJSON(root + 'signals.json').then(function (j) {
      var picked = null, starts = {};
      try { picked = JSON.parse(localStorage.getItem('sig-picked')); } catch (e) {}
      try { starts = JSON.parse(localStorage.getItem('sig-start')) || {}; } catch (e) {}
      var seen = []; try { seen = JSON.parse(localStorage.getItem('sig-seen')) || []; } catch (e) {}
      var list = j.strategies.filter(function (s) { return !Array.isArray(picked) || picked.indexOf(s.id) >= 0 || (s.id.indexOf('u-') === 0 && seen.indexOf(s.id) < 0); });
      var act = 0, rows = list.map(function (s) {
        var sd = s.starts[starts[s.id]] ? starts[s.id] : s.default_start, x = s.starts[sd] || [];
        var nb = x[1] || 0, ns = x[2] || 0;
        if (nb + ns) act++;
        return '<div class="sg" data-sid="' + esc(s.id) + '"><span class="n">' + esc(s.title) + '<small>' + esc(md(sd)) + '起跟 · 持有 ' + (x[3] || 0) +
          ' 只 · ' + (x[4] ? '今天调仓日' : '下次调仓 ' + esc(md(x[5]))) + '</small></span>' +
          '<span class="bs' + (nb ? ' b-on' : '') + '">买入 ' + nb + '</span><span class="bs' + (ns ? ' s-on' : '') + '">卖出 ' + ns + '</span></div>';
      }).join('');
      var mode = j.mode === 'intraday' ? '盘中提示' : '收盘复核';
      var h = '<p class="title">' + (list.length ? (act ? act + ' 个策略今天要操作' : '今天都不用操作') : '还没选择策略') + '</p>' + rows;
      $('signal-dot').classList.toggle('show', act > 0 && j.date === new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10));
      setCard('signal', md(j.date) + ' ' + mode + ' · ' + j.quote_time, h, j.updated);
    }).catch(function () { failCard('signal'); });
  }

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

  // 策略库：读它发布的 strategies.json（不再解析网页 HTML）+ 信号监控发布的「我的组合」清单
  function loadQuant() {
    return Promise.all([
      getJSON(BASE + 'quant-strategies/strategies.json'),
      getJSON(BASE + 'signal-monitor/data/combos/list.json').catch(function () { return []; })
    ]).then(function (r) {
      var all = r[0].strategies || [], mine = Array.isArray(r[1]) ? r[1] : [];
      var groups = (r[0].cats || []).map(function (c) {
        return c.name + ' ' + all.filter(function (s) { return s.cat === c.id; }).length;
      }).concat(['我的组合策略 ' + mine.length]);
      var names = all.map(function (s) { return s.title; });
      var h = '<p class="title">共 ' + all.length + ' 个策略' + (mine.length ? ' + ' + mine.length + ' 个自建组合' : '') + '</p>' +
        '<p class="muted" style="margin:0">' + groups.map(esc).join(' · ') + '</p>' +
        '<div class="chips">' + names.slice(0, 6).map(function (n) { return '<span>' + esc(n) + '</span>'; }).join('') +
        (names.length > 6 ? '<span>…</span>' : '') + '</div>';
      setCard('quant', '', h, all.map(function (s) { return s.slug + s.ret; }).join('|') + '|' + mine.map(function (c) { return c.id + c.updated_at; }).join('|'));
    }).catch(function () { failCard('quant'); });
  }

  function refreshAll() {
    var btn = $('refresh');
    btn.classList.add('spin');
    return Promise.all([loadSignal(), loadAlert(), loadReview(), loadNews(), loadQuant()]).then(function () {
      btn.classList.remove('spin');
      var n = new Date();
      $('checked').textContent = '已同步五个网站 · ' + n.getHours() + ':' + String(n.getMinutes()).padStart(2, '0');
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
    f.onload = function () {
      var l = v.querySelector('.loading'); if (l) l.remove();
      frames[tab].color = siteColor(f);
      if (current === tab) paintBar(tab);
    };
    v.appendChild(f);
    frames[tab] = { el: f, loadedAt: Date.now(), ver: latest[tab] };
  }
  // 读网站顶部的背景色（同域名 github.io，可以直接读），状态栏用同色，看起来像网站自己的顶栏
  function siteColor(f) {
    try {
      var doc = f.contentDocument, win = f.contentWindow;
      var el = doc.elementFromPoint(Math.min(40, win.innerWidth / 2), 2);
      while (el) {
        var cs = win.getComputedStyle(el), c = cs.backgroundColor;
        if (c && c !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(c)) return c;
        var g = /gradient/.test(cs.backgroundImage) && /(rgba?\([^)]+\)|#[0-9a-f]{3,8})/i.exec(cs.backgroundImage);
        if (g) return g[1];   // 渐变顶栏取第一个颜色
        el = el.parentElement;
      }
      return win.getComputedStyle(doc.body).backgroundColor || null;
    } catch (e) { return null; }
  }
  function paintBar(tab) {
    var c = (frames[tab] && frames[tab].color) || '';
    $('sbar').style.background = c;
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', tab === 'home' || !c ? '#0f2348' : c);
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
    var sub = '';
    if (/^signal\//.test(tab)) { sub = tab.slice(7); tab = 'signal'; }     // signal/策略id：直接打开该策略
    if (!/^(home|signal|review|news|alert|quant)$/.test(tab)) tab = 'home';
    document.querySelectorAll('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'v-' + tab); });
    document.querySelectorAll('#tabbar button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === tab); });
    current = tab;
    $('app').classList.toggle('on-site', tab !== 'home');
    paintBar(tab);
    if (tab === 'home') return;
    if (latest[tab]) store('seen-' + tab, latest[tab]);
    var w = $('c-' + tab).querySelector('.when');
    if (w) w.classList.remove('new');
    if (!frames[tab]) { ensureFrame(tab); if (sub) frames[tab].el.src = SITES[tab] + '#/' + sub; }
    else {
      if (Date.now() - frames[tab].loadedAt > STALE_MS) reloadFrame(tab);
      if (sub) { try { frames[tab].el.contentWindow.location.hash = '#/' + sub; } catch (e) { frames[tab].el.src = SITES[tab] + '#/' + sub; } }
    }
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
    var r = e.target.closest('.sg');
    if (r) { go('signal/' + r.dataset.sid); return; }
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
