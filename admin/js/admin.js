const API = '';
const state = {
  token: localStorage.getItem('sg_admin_token') || '',
  tab: 'dashboard',
  knownPaidIds: new Set(JSON.parse(localStorage.getItem('sg_known_paid') || '[]')),
  receiptPrintedIds: new Set(),
  bootstrapped: false,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(`${API}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

const STATUS_TEXT = {
  pending_pay: '待支付',
  paid: '已支付',
  making: '制作中',
  ready: '待取餐',
  done: '已完成',
  cancelled: '已取消',
  refunded: '已退款',
};

function showMain(show) {
  $('#loginView').classList.toggle('hidden', show);
  $('#mainView').classList.toggle('hidden', !show);
}

function switchTab(tab) {
  state.tab = tab;
  $$('.side-nav .nav, .bottom-nav .nav').forEach((b) => {
    if (!b.dataset.tab) return;
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  $$('.tab').forEach((el) => el.classList.add('hidden'));
  const pane = $(`#tab-${tab}`);
  if (pane) pane.classList.remove('hidden');
  const titles = {
    dashboard: '今日概览',
    orders: '订单 / 打印',
    products: '商品规格',
    toppings: '小料',
    sidemeal: '小食设置',
    delivery: '配送费',
    reserve: '预定分类',
    users: '会员维护',
    coupons: '发券',
    lottery: '开业抽奖',
    wallet: '储值档位',
    reports: '销售报表',
    purchases: '进货台账',
    verify: '查取餐码',
    hardware: '打印 / 标签',
  };
  $('#pageTitle').textContent = titles[tab] || '';
  window.scrollTo(0, 0);
  refresh();
}

function extraFruitNames(list) {
  return (list || [])
    .filter((e) => e && e.kind !== 'topping' && e.kind !== 'sideMeal')
    .map((e) => (typeof e === 'string' ? e : e.name))
    .map((n) => String(n || '').trim())
    .filter(Boolean);
}

function uniqueNames(list) {
  const names = [];
  const seen = new Set();
  (list || []).forEach((n) => {
    const name = String(n || '').trim();
    if (!name || seen.has(name)) return;
    seen.add(name);
    names.push(name);
  });
  return names;
}

function collectAddons(o) {
  return uniqueNames([
    ...(o?.toppings || []).map((t) => t && t.name),
    ...(o?.items || []).flatMap((it) => (it.toppings || []).map((t) => t && t.name)),
    ...(o?.extras || []).filter((e) => e && e.kind !== 'sideMeal').map((e) => e.name),
  ]);
}

function kitchenPicks(o, it) {
  const fruits = uniqueNames([
    ...extraFruitNames(it ? it.extras : o?.extras),
    ...(it ? [] : (o?.items || []).flatMap((row) => extraFruitNames(row.extras))),
  ]);
  const tops = uniqueNames([
    ...(it ? it.toppings || [] : o?.toppings || []).map((t) => t && t.name),
    ...(!it ? (o?.items || []).flatMap((row) => (row.toppings || []).map((t) => t && t.name)) : []),
    ...(it ? it.extras || [] : o?.extras || [])
      .filter((e) => e && e.kind === 'topping')
      .map((e) => e.name),
  ]);
  return { fruits, tops };
}

function orderGoodsHtml(o) {
  const items = Array.isArray(o.items) && o.items.length ? o.items : null;
  const block = (title, picks) => {
    const fruitTip = picks.fruits.length
      ? `<div class="order-picks">${picks.fruits.join('、')}</div>`
      : '';
    const tip = picks.tops.length ? `<div class="order-toppings">小料 ${picks.tops.join('、')}</div>` : '';
    return `<div class="order-title">${title}</div>${fruitTip}${tip}`;
  };
  if (items) {
    return items
      .map((it) => block(`${it.productName} · ${it.specName} ×${it.quantity}`, kitchenPicks(o, it)))
      .join('');
  }
  return block(`${o.productName} · ${o.specName} ×${o.quantity}`, kitchenPicks(o));
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 4000);
}

function unlockAudio() {
  try {
    if (!window.speechSynthesis) return;
    speechSynthesis.getVoices();
  } catch {
    /* ignore */
  }
}

function chineseVoice() {
  const voices = window.speechSynthesis ? speechSynthesis.getVoices() || [] : [];
  return (
    voices.find((v) => /^zh(-|$)/i.test(v.lang) && /CN|China|Chinese| Huihui| Xiaoxiao| Yaoyao/i.test(`${v.lang} ${v.name}`)) ||
    voices.find((v) => /^zh(-|$)/i.test(v.lang)) ||
    null
  );
}

function orderSpeakText(o) {
  const items = Array.isArray(o.items) && o.items.length ? o.items : null;
  const fromItems = items
    ? items.map((it) => String(it.productName || '').trim()).filter(Boolean).join('，')
    : '';
  return fromItems || String(o.productName || '').trim() || '新订单';
}

function speakText(text) {
  return new Promise((resolve) => {
    if (!window.speechSynthesis) {
      resolve();
      return;
    }
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'zh-CN';
    utter.rate = 0.92;
    utter.pitch = 1;
    utter.volume = 1;
    const voice = chineseVoice();
    if (voice) utter.voice = voice;
    utter.onend = () => resolve();
    utter.onerror = () => resolve();
    speechSynthesis.speak(utter);
  });
}

async function announceOrders(orders) {
  if (!$('#soundOn')?.checked || !orders.length) return;
  unlockAudio();
  if (window.speechSynthesis) speechSynthesis.cancel();
  for (const o of orders) {
    await speakText(orderSpeakText(o));
  }
}

function persistKnown() {
  localStorage.setItem('sg_known_paid', JSON.stringify([...state.knownPaidIds].slice(0, 200)));
}

async function watchNewOrders(list) {
  const paid = list.filter((o) => o.pickupCode && ['paid', 'making', 'ready'].includes(o.status));
  if (!state.bootstrapped) {
    paid.forEach((o) => state.knownPaidIds.add(o.id));
    persistKnown();
    state.bootstrapped = true;
    return;
  }
  const fresh = paid.filter((o) => !state.knownPaidIds.has(o.id));
  if (!fresh.length) return;

  fresh.forEach((o) => state.knownPaidIds.add(o.id));
  persistKnown();
  announceOrders(fresh);
  toast(`新订单 ${fresh.map((o) => o.pickupCode).join('、')} · ${fresh[0].productName}`);

  if ($('#autoPrint').checked) {
    for (const o of fresh) {
      await printReceipt(o.id, { skipPrinted: true });
      await new Promise((r) => setTimeout(r, 400));
    }
  }
}

async function login() {
  $('#loginError').textContent = '';
  try {
    const data = await api('/api/auth/admin/login', {
      method: 'POST',
      body: JSON.stringify({
        username: $('#username').value.trim(),
        password: $('#password').value,
      }),
    });
    state.token = data.token;
    localStorage.setItem('sg_admin_token', data.token);
    state.bootstrapped = false;
    showMain(true);
    switchTab('dashboard');
  } catch (e) {
    $('#loginError').textContent = e.message;
  }
}

function logout() {
  state.token = '';
  localStorage.removeItem('sg_admin_token');
  showMain(false);
}

function fulfillmentNote(o) {
  const time =
    o.fulfillmentType === 'reserve'
      ? `预约 ${o.pickupAtText || ''}`.trim()
      : '现作';
  const place =
    o.deliveryPoint && o.deliveryPoint !== 'shop'
      ? `投柜 ${o.deliveryPointName || o.deliveryPoint}`
      : '到店取';
  return `${time} · ${place}`;
}

function amountNote(o) {
  if (o.discountAmount > 0 && o.originalAmount) {
    return `¥${o.amount}<span class="muted"> 原价¥${o.originalAmount}</span>`;
  }
  return `¥${o.amount}`;
}

function sortDeskOrders(list) {
  return [...list].sort((a, b) => {
    const ar = a.fulfillmentType === 'reserve' && a.status === 'paid' ? 1 : 0;
    const br = b.fulfillmentType === 'reserve' && b.status === 'paid' ? 1 : 0;
    if (ar !== br) return ar - br;
    const at = a.pickupAt || a.paidAt || a.createdAt || 0;
    const bt = b.pickupAt || b.paidAt || b.createdAt || 0;
    return at - bt;
  });
}

async function loadStats() {
  const s = await api('/api/admin/stats');
  $('#stats').innerHTML = `
    <div class="stat"><div class="label">今日订单</div><div class="value">${s.todayOrders}</div></div>
    <div class="stat"><div class="label">今日营收</div><div class="value">¥${s.todayRevenue}</div></div>
    <div class="stat"><div class="label">待制作</div><div class="value">${s.pendingMake}</div></div>
    <div class="stat"><div class="label">在售商品</div><div class="value">${s.productCount}</div></div>
    <div class="stat"><div class="label">活跃用户</div><div class="value">${s.userActive ?? '-'}</div></div>
    <div class="stat"><div class="label">不活跃</div><div class="value">${s.userInactive ?? '-'}</div></div>
  `;
  await loadDashSideMealStock().catch(() => {});
  const { list } = await api('/api/admin/orders');
  await watchNewOrders(list);
  const pending = sortDeskOrders(list.filter((o) => ['paid', 'making'].includes(o.status)));
  const waiting = list
    .filter((o) => o.status === 'ready')
    .sort((a, b) => (b.readyAt || b.updatedAt || 0) - (a.readyAt || a.updatedAt || 0));
  const newest = pending[0]?.id;
  const kept = new Set($$('#pendingList .order-check:checked').map((el) => el.value));
  const workHtml = pending.length
    ? pending
        .map((o) => {
          const batchNote =
            o.makeBatchCodes && o.makeBatchCodes.length > 1
              ? `<div class="batch-codes">同批：${o.makeBatchCodes.join('、')}</div>`
              : '';
          const handoff =
            o.deliveryPoint && o.deliveryPoint !== 'shop' ? '已放入柜' : '请取餐';
          return `
      <div class="order-card ${o.id === newest ? 'new' : ''}">
        <label class="pick"><input type="checkbox" class="order-check" value="${o.id}" data-code="${o.pickupCode || ''}" ${kept.has(o.id) ? 'checked' : ''} /></label>
        <div class="pickup">${o.pickupCode || '--'}</div>
        <div class="order-main">
          ${orderGoodsHtml(o)}
          <div class="muted">${STATUS_TEXT[o.status]} · ${fulfillmentNote(o)} · ${amountNote(o)}${o.printed ? ' · 已打标' : ''}</div>
          ${batchNote}
        </div>
        <div class="actions">
          <button type="button" class="btn sm green" onclick="printReceipt('${o.id}')">打印小票</button>
          <button type="button" class="btn sm" onclick="setStatus('${o.id}','making')">制作中</button>
          <button type="button" class="btn sm primary" onclick="setStatus('${o.id}','ready')">${handoff}</button>
        </div>
      </div>`;
        })
        .join('')
    : '<p class="muted">暂无待制作订单</p>';
  const waitHtml = waiting.length
    ? `<h3 class="pickup-head">取餐中</h3><p class="muted">报码对上就递出，不用再点完成。两小时后自动记为已取餐。</p>${waiting
        .map(
          (o) => `
      <div class="order-card waiting">
        <div class="pickup">${o.pickupCode || '--'}</div>
        <div class="order-main">
          ${orderGoodsHtml(o)}
          <div class="muted">${o.deliveryPoint && o.deliveryPoint !== 'shop' ? '已放入柜' : '请取餐'} · ${fulfillmentNote(o)}</div>
        </div>
        <div class="actions">
          <button type="button" class="btn sm green" onclick="printReceipt('${o.id}')">打印小票</button>
        </div>
      </div>`
        )
        .join('')}`
    : '';
  $('#pendingList').innerHTML = workHtml + waitHtml;
  const boxes = $$('#pendingList .order-check');
  const allOn = boxes.length > 0 && boxes.every((el) => el.checked);
  if ($('#selectAllPending')) $('#selectAllPending').checked = allOn;
  updateBatchHint();
}

function selectedOrderIds() {
  return $$('.order-check:checked').map((el) => el.value);
}

function updateBatchHint() {
  const ids = selectedOrderIds();
  const hint = $('#batchHint');
  if (!hint) return;
  if (!ids.length) {
    hint.textContent = '可勾选多个单号，一人同时做多份';
    return;
  }
  const codes = $$('.order-check:checked')
    .map((el) => el.dataset.code)
    .filter(Boolean);
  hint.textContent = `已选 ${ids.length} 单：${codes.join('、')}`;
}

async function batchSetStatus(status) {
  const ids = selectedOrderIds();
  if (!ids.length) {
    toast('请先勾选订单');
    return;
  }
  const labels = { making: '开始制作', ready: '请取餐' };
  try {
    const data = await api('/api/orders/batch-status', {
      method: 'POST',
      body: JSON.stringify({ ids, status }),
    });
    toast(data.tip || `已${labels[status] || '更新'} ${data.count} 单`);
    const sel = $('#selectAllPending');
    if (sel) sel.checked = false;
    if (status === 'making') {
      for (const id of ids) await printReceipt(id, { skipPrinted: true });
    }
    refresh();
  } catch (e) {
    toast(e.message);
  }
}

async function loadOrders() {
  const status = $('#statusFilter').value;
  const q = status ? `?status=${status}` : '';
  const { list } = await api(`/api/admin/orders${q}`);
  await watchNewOrders(list);
  if (!list.length) {
    $('#orderTable').innerHTML = '<p class="muted" style="padding:16px">暂无订单</p>';
    return;
  }
  $('#orderTable').innerHTML = list
    .map((o) => {
      const t = new Date(o.paidAt || o.createdAt);
      const ts = `${t.getMonth() + 1}/${t.getDate()} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
      return `<div class="list-card">
        <div class="row-top">
          <div class="code">${o.pickupCode || '-'}</div>
          <span class="tag ${o.status}">${STATUS_TEXT[o.status] || o.status}</span>
        </div>
        ${orderGoodsHtml(o)}
        <div class="meta">${fulfillmentNote(o)} · ${amountNote(o)} · ${ts}${o.printed ? ' · 已打标' : ''}</div>
        <div class="actions">
          ${o.pickupCode ? `<button type="button" class="btn sm green" onclick="printReceipt('${o.id}')">打印小票</button>` : ''}
          ${['paid', 'making'].includes(o.status) ? `<button type="button" class="btn sm primary" onclick="setStatus('${o.id}','ready')">${
            o.deliveryPoint && o.deliveryPoint !== 'shop' ? '已放入柜' : '请取餐'
          }</button>` : ''}
        </div>
      </div>`;
    })
    .join('');
}

function mediaSrc(url) {
  if (!url) return '';
  if (/^https?:\/\//.test(url)) return url;
  return url;
}

function setCoverPreview(url) {
  const img = $('#p_cover_preview');
  const cover = (url || '').trim();
  $('#p_cover').value = cover;
  if (cover) {
    img.src = mediaSrc(cover);
    img.classList.remove('hidden');
  } else {
    img.removeAttribute('src');
    img.classList.add('hidden');
  }
  $$('#coverGallery button').forEach((btn) => {
    btn.classList.toggle('on', btn.dataset.url === cover);
  });
}

const PRODUCT_CATS = ['酸奶捞', '网红小吃', '新鲜现剥', '果切系列', '鲜榨果汁', '水果零售', '水果捞', '热果奶', '经典热饮'];

function currentProductCat() {
  return state.productCat || '';
}

function setProductCat(cat) {
  if (state.productOrderDirty && !confirm('当前分类顺序尚未保存，切换将丢弃本次拖拽，继续？')) {
    return;
  }
  state.productCat = cat || '';
  state.productOrderDraft = null;
  state.productOrderDirty = false;
  $$('#productCatTabs .cat-tab').forEach((btn) => {
    btn.classList.toggle('on', (btn.dataset.cat || '') === state.productCat);
  });
  renderProductList();
}

function productOrderHintEl() {
  return $('#productOrderHint');
}

function updateProductOrderToolbar() {
  const cat = currentProductCat();
  const saveBtn = $('#saveProductOrderBtn');
  const previewBtn = $('#previewSalesOrderBtn');
  const resetBtn = $('#resetSalesOrderBtn');
  const hint = productOrderHintEl();
  const canSort = !!cat;
  // 选了分类就可点保存（未改时会 toast 提示），避免 disabled 看起来“没反应”
  if (saveBtn) saveBtn.disabled = !canSort;
  if (previewBtn) previewBtn.disabled = !canSort;
  if (resetBtn) resetBtn.disabled = !canSort;
  if (!hint) return;
  hint.classList.toggle('product-order-dirty', !!state.productOrderDirty);
  if (!cat) {
    hint.textContent = '请先选择具体分类，再拖拽排序';
    return;
  }
  const manual = !!(state.productOrder && Array.isArray(state.productOrder[cat]) && state.productOrder[cat].length);
  if (state.productOrderDirty) {
    hint.textContent = `「${cat}」顺序已改，请点「保存顺序」`;
  } else if (manual) {
    hint.textContent = `「${cat}」当前为手动顺序 · 可拖拽调整后保存`;
  } else {
    hint.textContent = `「${cat}」默认按销量 · 拖拽后点保存可固定顺序`;
  }
}

function shownProductsForSort() {
  const cat = currentProductCat();
  const list = state.products || [];
  if (!cat) return list.slice();
  if (Array.isArray(state.productOrderDraft) && state.productOrderDraft.length) {
    const byId = new Map(list.filter((p) => p.category === cat).map((p) => [p.id, p]));
    const ordered = [];
    const seen = new Set();
    for (const id of state.productOrderDraft) {
      const p = byId.get(id);
      if (!p || seen.has(id)) continue;
      ordered.push(p);
      seen.add(id);
    }
    for (const p of byId.values()) {
      if (!seen.has(p.id)) ordered.push(p);
    }
    return ordered;
  }
  return list.filter((p) => p.category === cat);
}

function bindProductDrag() {
  const cat = currentProductCat();
  if (!cat) return;
  const cards = $$('#productTable .product-card[draggable="true"]');
  let dragId = '';
  cards.forEach((card) => {
    card.addEventListener('dragstart', (e) => {
      dragId = card.dataset.id || '';
      card.classList.add('dragging');
      try {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', dragId);
      } catch (_) {
        /* ignore */
      }
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      $$('#productTable .product-card').forEach((c) => c.classList.remove('drag-over'));
      dragId = '';
    });
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      card.classList.add('drag-over');
      try {
        e.dataTransfer.dropEffect = 'move';
      } catch (_) {
        /* ignore */
      }
    });
    card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      card.classList.remove('drag-over');
      const fromId = dragId || (e.dataTransfer && e.dataTransfer.getData('text/plain'));
      const toId = card.dataset.id;
      if (!fromId || !toId || fromId === toId) return;
      const ids = shownProductsForSort().map((p) => p.id);
      const from = ids.indexOf(fromId);
      const to = ids.indexOf(toId);
      if (from < 0 || to < 0) return;
      ids.splice(from, 1);
      ids.splice(to, 0, fromId);
      state.productOrderDraft = ids;
      state.productOrderDirty = true;
      renderProductList();
    });
  });
}

function selectedProductIds() {
  return $$('#productTable .product-check:checked').map((el) => el.value).filter(Boolean);
}

function updateProductSelectionHint() {
  const hint = $('#productSelectionHint');
  if (!hint) return;
  const n = selectedProductIds().length;
  hint.textContent = `已选 ${n}`;
}

function renderProductList() {
  const cat = currentProductCat();
  const shown = shownProductsForSort();
  if (!shown.length) {
    $('#productTable').innerHTML = '<p class="muted" style="padding:16px">该分类暂无商品</p>';
    updateProductOrderToolbar();
    updateProductSelectionHint();
    return;
  }
  const canDrag = !!cat;
  const prevSelected = new Set(selectedProductIds());
  $('#productTable').innerHTML = shown
    .map((p, i) => {
      const specs = (p.specs || []).map((s) => `${s.name}¥${s.price}`).join(' / ');
      const thumb = p.cover
        ? `<img class="product-thumb" src="${mediaSrc(p.cover)}" alt="" draggable="false" />`
        : '<div class="product-thumb"></div>';
      const sales = Number(p.sales) || 0;
      const mode = p.sortMode === 'manual' ? '手动序' : '销量序';
      const checked = prevSelected.has(p.id) ? 'checked' : '';
      return `<div class="product-card ${checked ? 'selected' : ''}" data-id="${p.id}" ${canDrag ? 'draggable="true"' : ''}>
        <label class="product-side">
          <input class="product-check" type="checkbox" value="${p.id}" ${checked} title="勾选后可批量上架/下架" />
          ${canDrag ? '<span class="drag-handle" title="拖拽排序">⋮⋮</span>' : ''}
        </label>
        ${thumb}
        <div class="info">
          <div><strong>${p.name}</strong> · ${p.status === 1 ? '上架' : '下架'} · 销量 ${sales} · ${mode} · #${i + 1}</div>
          <div class="muted">${p.category} · ${specs}</div>
          ${p.desc ? `<div class="muted">${p.desc}</div>` : ''}
          <div class="actions">
            ${canDrag ? `<button type="button" class="btn sm" data-nudge="up" data-id="${p.id}" ${i === 0 ? 'disabled' : ''}>上移</button>
            <button type="button" class="btn sm" data-nudge="down" data-id="${p.id}" ${i === shown.length - 1 ? 'disabled' : ''}>下移</button>` : ''}
            <button type="button" class="btn sm" data-edit='${JSON.stringify(p).replace(/'/g, '&#39;')}' onclick="editProduct(JSON.parse(this.dataset.edit))">编辑</button>
            ${
              p.status === 1
                ? `<button type="button" class="btn sm" onclick="offProduct('${p.id}')">下架</button>`
                : `<button type="button" class="btn sm primary" onclick="onProduct('${p.id}')">上架</button>`
            }
          </div>
        </div>
      </div>`;
    })
    .join('');
  bindProductDrag();
  $$('#productTable [data-nudge]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      nudgeProduct(btn.dataset.id, btn.dataset.nudge);
    });
  });
  $$('#productTable .product-check').forEach((box) => {
    box.addEventListener('click', (e) => e.stopPropagation());
    box.addEventListener('change', () => {
      const card = box.closest('.product-card');
      if (card) card.classList.toggle('selected', box.checked);
      updateProductSelectionHint();
    });
  });
  updateProductOrderToolbar();
  updateProductSelectionHint();
}

async function batchSetProductStatus(status) {
  const ids = selectedProductIds();
  if (!ids.length) {
    toast('请先勾选商品');
    return;
  }
  const label = status === 1 ? '上架' : '下架';
  if (!confirm(`确认批量${label} ${ids.length} 个商品？`)) return;
  const data = await api('/api/admin/products/batch-status', {
    method: 'POST',
    body: JSON.stringify({ ids, status }),
  });
  toast(`已${label} ${data.count || 0} 个`);
  await loadProducts();
}

function previewCurrentCatBySales() {
  const cat = currentProductCat();
  if (!cat) {
    toast('请先选择具体分类');
    return;
  }
  const list = (state.products || [])
    .filter((p) => p.category === cat)
    .slice()
    .sort(
      (a, b) =>
        (Number(b.sales) || 0) - (Number(a.sales) || 0) ||
        String(a.name || '').localeCompare(String(b.name || ''), 'zh')
    );
  state.productOrderDraft = list.map((p) => p.id);
  state.productOrderDirty = true;
  renderProductList();
  toast('已按销量预览，确认后点保存');
}

async function saveCurrentProductOrder() {
  const cat = currentProductCat();
  if (!cat) {
    toast('请先选择具体分类（不要用「全部」）');
    return;
  }
  const ids = shownProductsForSort().map((p) => p.id);
  if (!ids.length) {
    toast('没有可保存的商品');
    return;
  }
  if (!state.productOrderDirty) {
    // 仍允许保存当前展示顺序（例如刚预览按销量）
    state.productOrderDraft = ids;
  }
  toast('正在保存顺序…');
  try {
    const data = await api('/api/admin/products/reorder', {
      method: 'POST',
      body: JSON.stringify({ category: cat, ids, mode: 'manual' }),
    });
    state.products = data.list || state.products;
    state.productOrder = data.productOrder || state.productOrder || {};
    state.productOrderDraft = null;
    state.productOrderDirty = false;
    renderProductList();
    toast('顺序已保存');
  } catch (e) {
    toast(e.message || '保存失败');
  }
}

function nudgeProduct(id, dir) {
  const cat = currentProductCat();
  if (!cat) {
    toast('请先选择具体分类');
    return;
  }
  const ids = shownProductsForSort().map((p) => p.id);
  const from = ids.indexOf(id);
  if (from < 0) return;
  const to = dir === 'up' ? from - 1 : from + 1;
  if (to < 0 || to >= ids.length) return;
  ids.splice(from, 1);
  ids.splice(to, 0, id);
  state.productOrderDraft = ids;
  state.productOrderDirty = true;
  renderProductList();
}

async function resetCurrentProductOrderToSales() {
  const cat = currentProductCat();
  if (!cat) {
    toast('请先选择具体分类');
    return;
  }
  if (!confirm(`恢复「${cat}」为默认按销量排序？已保存的手动顺序将清除。`)) return;
  try {
    const data = await api('/api/admin/products/reorder', {
      method: 'POST',
      body: JSON.stringify({ category: cat, mode: 'sales' }),
    });
    state.products = data.list || state.products;
    state.productOrder = data.productOrder || {};
    state.productOrderDraft = null;
    state.productOrderDirty = false;
    renderProductList();
    toast('已恢复按销量');
  } catch (e) {
    toast(e.message || '恢复失败');
  }
}

async function loadProducts() {
  const data = await api('/api/admin/products');
  state.products = data.list || [];
  state.productOrder = data.productOrder || {};
  if (state.productCat == null) state.productCat = '';
  state.productOrderDraft = null;
  state.productOrderDirty = false;
  renderProductList();
}

function readSpecsFromEditor() {
  const rows = [...document.querySelectorAll('#p_specs_editor .spec-row')];
  return rows
    .map((row, i) => {
      const name = (row.querySelector('.spec-name')?.value || '').trim();
      const price = Number(row.querySelector('.spec-price')?.value);
      const stock = Number(row.querySelector('.spec-stock')?.value);
      if (!name || !(price >= 0)) return null;
      const id = (row.dataset.id || `s${i + 1}`).replace(/\s+/g, '_');
      const next = {
        id,
        name,
        price: Math.round(price * 100) / 100,
        stock: Number.isFinite(stock) && stock >= 0 ? Math.floor(stock) : 999,
      };
      if (row.dataset.barcode) next.barcode = row.dataset.barcode;
      return next;
    })
    .filter(Boolean);
}

function addSpecRow(spec = {}) {
  const box = $('#p_specs_editor');
  if (!box) return;
  const row = document.createElement('div');
  row.className = 'spec-row';
  row.dataset.id = spec.id || `s${Date.now().toString(36)}`;
  if (spec.barcode) row.dataset.barcode = spec.barcode;
  row.innerHTML = `
    <input class="spec-name" placeholder="规格名 如 250g" value="${spec.name || ''}" />
    <input class="spec-price" type="number" min="0" step="0.1" placeholder="价格" value="${spec.price != null ? spec.price : ''}" />
    <input class="spec-stock" type="number" min="0" step="1" placeholder="库存" value="${spec.stock != null ? spec.stock : 999}" />
    <button type="button" class="spec-del" title="删除">×</button>
  `;
  row.querySelector('.spec-del').addEventListener('click', () => {
    row.remove();
    if (!$('#p_specs_editor .spec-row')) addSpecRow({ id: 'std', name: '标准', price: 15, stock: 999 });
  });
  box.appendChild(row);
}

function fillSpecsEditor(specs) {
  const box = $('#p_specs_editor');
  if (!box) return;
  box.innerHTML = '';
  const list = Array.isArray(specs) && specs.length ? specs : [{ id: 'std', name: '标准', price: 15, stock: 999 }];
  list.forEach((s) => addSpecRow(s));
}

window.editProduct = function editProduct(p) {
  $('#productDialogTitle').textContent = p?.id ? '编辑商品' : '新增商品';
  $('#p_id').value = p?.id || '';
  $('#p_name').value = p?.name || '';
  const cat = p?.category || currentProductCat() || '果切系列';
  $('#p_category').value = PRODUCT_CATS.includes(cat) ? cat : '果切系列';
  $('#p_desc').value = p?.desc || '';
  const salesHint = $('#p_sales_hint');
  if (salesHint) {
    salesHint.textContent = p?.id
      ? `累计销量 ${Number(p.sales) || 0}（由已支付订单统计；顺序请在列表拖拽后保存）`
      : '新商品默认按销量排列；顺序请在列表拖拽后保存';
  }
  setCoverPreview(p?.cover || '');
  $('#coverGallery').classList.add('hidden');
  $('#coverGallery').innerHTML = '';
  fillSpecsEditor(p?.specs);
  $('#p_extras').value = JSON.stringify(p?.extras || [], null, 2);
  $('#productDialog').showModal();
};

async function saveProduct(e) {
  e.preventDefault();
  const id = $('#p_id').value;
  const specs = readSpecsFromEditor();
  if (!specs.length) {
    alert('请至少填写一个有效规格（名称+价格）');
    return;
  }
  let extras;
  try {
    extras = JSON.parse($('#p_extras').value || '[]');
  } catch {
    alert('加料 JSON 格式错误');
    return;
  }
  const body = {
    name: $('#p_name').value.trim(),
    category: $('#p_category').value.trim(),
    desc: $('#p_desc').value.trim(),
    cover: $('#p_cover').value.trim(),
    specs,
    extras,
    status: 1,
  };
  if (id) await api(`/api/admin/products/${id}`, { method: 'PUT', body: JSON.stringify(body) });
  else await api('/api/admin/products', { method: 'POST', body: JSON.stringify(body) });
  $('#productDialog').close();
  // 保存后切到该分类 Tab，方便核对
  if (body.category) setProductCat(body.category);
  loadProducts();
}

async function showCoverGallery() {
  const box = $('#coverGallery');
  box.classList.remove('hidden');
  box.innerHTML = '<span class="muted">加载图库…</span>';
  try {
    const { list } = await api('/api/admin/product-covers');
    if (!list.length) {
      box.innerHTML = '<span class="muted">暂无图片，请先上传</span>';
      return;
    }
    const current = $('#p_cover').value.trim();
    box.innerHTML = list
      .map(
        (item) => `
      <button type="button" class="${item.url === current ? 'on' : ''}" data-url="${item.url}" title="${item.name}">
        <img src="${mediaSrc(item.url)}" alt="${item.name}" />
      </button>`
      )
      .join('');
    box.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => setCoverPreview(btn.dataset.url));
    });
  } catch (err) {
    box.innerHTML = `<span class="error">${err.message || '加载失败'}</span>`;
  }
}

async function onCoverFilePicked(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  toast('正在上传图片…');
  try {
    const res = await fetch(`${API}/api/admin/product-cover/upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${state.token}`,
        'Content-Type': file.type || 'image/jpeg',
      },
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '上传失败');
    setCoverPreview(data.cover);
    toast('图片已上传');
    if (!$('#coverGallery').classList.contains('hidden')) showCoverGallery();
  } catch (err) {
    toast(err.message || '上传失败');
  }
}

window.offProduct = async function offProduct(id) {
  if (!confirm('确认下架？')) return;
  await api(`/api/admin/products/${id}`, { method: 'DELETE' });
  toast('已下架');
  loadProducts();
};

window.onProduct = async function onProduct(id) {
  if (!confirm('确认重新上架？')) return;
  await api(`/api/admin/products/${id}`, { method: 'PUT', body: JSON.stringify({ status: 1 }) });
  toast('已上架');
  loadProducts();
};

window.batchOnProducts = () => batchSetProductStatus(1);
window.batchOffProducts = () => batchSetProductStatus(0);

window.setStatus = async function setStatus(id, status) {
  await api(`/api/orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
  if (status === 'making') await printReceipt(id, { skipPrinted: true });
  refresh();
};

window.printReceipt = async function printReceipt(orderId, opts = {}) {
  if (opts.skipPrinted && state.receiptPrintedIds.has(orderId)) return false;
  if (window.DetongPrint && DetongPrint.prepareUsb) DetongPrint.prepareUsb();
  if (!window.DetongPrint || !DetongPrint.printOrderReceipt) {
    if (!opts.quiet) toast('本机打印未就绪');
    return false;
  }
  try {
    const data = await api(`/api/print/label/${orderId}`);
    if (!data.order?.pickupCode) throw new Error('订单无取餐码');
    await DetongPrint.printOrderReceipt({
      order: data.order,
      shopName: data.shopName || '四季果先',
    });
    state.receiptPrintedIds.add(orderId);
    if (!opts.quiet) toast(`小票已打印 ${data.order.pickupCode || ''}`);
    return true;
  } catch (e) {
    console.warn('[receipt]', e);
    if (!opts.quiet) toast((e && e.message) || '热敏打印失败');
    return false;
  }
};

window.printLabel = async function printLabel(orderId, opts = {}) {
  if (window.DetongPrint && DetongPrint.prepareUsb) DetongPrint.prepareUsb();
  const data = await api(`/api/print/label/${orderId}`);
  if (opts.skipPrinted && data.order?.printed) return false;

  // 优先走德佟本地标签机（需本机安装 dtpweb 打印助手）
  if (window.DetongPrint && DetongPrint.isAvailable()) {
    try {
      await DetongPrint.printOrderLabel({
        order: data.order,
        shopName: data.shopName || '四季果先',
      });
      toast(`德佟已打印 ${data.order?.pickupCode || ''}`);
      try {
        await api(`/api/orders/${orderId}/printed`, { method: 'POST', body: '{}' });
      } catch {
        /* ignore */
      }
      return;
    } catch (e) {
      console.warn('[detong]', e);
      toast((e && e.message) || '德佟打印失败');
      return;
    }
  }

  const w = window.open('', '_blank', 'width=420,height=320');
  if (!w) {
    toast('浏览器拦截了弹窗，请允许后重试（或检查德佟打印助手）');
    return;
  }
  w.document.write(data.html);
  w.document.close();
  try {
    await api(`/api/orders/${orderId}/printed`, { method: 'POST', body: '{}' });
  } catch {
    /* ignore */
  }
};

let pendingUpload = { orderId: '', makeBatchId: '' };

window.uploadPhoneVideo = function uploadPhoneVideo(orderId, makeBatchId) {
  pendingUpload = { orderId, makeBatchId: makeBatchId || '' };
  const input = $('#phoneVideoInput');
  input.value = '';
  input.click();
};

async function onPhoneVideoPicked(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  if (!pendingUpload.orderId && !pendingUpload.makeBatchId) {
    toast('未选择订单');
    return;
  }
  toast('正在上传视频…');
  try {
    const q = pendingUpload.makeBatchId
      ? `makeBatchId=${encodeURIComponent(pendingUpload.makeBatchId)}`
      : `orderId=${encodeURIComponent(pendingUpload.orderId)}`;
    const res = await fetch(`${API}/api/admin/videos/upload?${q}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${state.token}`,
        'Content-Type': file.type || 'video/mp4',
      },
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '上传失败');
    toast(`上传成功，已绑定 ${data.boundOrders} 单`);
    refresh();
  } catch (err) {
    toast(err.message || '上传失败');
  }
}

async function verify() {
  const raw = $('#verifyInput').value.trim();
  if (!raw) return;
  try {
    let body = {};
    if (/^A\d+$/i.test(raw)) body = { pickupCode: raw.toUpperCase() };
    else {
      try {
        JSON.parse(raw);
        body = { payload: raw };
      } catch {
        body = { orderNo: raw };
      }
    }
    const data = await api('/api/orders/verify', { method: 'POST', body: JSON.stringify(body) });
    const addons = collectAddons(data.order);
    $('#verifyResult').textContent = `已确认取餐\n取餐号 ${data.order.pickupCode}\n${data.order.productName} · ${data.order.specName}${
      addons.length ? `\n小料 ${addons.join('、')}` : ''
    }\n¥${data.order.amount}`;
    $('#verifyInput').value = '';
    refresh();
  } catch (e) {
    $('#verifyResult').textContent = e.message;
  }
}

async function loadDelivery() {
  const data = await api('/api/admin/delivery');
  const points = data.points || [];
  const scopeNote = data.scopeNote || '仅配送机器人产业园园区内，园区外暂不支持';
  const box = $('#deliveryList');
  if (!box) return;
  box.innerHTML = `<p class="muted" style="margin:0 0 12px;color:#e65100;font-weight:600">${scopeNote}</p>${(points || [])
    .map((p) => {
      const feeDisabled = p.id === 'shop' ? 'disabled' : '';
      return `<div class="delivery-row" data-id="${p.id}">
        <div class="delivery-main">
          <label>名称</label>
          <input class="d-name" value="${String(p.name || '').replace(/"/g, '&quot;')}" />
        </div>
        <div class="delivery-fee">
          <label>配送费（元）</label>
          <input class="d-fee" type="number" min="0" step="0.1" value="${Number(p.fee) || 0}" ${feeDisabled} />
        </div>
        <div class="delivery-tip">
          <label>说明</label>
          <input class="d-tip" value="${String(p.tip || '').replace(/"/g, '&quot;')}" />
        </div>
      </div>`;
    })
    .join('')}`;
}

async function saveDelivery() {
  const rows = [...document.querySelectorAll('#deliveryList .delivery-row')];
  const points = rows.map((row) => ({
    id: row.dataset.id,
    name: row.querySelector('.d-name')?.value?.trim() || '',
    tip: row.querySelector('.d-tip')?.value?.trim() || '',
    fee: row.querySelector('.d-fee')?.value,
  }));
  try {
    await api('/api/admin/delivery', { method: 'PUT', body: JSON.stringify({ points }) });
    toast('配送配置已保存');
    await loadDelivery();
  } catch (e) {
    toast(e.message || '保存失败');
  }
}

async function loadReserveCategories() {
  const data = await api('/api/admin/reserve-categories');
  const cats = data.categories || [];
  const enabled = new Set(data.enabled || []);
  const box = $('#reserveCategoryList');
  if (!box) return;
  box.innerHTML = cats
    .map(
      (c) => `
    <label class="reserve-cat-row">
      <input type="checkbox" class="reserve-cat-check" value="${c}" ${enabled.has(c) ? 'checked' : ''} />
      <span class="reserve-cat-name">${c}</span>
      <span class="muted">${enabled.has(c) ? '可预定' : '仅现取'}</span>
    </label>`
    )
    .join('');
}

async function saveReserveCategories() {
  try {
    const enabled = $$('.reserve-cat-check:checked').map((el) => el.value);
    await api('/api/admin/reserve-categories', {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    });
    toast('预定分类已保存');
    await loadReserveCategories();
  } catch (e) {
    toast(e.message || '保存失败');
  }
}

function fmtTime(t) {
  return t ? new Date(t).toLocaleString('zh-CN', { hour12: false }) : '-';
}

function renderUserPager(data) {
  const page = Number(data.page) || 1;
  const pages = Number(data.pages) || 1;
  const total = Number(data.total) || 0;
  const el = $('#userPager');
  if (!el) return;
  if (pages <= 1 && total <= (Number(data.pageSize) || 20)) {
    el.innerHTML = total ? `<span class="muted">共 ${total} 人</span>` : '';
    return;
  }
  el.innerHTML = `
    <button type="button" class="btn sm" id="userPrevPage" ${page <= 1 ? 'disabled' : ''}>上一页</button>
    <span class="muted">第 ${page} / ${pages} 页 · 共 ${total} 人</span>
    <button type="button" class="btn sm" id="userNextPage" ${page >= pages ? 'disabled' : ''}>下一页</button>
  `;
  $('#userPrevPage')?.addEventListener('click', () => {
    state.userPage = Math.max(1, page - 1);
    loadUsers().catch((e) => toast(e.message));
  });
  $('#userNextPage')?.addEventListener('click', () => {
    state.userPage = Math.min(pages, page + 1);
    loadUsers().catch((e) => toast(e.message));
  });
}

async function loadUsers() {
  const activeDays = Number($('#activeDaysInput')?.value || 14);
  const q = ($('#userSearch')?.value || '').trim();
  const pageSize = Number($('#userPageSize')?.value || 20) || 20;
  const page = Math.max(1, Number(state.userPage) || 1);
  const qs = new URLSearchParams({
    segment: 'all',
    activeDays: String(activeDays),
    page: String(page),
    pageSize: String(pageSize),
  });
  if (q) qs.set('q', q);
  const data = await api(`/api/admin/users?${qs}`);
  const s = data.summary || {};
  state.userPage = data.page || page;
  $('#userStats').innerHTML = `
    <div class="stat"><div class="label">会员总数</div><div class="value">${s.total || 0}</div></div>
    <div class="stat"><div class="label">活跃（${s.activeDays || activeDays}天）</div><div class="value">${s.active || 0}</div></div>
    <div class="stat"><div class="label">不活跃</div><div class="value">${s.inactive || 0}</div></div>
    <div class="stat"><div class="label">本页</div><div class="value">${(data.list || []).length}</div></div>
  `;
  state.users = data.list || [];
  const rows = state.users
    .map(
      (u) => `<tr>
      <td>${u.nickName || '果粉'}</td>
      <td>${u.phone || '-'}</td>
      <td>${u.segment === 'active' ? '活跃' : '不活跃'}</td>
      <td>¥${Number(u.balance || 0).toFixed(2)}</td>
      <td>${u.couponUnused || 0}</td>
      <td>${u.paidCount || 0}</td>
      <td>${fmtTime(u.lastOrderAt)}</td>
      <td><button type="button" class="btn sm user-edit" data-id="${u.id}">维护</button></td>
    </tr>`
    )
    .join('');
  $('#userTable').innerHTML = `
    <table class="table">
      <thead><tr><th>昵称</th><th>手机</th><th>状态</th><th>余额</th><th>未用券</th><th>支付单</th><th>最近下单</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="8" class="muted">暂无会员</td></tr>'}</tbody>
    </table>`;
  renderUserPager(data);
}

async function loadCouponUsers() {
  const segment = $('#userSegment')?.value || 'inactive';
  const activeDays = Number($('#activeDaysInput')?.value || 14);
  const qs = new URLSearchParams({
    segment,
    activeDays: String(activeDays),
  });
  const data = await api(`/api/admin/users?${qs}`);
  const s = data.summary || {};
  if ($('#activeDaysLabel')) $('#activeDaysLabel').textContent = String(s.activeDays || activeDays);
  if ($('#couponUserStats')) {
    $('#couponUserStats').innerHTML = `
      <div class="stat"><div class="label">会员总数</div><div class="value">${s.total || 0}</div></div>
      <div class="stat"><div class="label">活跃</div><div class="value">${s.active || 0}</div></div>
      <div class="stat"><div class="label">不活跃</div><div class="value">${s.inactive || 0}</div></div>
      <div class="stat"><div class="label">将发券人数</div><div class="value">${(data.list || []).length}</div></div>
    `;
  }
  const rows = (data.list || [])
    .slice(0, 100)
    .map(
      (u) => `<tr>
      <td>${u.nickName || '果粉'}</td>
      <td>${u.phone || '-'}</td>
      <td>${u.segment === 'active' ? '活跃' : '不活跃'}</td>
      <td>${u.paidCount || 0}</td>
      <td>${fmtTime(u.lastOrderAt)}</td>
    </tr>`
    )
    .join('');
  if ($('#couponUserTable')) {
    $('#couponUserTable').innerHTML = `
      <table class="table">
        <thead><tr><th>昵称</th><th>手机</th><th>状态</th><th>支付单</th><th>最近下单</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5" class="muted">当前人群无人</td></tr>'}</tbody>
      </table>
      ${(data.list || []).length > 100 ? '<p class="muted">仅预览前 100 人；发券仍按完整人群。</p>' : ''}`;
  }
  await loadOff153Scope().catch(() => {});
}

function renderUserLedger(ledger) {
  const rows = (ledger || [])
    .map(
      (x) => `<tr>
      <td>${fmtTime(x.createdAt)}</td>
      <td>${x.type || ''}</td>
      <td>${Number(x.amount) >= 0 ? '+' : ''}${Number(x.amount || 0).toFixed(2)}</td>
      <td>¥${Number(x.balanceAfter || 0).toFixed(2)}</td>
      <td class="muted">${x.note || ''}</td>
    </tr>`
    )
    .join('');
  $('#u_ledger').innerHTML = `
    <table class="table">
      <thead><tr><th>时间</th><th>类型</th><th>变动</th><th>余额</th><th>说明</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" class="muted">暂无流水</td></tr>'}</tbody>
    </table>`;
}

function renderUserCoupons(coupons) {
  const statusText = { unused: '未用', used: '已用', expired: '过期', merged_void: '作废' };
  const rows = (coupons || [])
    .map(
      (c) => `<tr>
      <td>${c.title || ''}</td>
      <td>¥${Number(c.amount || 0).toFixed(2)}</td>
      <td>${statusText[c.status] || c.status || ''}</td>
      <td class="muted">${fmtTime(c.expiresAt)}</td>
    </tr>`
    )
    .join('');
  $('#u_coupons').innerHTML = `
    <table class="table">
      <thead><tr><th>券</th><th>面额</th><th>状态</th><th>到期</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4" class="muted">暂无券</td></tr>'}</tbody>
    </table>`;
}

function fillUserDialog(detail) {
  const u = detail.user || {};
  $('#u_id').value = u.id || '';
  $('#u_nickName').value = u.nickName || '';
  $('#u_phone').value = u.phone || '';
  $('#u_note').value = u.note || '';
  const cs = detail.couponSummary || {};
  $('#u_meta').textContent =
    `余额 ¥${Number(u.balance || 0).toFixed(2)} · 支付 ${u.paidCount || 0} 单 / ¥${Number(u.paidAmount || 0).toFixed(2)} · 券未用 ${cs.unused || 0} · ${u.segment === 'active' ? '活跃' : '不活跃'}`;
  renderUserLedger(detail.ledger);
  renderUserCoupons(detail.coupons);
}

async function openUserEditor(userId) {
  const detail = await api(`/api/admin/users/${encodeURIComponent(userId)}`);
  fillUserDialog(detail);
  const dlg = $('#userDialog');
  if (dlg?.showModal) dlg.showModal();
  else dlg?.removeAttribute('hidden');
}

async function saveUserProfile() {
  const id = $('#u_id').value;
  if (!id) return;
  try {
    const detail = await api(`/api/admin/users/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({
        nickName: $('#u_nickName').value.trim(),
        phone: $('#u_phone').value.trim(),
        note: $('#u_note').value.trim(),
      }),
    });
    fillUserDialog(detail);
    toast('会员资料已保存');
    await loadUsers();
  } catch (e) {
    toast(e.message || '保存失败');
  }
}

async function adjustUserBalance() {
  toast('已禁止后台调整会员余额');
}

function fillProductSelect(sel, products, selectedId, emptyLabel) {
  if (!sel) return;
  const opts = [`<option value="">${emptyLabel || '不限定'}</option>`].concat(
    (products || []).map(
      (p) =>
        `<option value="${p.id}" ${p.id === selectedId ? 'selected' : ''}>${p.name}</option>`
    )
  );
  sel.innerHTML = opts.join('');
}

async function loadOff153Scope() {
  if (!$('#off153Bowl') || !$('#off153Cut')) return;
  if (!state.products || !state.products.length) {
    try {
      const { list } = await api('/api/admin/products');
      state.products = list || [];
    } catch (_) {
      state.products = [];
    }
  }
  const bowls = (state.products || []).filter((p) => (p.category === '水果捞' || p.category === '酸奶捞') && p.status !== 0);
  const cuts = (state.products || []).filter((p) => p.category === '果切系列' && p.status !== 0);
  const scope = await api('/api/admin/coupons/off15-3-scope');
  fillProductSelect($('#off153Bowl'), bowls, scope.fruitBowlProductId, '选择一款水果捞');
  fillProductSelect($('#off153Cut'), cuts, scope.cutFruitProductId, '选择一款果切');
  if ($('#off153Hint')) $('#off153Hint').textContent = scope.hint || '';
}

async function saveOff153Scope() {
  try {
    const scope = await api('/api/admin/coupons/off15-3-scope', {
      method: 'PUT',
      body: JSON.stringify({
        fruitBowlProductId: $('#off153Bowl')?.value || '',
        cutFruitProductId: $('#off153Cut')?.value || '',
      }),
    });
    if ($('#off153Hint')) $('#off153Hint').textContent = scope.hint || '';
    toast(scope.configured ? '满15减3 限定商品已保存' : '已清空限定（暂不限商品）');
  } catch (e) {
    toast(e.message || '保存失败');
  }
}

function presetOff153Grant() {
  if ($('#grantAmount')) $('#grantAmount').value = '3';
  if ($('#grantThreshold')) $('#grantThreshold').value = '15';
  if ($('#grantTitle')) $('#grantTitle').value = '满15减3';
  if ($('#grantFulfillment')) $('#grantFulfillment').value = 'any';
  if ($('#grantCount')) $('#grantCount').value = '1';
  toast('已填入满15减3；发券时会带上当前限定商品');
}

function lotteryRateText(weight, total) {
  if (!(total > 0)) return '0%';
  const pct = Math.round((Number(weight) / total) * 1000) / 10;
  return `${pct}%`;
}

function refreshLotteryRates() {
  const inputs = [...document.querySelectorAll('.lottery-weight')];
  const total = inputs.reduce((s, el) => s + (Number(el.value) || 0), 0);
  inputs.forEach((el) => {
    const cell = el.closest('tr') && el.closest('tr').querySelector('.lottery-rate');
    if (cell) cell.textContent = lotteryRateText(el.value, total);
  });
  const sumEl = $('#lotteryWeightSum');
  if (sumEl) sumEl.textContent = `权重合计 ${total}（概率按占比自动换算）`;
}

function renderToppingsEditor() {
  const list = state.toppings || [];
  if (!list.length) {
    $('#toppingsTable').innerHTML = '<p class="muted" style="padding:12px">暂无小料，请点「新增小料」</p>';
    return;
  }
  $('#toppingsTable').innerHTML = `
    <table class="table">
      <thead>
        <tr><th>名称</th><th>规格</th><th>价格</th><th>上架</th><th></th></tr>
      </thead>
      <tbody>
        ${list
          .map(
            (t, i) => `<tr data-idx="${i}">
          <td><input class="tp-name" value="${String(t.name || '').replace(/"/g, '&quot;')}" style="width:120px" /></td>
          <td><input class="tp-spec" value="${String(t.spec || '一份').replace(/"/g, '&quot;')}" style="width:80px" /></td>
          <td><input class="tp-price" type="number" min="0" step="0.1" value="${Number(t.price) || 0}" style="width:72px" /></td>
          <td><input class="tp-on" type="checkbox" ${t.status === 0 ? '' : 'checked'} /></td>
          <td><button type="button" class="btn sm tp-del" data-idx="${i}">删除</button></td>
        </tr>`
          )
          .join('')}
      </tbody>
    </table>`;
  $$('#toppingsTable .tp-del').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.idx);
      state.toppings.splice(idx, 1);
      renderToppingsEditor();
    });
  });
}

function readToppingsFromEditor() {
  return [...document.querySelectorAll('#toppingsTable tbody tr')].map((row, i) => {
    const prev = (state.toppings || [])[i] || {};
    return {
      id: prev.id,
      name: row.querySelector('.tp-name')?.value || '',
      spec: row.querySelector('.tp-spec')?.value || '一份',
      price: Number(row.querySelector('.tp-price')?.value) || 0,
      status: row.querySelector('.tp-on')?.checked ? 1 : 0,
      createdAt: prev.createdAt || Date.now(),
    };
  });
}

async function loadToppings() {
  const data = await api('/api/admin/toppings');
  state.toppings = Array.isArray(data.list) ? data.list.slice() : [];
  renderToppingsEditor();
}

function sideMealStockText(sm) {
  if (!sm || sm.enabled === false || sm.enabled === 0) return '小食加购已关闭';
  if (sm.stock == null) return '不限量';
  if (Number(sm.stock) <= 0) return '当前已售罄（0）';
  return `当前剩余 ${sm.stock} 份`;
}

function updateSideMealStatus() {
  const el = $('#sm_status');
  if (!el) return;
  const sm = state.sideMeal || {};
  const on = sm.enabled !== false && sm.enabled !== 0;
  const cats = (sm.categories || []).join('、') || '未选分类';
  el.textContent = on
    ? `已开启 · ${sideMealStockText(sm)}（在今日概览调整） · 适用：${cats}`
    : '已关闭 · 小程序结算页不显示小食加购';
  el.classList.toggle('ok-line', on && (sm.stock == null || Number(sm.stock) > 0));
  el.classList.toggle('warn-line', !on || (sm.stock != null && Number(sm.stock) <= 0));
}

function renderDashSideMealStock() {
  const sm = state.sideMeal || {};
  const unlimited = sm.stock == null;
  const unEl = $('#dash_sm_unlimited');
  const stockEl = $('#dash_sm_stock');
  const statusEl = $('#dash_sm_status');
  if (unEl) unEl.checked = unlimited;
  if (stockEl) {
    stockEl.disabled = unlimited;
    stockEl.value = unlimited ? '' : String(sm.stock ?? 0);
  }
  if (statusEl) {
    statusEl.textContent = sideMealStockText(sm);
    statusEl.classList.toggle('ok-line', sm.enabled !== false && (sm.stock == null || Number(sm.stock) > 0));
    statusEl.classList.toggle('warn-line', sm.enabled === false || (sm.stock != null && Number(sm.stock) <= 0));
  }
}

async function loadDashSideMealStock() {
  const data = await api('/api/admin/side-meal');
  state.sideMeal = { ...(state.sideMeal || {}), ...(data.sideMeal || {}) };
  if (data.categories) state.sideMealCategories = data.categories;
  renderDashSideMealStock();
}

/** 仅更新当前剩余，不改菜单配置 */
async function saveSideMealStockOnly(stock, { quiet } = {}) {
  const data = await api('/api/admin/side-meal');
  const cur = data.sideMeal || state.sideMeal || {};
  const payload = {
    ...cur,
    stock: stock == null ? null : Math.max(0, Math.floor(Number(stock) || 0)),
  };
  const saved = await api('/api/admin/side-meal', {
    method: 'PUT',
    body: JSON.stringify({ sideMeal: payload }),
  });
  state.sideMeal = saved.sideMeal || payload;
  renderDashSideMealStock();
  if (state.tab === 'sidemeal') updateSideMealStatus();
  if (!quiet) toast(sideMealStockText(state.sideMeal));
  else toast(`已更新 · ${sideMealStockText(state.sideMeal)}`);
}

function renderSideMealEditor() {
  const sm = state.sideMeal || {};
  const cats = state.sideMealCategories || PRODUCT_CATS;
  const enabled = sm.enabled !== false && sm.enabled !== 0;
  const en = $('#sm_enabled');
  if (en) en.checked = enabled;
  const titleEl = $('#sm_title');
  const subEl = $('#sm_subtitle');
  if (!titleEl || !subEl || !$('#sm_proteins') || !$('#sm_carbs')) {
    console.error('小食设置面板未找到，请强刷管理端页面');
    toast('小食设置面板加载异常，请强制刷新页面');
    return;
  }
  titleEl.value = sm.title || '';
  subEl.value = sm.subtitle || '';
  updateSideMealStatus();
  const onCats = new Set(sm.categories || []);
  $('#sm_categories').innerHTML = cats
    .map(
      (c) => `<label class="check-row" style="display:flex;align-items:center;gap:8px;margin:6px 0">
        <input type="checkbox" class="sm-cat" value="${c}" ${onCats.has(c) ? 'checked' : ''} />
        <span>${c}</span>
      </label>`
    )
    .join('');

  const proteins = Array.isArray(sm.proteins) ? sm.proteins : [];
  $('#sm_proteins').innerHTML = `
    <table class="table">
      <thead><tr><th>名称</th><th>克重</th><th>标签</th><th>蛋白g</th><th>碳水g</th><th>优惠价</th><th>原价</th><th>上架</th><th></th></tr></thead>
      <tbody>
        ${proteins
          .map(
            (p, i) => `<tr data-idx="${i}">
          <td><input class="sm-p-name" value="${String(p.name || '').replace(/"/g, '&quot;')}" style="width:120px" /></td>
          <td><input class="sm-p-weight" value="${String(p.weight || '').replace(/"/g, '&quot;')}" style="width:56px" /></td>
          <td><input class="sm-p-tag" value="${String(p.tag || '').replace(/"/g, '&quot;')}" style="width:72px" placeholder="强烈推荐" /></td>
          <td><input class="sm-p-pg" type="number" min="0" step="0.1" value="${p.proteinG != null ? Number(p.proteinG) : ''}" style="width:56px" /></td>
          <td><input class="sm-p-cg" type="number" min="0" step="0.1" value="${p.carbG != null ? Number(p.carbG) : ''}" style="width:56px" /></td>
          <td><input class="sm-p-price" type="number" min="0" step="0.1" value="${Number(p.price) || 0}" style="width:64px" title="实际收费" /></td>
          <td><input class="sm-p-orig" type="number" min="0" step="0.1" value="${Number(p.originalPrice) > 0 ? Number(p.originalPrice) : Number(p.price) || 0}" style="width:64px" title="划线原价" /></td>
          <td><input class="sm-p-on" type="checkbox" ${p.enabled === false ? '' : 'checked'} /></td>
          <td><button type="button" class="btn sm sm-p-del" data-idx="${i}">删除</button></td>
        </tr>`
          )
          .join('')}
      </tbody>
    </table>`;
  $$('#sm_proteins .sm-p-del').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.idx);
      state.sideMeal.proteins.splice(idx, 1);
      renderSideMealEditor();
    });
  });

  const carbs = Array.isArray(sm.carbs) ? sm.carbs : [];
  $('#sm_carbs').innerHTML = `
    <table class="table">
      <thead><tr><th>名称</th><th>克重</th><th>上架</th><th></th></tr></thead>
      <tbody>
        ${carbs
          .map(
            (c, i) => `<tr data-idx="${i}">
          <td><input class="sm-c-name" value="${String(c.name || '').replace(/"/g, '&quot;')}" style="width:120px" /></td>
          <td><input class="sm-c-weight" value="${String(c.weight || '100g').replace(/"/g, '&quot;')}" style="width:72px" /></td>
          <td><input class="sm-c-on" type="checkbox" ${c.enabled === false ? '' : 'checked'} /></td>
          <td><button type="button" class="btn sm sm-c-del" data-idx="${i}">删除</button></td>
        </tr>`
          )
          .join('')}
      </tbody>
    </table>`;
  $$('#sm_carbs .sm-c-del').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.idx);
      state.sideMeal.carbs.splice(idx, 1);
      renderSideMealEditor();
    });
  });
}

function readSideMealFromEditor() {
  const prev = state.sideMeal || {};
  const proteins = [...document.querySelectorAll('#sm_proteins tbody tr')].map((row, i) => {
    const old = (prev.proteins || [])[i] || {};
    const tag = row.querySelector('.sm-p-tag')?.value || '';
    return {
      id: old.id || `protein-${Date.now().toString(36)}-${i}`,
      name: row.querySelector('.sm-p-name')?.value || '',
      weight: row.querySelector('.sm-p-weight')?.value || '',
      tag,
      recommend: /强烈推荐|墙裂推荐/.test(tag) || !!old.recommend,
      proteinG: row.querySelector('.sm-p-pg')?.value === '' ? null : Number(row.querySelector('.sm-p-pg')?.value),
      carbG: row.querySelector('.sm-p-cg')?.value === '' ? null : Number(row.querySelector('.sm-p-cg')?.value),
      price: Number(row.querySelector('.sm-p-price')?.value) || 0,
      originalPrice: Number(row.querySelector('.sm-p-orig')?.value) || 0,
      enabled: !!row.querySelector('.sm-p-on')?.checked,
    };
  });
  const carbs = [...document.querySelectorAll('#sm_carbs tbody tr')].map((row, i) => {
    const old = (prev.carbs || [])[i] || {};
    return {
      id: old.id || `carb-${Date.now().toString(36)}-${i}`,
      name: row.querySelector('.sm-c-name')?.value || '',
      weight: row.querySelector('.sm-c-weight')?.value || '100g',
      enabled: !!row.querySelector('.sm-c-on')?.checked,
    };
  });
  const categories = [...document.querySelectorAll('#sm_categories .sm-cat:checked')].map((el) => el.value);
  // 剩余份数在今日概览维护，这里保留当前值避免被菜单保存覆盖
  const stock = Object.prototype.hasOwnProperty.call(prev, 'stock') ? prev.stock : null;
  return {
    enabled: !!$('#sm_enabled')?.checked,
    title: $('#sm_title')?.value || '',
    subtitle: $('#sm_subtitle')?.value || '',
    stock: stock == null ? null : Math.max(0, Math.floor(Number(stock) || 0)),
    categories,
    proteins,
    carbs,
  };
}

async function loadSideMeal() {
  try {
    const data = await api('/api/admin/side-meal');
    state.sideMeal = data.sideMeal || {};
    state.sideMealCategories = data.categories || PRODUCT_CATS;
    renderSideMealEditor();
  } catch (e) {
    console.error(e);
    toast(e.message || '小食设置加载失败');
    throw e;
  }
}

async function saveSideMeal(opts = {}) {
  const quiet = !!opts.quiet;
  try {
    const payload = readSideMealFromEditor();
    const data = await api('/api/admin/side-meal', {
      method: 'PUT',
      body: JSON.stringify({ sideMeal: payload }),
    });
    state.sideMeal = data.sideMeal || payload;
    renderSideMealEditor();
    toast(
      quiet
        ? state.sideMeal.enabled !== false
          ? state.sideMeal.stock == null
            ? '已开启小食加购（不限量）'
            : `已保存 · 当前剩余 ${state.sideMeal.stock} 份`
          : '已关闭小食加购'
        : '小食设置已保存'
    );
  } catch (e) {
    toast(e.message || '保存失败');
    // 开关保存失败时按服务端状态回滚勾选
    if (quiet) renderSideMealEditor();
  }
}

async function saveToppings() {
  try {
    const list = readToppingsFromEditor();
    const data = await api('/api/admin/toppings', {
      method: 'PUT',
      body: JSON.stringify({ list }),
    });
    state.toppings = data.list || list;
    renderToppingsEditor();
    toast('小料已保存');
  } catch (e) {
    toast(e.message || '保存失败');
  }
}

async function loadLottery() {
  const data = await api('/api/admin/lottery');
  const L = data.lottery || {};
  state.lotteryPrizes = (L.prizes || []).map((p) => ({ ...p }));
  $('#lotteryEnabled').checked = !!L.enabled;
  $('#lotteryStart').value = L.startDate || '';
  $('#lotteryEnd').value = L.endDate || '';
  $('#lotteryValidDays').value = L.validDays || 30;
  $('#lotteryTitle').value = L.title || '开业抽奖';
  const by = data.byPrize || {};
  const total = (L.prizes || []).reduce((s, p) => s + (Number(p.weight) || 0), 0);
  const rows = (L.prizes || [])
    .map((p, i) => {
      const drawn = by[p.id] || 0;
      const stock = p.stock != null ? Number(p.stock) : null;
      const left = stock != null ? Math.max(0, stock - drawn) : null;
      const stockCell =
        stock != null
          ? `<input class="lottery-stock" type="number" min="0" step="1" value="${stock}"
              style="width:64px" data-idx="${i}" title="名额上限" />
             <span class="muted" style="margin-left:4px">余${left}</span>`
          : '<span class="muted">不限</span>';
      return `<tr data-idx="${i}">
      <td>${p.title}${p.qty > 1 ? ` <span class="muted">×${p.qty}</span>` : ''}</td>
      <td>${p.type}</td>
      <td>
        <input class="lottery-weight" type="number" min="0" step="1" value="${Number(p.weight) || 0}"
          style="width:72px" data-idx="${i}" />
      </td>
      <td class="lottery-rate">${lotteryRateText(p.weight, total)}</td>
      <td>${stockCell}</td>
      <td>${drawn}</td>
      <td class="muted">${p.desc || ''}</td>
    </tr>`;
    })
    .join('');
  $('#lotteryPrizeTable').innerHTML = `
    <table class="table">
      <thead><tr><th>奖品</th><th>类型</th><th>权重</th><th>中奖概率</th><th>名额</th><th>已抽中</th><th>说明</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" class="muted">无奖品</td></tr>'}</tbody>
    </table>
    <p class="muted" id="lotteryWeightSum" style="margin-top:8px">权重合计 ${total}（概率按占比自动换算；有名额的奖品抽完即止）</p>`;
  $('#lotteryStats').textContent = `累计抽奖 ${data.drawCount || 0} 次 · 当前${L.enabled ? '已开启' : '关闭'} · 日期 ${L.startDate || '不限'} ~ ${L.endDate || '不限'}`;
  const hint = $('#lotteryEnableHint');
  if (hint) {
    hint.textContent = L.enabled
      ? '活动已开启。小程序「我的」可见「进行中」，首页可弹转盘。'
      : '当前未开启：仅改日期不够，请勾选「开启活动」后点保存。';
    hint.classList.toggle('warn-line', !L.enabled);
    hint.classList.toggle('ok-line', !!L.enabled);
  }
  document.querySelectorAll('.lottery-weight').forEach((el) => {
    el.addEventListener('input', refreshLotteryRates);
  });
}

async function saveLottery() {
  try {
    const base = state.lotteryPrizes || [];
    const prizes = base.map((p, i) => {
      const input = document.querySelector(`.lottery-weight[data-idx="${i}"]`);
      const weight = input ? Math.max(0, Number(input.value) || 0) : Number(p.weight) || 0;
      const stockInput = document.querySelector(`.lottery-stock[data-idx="${i}"]`);
      const next = { ...p, weight };
      if (stockInput) {
        next.stock = Math.max(0, Math.floor(Number(stockInput.value) || 0));
      }
      return next;
    });
    const sum = prizes.reduce((s, p) => s + (Number(p.weight) || 0), 0);
    if (!(sum > 0)) return toast('权重合计须大于 0');
    await api('/api/admin/lottery', {
      method: 'PUT',
      body: JSON.stringify({
        enabled: $('#lotteryEnabled').checked,
        startDate: $('#lotteryStart').value || '',
        endDate: $('#lotteryEnd').value || '',
        validDays: Number($('#lotteryValidDays').value || 30),
        title: ($('#lotteryTitle').value || '').trim() || '开业抽奖',
        prizes,
      }),
    });
    toast('抽奖配置已保存（含中奖概率）');
    await loadLottery();
  } catch (e) {
    toast(e.message || '保存失败');
  }
}

async function loadWallet() {
  const data = await api('/api/admin/wallet');
  const W = data.wallet || {};
  state.walletTiers = (W.tiers || []).map((t) => ({ ...t }));
  if ($('#walletEnabled')) $('#walletEnabled').checked = !!W.enabled;
  renderWalletTiers();
}

function renderWalletTiers() {
  const tiers = state.walletTiers || [];
  const rows = tiers
    .map(
      (t, i) => `<tr data-idx="${i}">
      <td><input class="wallet-title" data-idx="${i}" value="${t.title || ''}" style="width:140px" /></td>
      <td><input class="wallet-pay" type="number" min="1" step="1" data-idx="${i}" value="${Number(t.payAmount) || 0}" style="width:88px" /></td>
      <td><input class="wallet-bonus" type="number" min="0" step="1" data-idx="${i}" value="${Number(t.bonus) || 0}" style="width:88px" /></td>
      <td>¥${(Number(t.payAmount || 0) + Number(t.bonus || 0)).toFixed(0)}</td>
      <td><label class="switch"><input type="checkbox" class="wallet-on" data-idx="${i}" ${t.enabled !== false ? 'checked' : ''} /> <span></span></label></td>
      <td><button type="button" class="btn sm wallet-del" data-idx="${i}">删</button></td>
    </tr>`
    )
    .join('');
  $('#walletTierTable').innerHTML = `
    <table class="table">
      <thead><tr><th>标题</th><th>实付本金</th><th>赠金</th><th>到账</th><th>启用</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" class="muted">暂无档位</td></tr>'}</tbody>
    </table>`;
  document.querySelectorAll('.wallet-del').forEach((btn) => {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.idx);
      state.walletTiers.splice(i, 1);
      renderWalletTiers();
    });
  });
}

async function saveWallet() {
  try {
    const tiers = (state.walletTiers || []).map((t, i) => {
      const title = document.querySelector(`.wallet-title[data-idx="${i}"]`)?.value || t.title;
      const payAmount = Number(document.querySelector(`.wallet-pay[data-idx="${i}"]`)?.value);
      const bonus = Number(document.querySelector(`.wallet-bonus[data-idx="${i}"]`)?.value);
      const enabled = !!document.querySelector(`.wallet-on[data-idx="${i}"]`)?.checked;
      return {
        id: t.id || `t${Math.round(payAmount)}`,
        title: String(title || '').trim() || `充${payAmount}送${bonus}`,
        payAmount,
        bonus,
        enabled,
      };
    });
    await api('/api/admin/wallet', {
      method: 'PUT',
      body: JSON.stringify({
        enabled: $('#walletEnabled')?.checked,
        tiers,
      }),
    });
    toast('储值配置已保存');
    await loadWallet();
  } catch (e) {
    toast(e.message || '保存失败');
  }
}

async function grantCouponsToSegment() {
  const segment = $('#userSegment').value;
  const activeDays = Number($('#activeDaysInput').value || 14);
  const amount = Number($('#grantAmount').value);
  const threshold = Number($('#grantThreshold').value || 0);
  const count = Number($('#grantCount').value || 1);
  const title = ($('#grantTitle').value || '').trim();
  const fulfillment = $('#grantFulfillment').value;
  if (!(amount > 0)) return toast('请填写面额');
  const label =
    segment === 'active' ? '活跃用户' : segment === 'inactive' ? '不活跃用户' : '全部用户';
  if (!confirm(`确认给「${label}」每人发 ${count} 张券（¥${amount}${threshold > 0 ? ` / 满${threshold}` : ' 无门槛'}）？`)) {
    return;
  }
  try {
    const res = await api('/api/admin/coupons/grant', {
      method: 'POST',
      body: JSON.stringify({ segment, activeDays, amount, threshold, count, title, fulfillment }),
    });
    toast(`已发 ${res.granted} 张券 → ${res.userCount} 人（小程序券包）`);
    await loadUsers();
  } catch (e) {
    toast(e.message || '发券失败');
  }
}

function ymdLocal(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function reportGroupBy() {
  const el = document.querySelector('input[name="reportGroup"]:checked');
  return el?.value === 'month' ? 'month' : 'day';
}

function ymLocal(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function setReportDefaultRange() {
  const to = ymdLocal();
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 6);
  const from = ymdLocal(fromDate);
  if ($('#reportFrom') && !$('#reportFrom').value) $('#reportFrom').value = from;
  if ($('#reportTo') && !$('#reportTo').value) $('#reportTo').value = to;
  if ($('#reportMonth') && !$('#reportMonth').value) $('#reportMonth').value = ymLocal();
}

function payLabel(k) {
  return { wechat: '微信', balance: '余额', other: '其他' }[k] || k;
}

function reportDetailHtml(row, key, openKey) {
  const expanded = key === openKey;
  const payRows = ['wechat', 'balance', 'other']
    .map((k) => {
      const ch = row.byPayChannel?.[k] || { revenue: 0, orderCount: 0 };
      if (!ch.orderCount && !ch.revenue) return '';
      return `<tr><td>${payLabel(k)}</td><td>${ch.orderCount}</td><td>¥${Number(ch.revenue).toFixed(2)}</td></tr>`;
    })
    .join('');
  const prodRows = (row.byProduct || [])
    .map(
      (p) =>
        `<tr><td>${p.productName}</td><td>${p.quantity}</td><td>¥${Number(p.revenue).toFixed(2)}</td></tr>`
    )
    .join('');
  return `
    <div class="report-day" data-key="${key}">
      <button type="button" class="report-day-head" data-key="${key}">
        <span class="date">${key}</span>
        <span>¥${Number(row.revenue).toFixed(2)}</span>
        <span class="muted">${row.orderCount} 单</span>
        <span class="muted">${expanded ? '收起' : '明细'}</span>
      </button>
      <div class="report-day-body ${expanded ? '' : 'hidden'}">
        <div class="report-sub">
          <div>
            <h4>支付方式</h4>
            <table><thead><tr><th>渠道</th><th>单数</th><th>金额</th></tr></thead><tbody>
              ${payRows || '<tr><td colspan="3" class="muted">无</td></tr>'}
            </tbody></table>
          </div>
          <div>
            <h4>商品</h4>
            <table><thead><tr><th>品名</th><th>销量</th><th>金额</th></tr></thead><tbody>
              ${prodRows || '<tr><td colspan="3" class="muted">无</td></tr>'}
            </tbody></table>
          </div>
        </div>
      </div>
    </div>`;
}

async function loadSalesReport() {
  setReportDefaultRange();
  const groupBy = reportGroupBy();
  const q = new URLSearchParams();
  q.set('groupBy', groupBy);
  if (groupBy === 'month' && $('#reportMonth')?.value) {
    q.set('month', $('#reportMonth').value);
  } else {
    const from = $('#reportFrom')?.value || '';
    const to = $('#reportTo')?.value || '';
    if (from) q.set('from', from);
    if (to) q.set('to', to);
  }
  const data = await api(`/api/admin/reports/sales?${q}`);
  const s = data.summary || {};
  const ch = s.byPayChannel || {};
  $('#reportSummary').innerHTML = `
    <div class="stat"><div class="n">¥${Number(s.revenue || 0).toFixed(2)}</div><div class="l">${groupBy === 'month' ? '月度' : '区间'}营收</div></div>
    <div class="stat"><div class="n">${s.orderCount || 0}</div><div class="l">订单数</div></div>
    <div class="stat"><div class="n">¥${Number(ch.wechat?.revenue || 0).toFixed(2)}</div><div class="l">微信</div></div>
    <div class="stat"><div class="n">¥${Number(ch.balance?.revenue || 0).toFixed(2)}</div><div class="l">余额</div></div>
  `;
  const rows =
    groupBy === 'month'
      ? (data.months || []).map((m) => ({ ...m, _key: m.month }))
      : (data.days || []).map((d) => ({ ...d, _key: d.date }));
  if (!rows.length) {
    $('#reportDays').innerHTML = '<p class="muted">该区间暂无已支付订单</p>';
    return;
  }
  if (state.reportOpenKey === undefined) state.reportOpenKey = rows[0]?._key || '';
  $('#reportDays').innerHTML = rows
    .map((row) => reportDetailHtml(row, row._key, state.reportOpenKey))
    .join('');
}

function parseItemsText(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/[,，\t]/).map((x) => x.trim());
      return {
        name: parts[0] || '商品',
        qty: Number(parts[1]) || 1,
        unit: parts[2] || '',
        amount: Number(parts[3]) || 0,
      };
    });
}

function itemsToText(items) {
  if (!Array.isArray(items) || !items.length) return '';
  return items
    .map((it) => [it.name || '', it.qty ?? 1, it.unit || '', it.amount ?? 0].join(','))
    .join('\n');
}

function resetPurchaseEditor(draft = null) {
  state.purchaseDraft = draft
    ? { ...draft }
    : {
        id: null,
        date: ymdLocal(),
        supplier: '',
        taxNo: '',
        invoiceNo: '',
        amount: 0,
        taxAmount: 0,
        items: [],
        note: '',
        invoiceUrl: '',
        source: 'manual',
        ocrRaw: null,
      };
  const d = state.purchaseDraft;
  $('#pu_date').value = d.date || '';
  $('#pu_supplier').value = d.supplier || '';
  $('#pu_taxNo').value = d.taxNo || '';
  $('#pu_invoiceNo').value = d.invoiceNo || '';
  $('#pu_amount').value = d.amount != null ? d.amount : '';
  $('#pu_taxAmount').value = d.taxAmount != null ? d.taxAmount : '';
  $('#pu_note').value = d.note || '';
  $('#pu_items').value = itemsToText(d.items);
  const prev = $('#pu_invoicePreview');
  if (d.invoiceUrl) {
    const isImg = /\.(png|jpe?g|gif|webp)$/i.test(d.invoiceUrl);
    prev.innerHTML = isImg
      ? `<div>发票原图</div><a href="${d.invoiceUrl}" target="_blank" rel="noopener"><img src="${d.invoiceUrl}" alt="发票" /></a>`
      : `<a href="${d.invoiceUrl}" target="_blank" rel="noopener">查看发票文件</a>`;
  } else {
    prev.innerHTML = '';
  }
  $('#purchaseEditorTitle').textContent = d.id ? '编辑进货单' : d.source === 'invoice' ? '发票预填（可改）' : '手动新增';
  $('#purchaseOcrHint').textContent = d.ocrMessage || '';
  $('#purchaseEditor').classList.remove('hidden');
}

function hidePurchaseEditor() {
  $('#purchaseEditor')?.classList.add('hidden');
  state.purchaseDraft = null;
}

function readPurchaseForm() {
  const d = state.purchaseDraft || {};
  return {
    id: d.id || undefined,
    date: $('#pu_date').value,
    supplier: $('#pu_supplier').value.trim(),
    taxNo: $('#pu_taxNo').value.trim(),
    invoiceNo: $('#pu_invoiceNo').value.trim(),
    amount: Number($('#pu_amount').value) || 0,
    taxAmount: Number($('#pu_taxAmount').value) || 0,
    note: $('#pu_note').value.trim(),
    items: parseItemsText($('#pu_items').value),
    invoiceUrl: d.invoiceUrl || '',
    source: d.source || 'manual',
    ocrRaw: d.ocrRaw || null,
  };
}

async function loadPurchases() {
  const data = await api('/api/admin/purchases');
  const list = data.list || [];
  if (!list.length) {
    $('#purchaseList').innerHTML = '<p class="muted">暂无进货记录</p>';
    return;
  }
  $('#purchaseList').innerHTML = `
    <table>
      <thead><tr><th>日期</th><th>供应商</th><th>金额</th><th>发票</th><th>来源</th><th></th></tr></thead>
      <tbody>
        ${list
          .map(
            (p) => `
          <tr>
            <td>${p.date || '—'}</td>
            <td>${p.supplier || '—'}</td>
            <td>¥${Number(p.amount || 0).toFixed(2)}</td>
            <td>${
              p.invoiceUrl
                ? `<a href="${p.invoiceUrl}" target="_blank" rel="noopener">查看</a>`
                : '无'
            }</td>
            <td>${p.source === 'invoice' ? '发票' : '手动'}</td>
            <td>
              <button type="button" class="btn sm purchase-edit" data-id="${p.id}">改</button>
              <button type="button" class="btn sm purchase-del" data-id="${p.id}">删</button>
            </td>
          </tr>`
          )
          .join('')}
      </tbody>
    </table>`;
  state.purchases = list;
}

async function savePurchase() {
  const body = readPurchaseForm();
  if (!body.date && !body.supplier && !body.amount) {
    toast('请至少填写日期、供应商或金额');
    return;
  }
  try {
    if (body.id) {
      await api(`/api/admin/purchases/${encodeURIComponent(body.id)}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
    } else {
      await api('/api/admin/purchases', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    }
    toast('已保存');
    hidePurchaseEditor();
    await loadPurchases();
  } catch (e) {
    toast(e.message || '保存失败');
  }
}

async function onPurchaseInvoicePicked(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    toast('正在上传识别…');
    const res = await fetch(`${API}/api/admin/purchases/invoice-upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${state.token}`,
        'Content-Type': file.type || 'image/jpeg',
      },
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '上传失败');
    const draft = {
      ...(data.draft || {}),
      id: null,
      invoiceUrl: data.url || data.draft?.invoiceUrl || '',
      source: 'invoice',
      ocrRaw: data.ocrRaw || null,
      ocrMessage: data.draft?.ocrMessage
        || (data.ocrConfigured === false ? '未配置 OCR，请手动填写后保存' : ''),
    };
    resetPurchaseEditor(draft);
    toast(draft.ocrOk === false ? (draft.ocrMessage || '识别未成功，请手填') : '已预填，请核对后保存');
  } catch (err) {
    toast(err.message || '上传失败');
  }
}

async function refresh() {
  if (!state.token) return;
  try {
    if (state.tab === 'dashboard') await loadStats();
    if (state.tab === 'orders') await loadOrders();
    if (state.tab === 'products') await loadProducts();
    if (state.tab === 'toppings') await loadToppings();
    if (state.tab === 'sidemeal') await loadSideMeal();
    if (state.tab === 'delivery') await loadDelivery();
    if (state.tab === 'reserve') await loadReserveCategories();
    if (state.tab === 'users') await loadUsers();
    if (state.tab === 'coupons') await loadCouponUsers();
    if (state.tab === 'lottery') await loadLottery();
    if (state.tab === 'wallet') await loadWallet();
    if (state.tab === 'reports') await loadSalesReport();
    if (state.tab === 'purchases') await loadPurchases();
    if (state.tab === 'hardware' && window.DetongPrint?.loadRetailMixLabels) {
      await window.DetongPrint.loadRetailMixLabels();
    }
  } catch (e) {
    if (String(e.message).includes('登录') || String(e.message).includes('过期') || String(e.message).includes('权限')) logout();
    else console.error(e);
  }
}

$('#autoPrint').checked = localStorage.getItem('sg_auto_print') !== '0';
$('#soundOn').checked = localStorage.getItem('sg_sound') !== '0';
$('#autoPrint').addEventListener('change', () => {
  localStorage.setItem('sg_auto_print', $('#autoPrint').checked ? '1' : '0');
});
$('#soundOn').addEventListener('change', () => {
  localStorage.setItem('sg_sound', $('#soundOn').checked ? '1' : '0');
  if ($('#soundOn').checked) {
    unlockAudio();
    speakText('来单会读出单子名称');
    toast('新单会语音播报品名和小料');
  }
});
document.addEventListener('click', unlockAudio);
document.addEventListener('keydown', unlockAudio);
if (window.speechSynthesis) {
  speechSynthesis.getVoices();
  speechSynthesis.addEventListener('voiceschanged', () => speechSynthesis.getVoices());
}

$('#loginBtn').addEventListener('click', login);
$('#logoutBtn')?.addEventListener('click', logout);
$('#logoutBtnMobile')?.addEventListener('click', logout);
$('#refreshBtn').addEventListener('click', refresh);
$('#statusFilter').addEventListener('change', loadOrders);
$('#verifyBtn').addEventListener('click', verify);
$('#saveDeliveryBtn')?.addEventListener('click', saveDelivery);
$('#saveReserveBtn')?.addEventListener('click', () => saveReserveCategories());
$('#reloadReserveBtn')?.addEventListener('click', () =>
  loadReserveCategories().catch((e) => toast(e.message))
);
$('#reserveCategoryList')?.addEventListener('change', (e) => {
  if (!e.target.classList?.contains('reserve-cat-check')) return;
  const row = e.target.closest('.reserve-cat-row');
  const tip = row?.querySelector('.muted');
  if (tip) tip.textContent = e.target.checked ? '可预定' : '仅现取';
});
$('#reloadUsersBtn')?.addEventListener('click', () => {
  state.userPage = 1;
  loadUsers().catch((e) => toast(e.message));
});
$('#searchUsersBtn')?.addEventListener('click', () => {
  state.userPage = 1;
  loadUsers().catch((e) => toast(e.message));
});
$('#userSearch')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    state.userPage = 1;
    loadUsers().catch((err) => toast(err.message));
  }
});
$('#userPageSize')?.addEventListener('change', () => {
  state.userPage = 1;
  loadUsers().catch((e) => toast(e.message));
});
$('#reloadCouponUsersBtn')?.addEventListener('click', () =>
  loadCouponUsers().catch((e) => toast(e.message))
);
$('#userTable')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.user-edit');
  if (!btn) return;
  openUserEditor(btn.dataset.id).catch((err) => toast(err.message));
});
$('#saveUserBtn')?.addEventListener('click', (e) => {
  e.preventDefault();
  saveUserProfile();
});
$('#adjustBalanceBtn')?.addEventListener('click', (e) => {
  e.preventDefault();
  adjustUserBalance();
});
$('#grantCouponsBtn')?.addEventListener('click', grantCouponsToSegment);
$('#saveOff153Btn')?.addEventListener('click', saveOff153Scope);
$('#presetOff153Btn')?.addEventListener('click', presetOff153Grant);
$('#saveLotteryBtn')?.addEventListener('click', saveLottery);
$('#reloadLotteryBtn')?.addEventListener('click', () => loadLottery().catch((e) => toast(e.message)));
$('#saveWalletBtn')?.addEventListener('click', saveWallet);
$('#reloadWalletBtn')?.addEventListener('click', () => loadWallet().catch((e) => toast(e.message)));
$('#addWalletTierBtn')?.addEventListener('click', () => {
  if (!state.walletTiers) state.walletTiers = [];
  state.walletTiers.push({
    id: `t${Date.now()}`,
    title: '新档位',
    payAmount: 100,
    bonus: 0,
    enabled: true,
  });
  renderWalletTiers();
});
$('#loadReportBtn')?.addEventListener('click', () => loadSalesReport().catch((e) => toast(e.message)));
$('#reportLast7Btn')?.addEventListener('click', () => {
  const dayRadio = document.querySelector('input[name="reportGroup"][value="day"]');
  if (dayRadio) dayRadio.checked = true;
  const to = ymdLocal();
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 6);
  if ($('#reportFrom')) $('#reportFrom').value = ymdLocal(fromDate);
  if ($('#reportTo')) $('#reportTo').value = to;
  state.reportOpenKey = undefined;
  loadSalesReport().catch((e) => toast(e.message));
});
$('#reportThisMonthBtn')?.addEventListener('click', () => {
  const monthRadio = document.querySelector('input[name="reportGroup"][value="month"]');
  if (monthRadio) monthRadio.checked = true;
  if ($('#reportMonth')) $('#reportMonth').value = ymLocal();
  state.reportOpenKey = undefined;
  loadSalesReport().catch((e) => toast(e.message));
});
$('#reportLast6MonthsBtn')?.addEventListener('click', () => {
  const monthRadio = document.querySelector('input[name="reportGroup"][value="month"]');
  if (monthRadio) monthRadio.checked = true;
  if ($('#reportMonth')) $('#reportMonth').value = '';
  const to = ymdLocal();
  const fromDate = new Date();
  fromDate.setMonth(fromDate.getMonth() - 5);
  fromDate.setDate(1);
  if ($('#reportFrom')) $('#reportFrom').value = ymdLocal(fromDate);
  if ($('#reportTo')) $('#reportTo').value = to;
  state.reportOpenKey = undefined;
  loadSalesReport().catch((e) => toast(e.message));
});
document.querySelectorAll('input[name="reportGroup"]').forEach((el) => {
  el.addEventListener('change', () => {
    state.reportOpenKey = undefined;
    loadSalesReport().catch((e) => toast(e.message));
  });
});
$('#reportDays')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.report-day-head');
  if (!btn) return;
  const key = btn.dataset.key;
  state.reportOpenKey = state.reportOpenKey === key ? '' : key;
  loadSalesReport().catch((err) => toast(err.message));
});
$('#purchaseManualBtn')?.addEventListener('click', () => resetPurchaseEditor(null));
$('#purchaseInvoiceBtn')?.addEventListener('click', () => $('#purchaseInvoiceFile')?.click());
$('#purchaseInvoiceFile')?.addEventListener('change', onPurchaseInvoicePicked);
$('#reloadPurchasesBtn')?.addEventListener('click', () => loadPurchases().catch((e) => toast(e.message)));
$('#savePurchaseBtn')?.addEventListener('click', () => savePurchase());
$('#cancelPurchaseBtn')?.addEventListener('click', hidePurchaseEditor);
$('#purchaseList')?.addEventListener('click', async (e) => {
  const editBtn = e.target.closest('.purchase-edit');
  const delBtn = e.target.closest('.purchase-del');
  if (editBtn) {
    const p = (state.purchases || []).find((x) => x.id === editBtn.dataset.id);
    if (p) resetPurchaseEditor(p);
    return;
  }
  if (delBtn) {
    if (!confirm('确认删除这条进货记录？')) return;
    try {
      await api(`/api/admin/purchases/${encodeURIComponent(delBtn.dataset.id)}`, { method: 'DELETE' });
      toast('已删除');
      await loadPurchases();
    } catch (err) {
      toast(err.message || '删除失败');
    }
  }
});
$('#userSegment')?.addEventListener('change', () => loadCouponUsers().catch((e) => toast(e.message)));
$('#activeDaysInput')?.addEventListener('change', () => loadCouponUsers().catch((e) => toast(e.message)));
$('#addProductBtn').addEventListener('click', () => editProduct(null));
$('#productCatTabs')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.cat-tab');
  if (!btn) return;
  setProductCat(btn.dataset.cat || '');
});
$('#addSpecBtn')?.addEventListener('click', () => addSpecRow({ name: '', price: '', stock: 999 }));
$('#saveProductBtn').addEventListener('click', saveProduct);
$('#addToppingBtn')?.addEventListener('click', () => {
  if (!Array.isArray(state.toppings)) state.toppings = [];
  state.toppings.push({
    id: '',
    name: '',
    spec: '一份',
    price: 0,
    status: 1,
    createdAt: Date.now(),
  });
  renderToppingsEditor();
});
$('#saveToppingsBtn')?.addEventListener('click', saveToppings);
$('#reloadToppingsBtn')?.addEventListener('click', () => loadToppings().catch((e) => toast(e.message)));
$('#saveProductOrderBtn')?.addEventListener('click', () => saveCurrentProductOrder().catch((e) => toast(e.message)));
$('#previewSalesOrderBtn')?.addEventListener('click', () => previewCurrentCatBySales());
$('#resetSalesOrderBtn')?.addEventListener('click', () =>
  resetCurrentProductOrderToSales().catch((e) => toast(e.message))
);
$('#selectAllProductsBtn')?.addEventListener('click', () => {
  $$('#productTable .product-check').forEach((box) => {
    box.checked = true;
    const card = box.closest('.product-card');
    if (card) card.classList.add('selected');
  });
  updateProductSelectionHint();
});
$('#clearProductSelectionBtn')?.addEventListener('click', () => {
  $$('#productTable .product-check').forEach((box) => {
    box.checked = false;
    const card = box.closest('.product-card');
    if (card) card.classList.remove('selected');
  });
  updateProductSelectionHint();
});
$('#batchOnProductsBtn')?.addEventListener('click', () =>
  batchSetProductStatus(1).catch((e) => toast(e.message || '批量上架失败'))
);
$('#batchOffProductsBtn')?.addEventListener('click', () =>
  batchSetProductStatus(0).catch((e) => toast(e.message || '批量下架失败'))
);
$('#addSmProteinBtn')?.addEventListener('click', () => {
  if (!state.sideMeal) state.sideMeal = { proteins: [], carbs: [] };
  if (!Array.isArray(state.sideMeal.proteins)) state.sideMeal.proteins = [];
  // flush editor into state first
  state.sideMeal = readSideMealFromEditor();
  state.sideMeal.proteins.push({
    id: `protein-${Date.now().toString(36)}`,
    name: '',
    weight: '100g',
    tag: '',
    recommend: false,
    proteinG: null,
    carbG: null,
    price: 12.9,
    originalPrice: 15.9,
    enabled: true,
  });
  renderSideMealEditor();
});
$('#addSmCarbBtn')?.addEventListener('click', () => {
  if (!state.sideMeal) state.sideMeal = { proteins: [], carbs: [] };
  state.sideMeal = readSideMealFromEditor();
  if (!Array.isArray(state.sideMeal.carbs)) state.sideMeal.carbs = [];
  state.sideMeal.carbs.push({
    id: `carb-${Date.now().toString(36)}`,
    name: '',
    weight: '100g',
    enabled: true,
  });
  renderSideMealEditor();
});
$('#saveSideMealBtn')?.addEventListener('click', () => saveSideMeal());
$('#reloadSideMealBtn')?.addEventListener('click', () => loadSideMeal().catch((e) => toast(e.message)));
// 总开关立即落库，避免只勾选不点「保存」导致小程序仍关着
$('#sm_enabled')?.addEventListener('change', () => {
  saveSideMeal({ quiet: true });
});
function bumpDashSideMealStock(delta) {
  const un = $('#dash_sm_unlimited');
  if (un) un.checked = false;
  const stockEl = $('#dash_sm_stock');
  if (!stockEl) return;
  stockEl.disabled = false;
  const cur = Math.max(0, Math.floor(Number(stockEl.value) || 0));
  const next = Math.max(0, cur + delta);
  stockEl.value = String(next);
  saveSideMealStockOnly(next, { quiet: true }).catch((e) => toast(e.message || '更新失败'));
}
$('#dashSmStockAdd5')?.addEventListener('click', () => bumpDashSideMealStock(5));
$('#dashSmStockAdd10')?.addEventListener('click', () => bumpDashSideMealStock(10));
$('#dashSmStockZero')?.addEventListener('click', () => {
  const un = $('#dash_sm_unlimited');
  if (un) un.checked = false;
  const stockEl = $('#dash_sm_stock');
  if (stockEl) {
    stockEl.disabled = false;
    stockEl.value = '0';
  }
  saveSideMealStockOnly(0, { quiet: true }).catch((e) => toast(e.message || '更新失败'));
});
$('#dash_sm_unlimited')?.addEventListener('change', () => {
  const un = !!$('#dash_sm_unlimited')?.checked;
  const stockEl = $('#dash_sm_stock');
  if (un) {
    if (stockEl) {
      stockEl.disabled = true;
      stockEl.value = '';
    }
    saveSideMealStockOnly(null, { quiet: true }).catch((e) => toast(e.message || '更新失败'));
    return;
  }
  if (stockEl) {
    stockEl.disabled = false;
    if (stockEl.value === '') stockEl.value = '20';
    saveSideMealStockOnly(stockEl.value, { quiet: true }).catch((e) => toast(e.message || '更新失败'));
  }
});
$('#dash_sm_stock')?.addEventListener('change', () => {
  if ($('#dash_sm_unlimited')?.checked) return;
  saveSideMealStockOnly($('#dash_sm_stock')?.value, { quiet: true }).catch((e) =>
    toast(e.message || '更新失败')
  );
});
$('#pickCoverBtn')?.addEventListener('click', (e) => {
  e.preventDefault();
  showCoverGallery();
});
$('#uploadCoverBtn')?.addEventListener('click', (e) => {
  e.preventDefault();
  $('#p_cover_file').click();
});
$('#p_cover_file')?.addEventListener('change', onCoverFilePicked);
$('#p_cover')?.addEventListener('input', () => setCoverPreview($('#p_cover').value));
$$('.side-nav [data-tab], .bottom-nav [data-tab], #openHardwareBtn').forEach((b) => {
  b.addEventListener('click', (e) => {
    e.preventDefault();
    if (!b.dataset.tab) return;
    switchTab(b.dataset.tab);
  });
});

$('#batchMakingBtn')?.addEventListener('click', () => batchSetStatus('making'));
$('#batchReadyBtn')?.addEventListener('click', () => batchSetStatus('ready'));
$('#phoneVideoInput')?.addEventListener('change', onPhoneVideoPicked);
$('#selectAllPending')?.addEventListener('change', (e) => {
  $$('.order-check').forEach((c) => {
    c.checked = e.target.checked;
  });
  updateBatchHint();
});
document.addEventListener('change', (e) => {
  if (e.target.classList?.contains('order-check')) updateBatchHint();
});

if (state.token) {
  showMain(true);
  switchTab('dashboard');
} else {
  showMain(false);
}

setInterval(() => {
  if (state.token && (state.tab === 'dashboard' || state.tab === 'orders')) refresh();
}, 5000);
