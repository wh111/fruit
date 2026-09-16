const API = '';
const state = {
  token: localStorage.getItem('sg_admin_token') || '',
  tab: 'dashboard',
  knownPaidIds: new Set(JSON.parse(localStorage.getItem('sg_known_paid') || '[]')),
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
    delivery: '配送费',
    verify: '扫码核销',
    hardware: '打印硬件',
  };
  $('#pageTitle').textContent = titles[tab] || '';
  window.scrollTo(0, 0);
  refresh();
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 4000);
}

function playBeep() {
  if (!$('#soundOn').checked) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = 880;
    g.gain.value = 0.08;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    setTimeout(() => {
      o.frequency.value = 1175;
    }, 120);
    setTimeout(() => {
      o.stop();
      ctx.close();
    }, 320);
  } catch {
    /* ignore */
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
  playBeep();
  toast(`新订单 ${fresh.map((o) => o.pickupCode).join('、')} · ${fresh[0].productName}`);

  if ($('#autoPrint').checked) {
    for (const o of fresh) {
      await printLabel(o.id);
      await new Promise((r) => setTimeout(r, 600));
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
  `;
  const { list } = await api('/api/admin/orders');
  await watchNewOrders(list);
  const pending = sortDeskOrders(list.filter((o) => ['paid', 'making', 'ready'].includes(o.status)));
  const newest = pending[0]?.id;
  $('#pendingList').innerHTML = pending.length
    ? pending
        .map((o) => {
          const canBatch = ['paid', 'making'].includes(o.status);
          const batchNote =
            o.makeBatchCodes && o.makeBatchCodes.length > 1
              ? `<div class="batch-codes">同批：${o.makeBatchCodes.join('、')}</div>`
              : '';
          return `
      <div class="order-card ${o.id === newest ? 'new' : ''}">
        <label class="pick">${
          canBatch ? `<input type="checkbox" class="order-check" value="${o.id}" data-code="${o.pickupCode || ''}" />` : '<span></span>'
        }</label>
        <div class="pickup">${o.pickupCode || '--'}</div>
        <div class="order-main">
          <div class="order-title">${o.productName} · ${o.specName} ×${o.quantity}</div>
          <div class="muted">${STATUS_TEXT[o.status]} · ${fulfillmentNote(o)} · ${amountNote(o)}${o.printed ? ' · 已打标' : ''}</div>
          ${batchNote}
        </div>
        <div class="actions">
          <button type="button" class="btn sm green" onclick="printLabel('${o.id}')">打印标签</button>
          <button type="button" class="btn sm" onclick="cloudPrint('${o.id}')">云打印</button>
          <button type="button" class="btn sm" onclick="setStatus('${o.id}','making')">制作中</button>
          <button type="button" class="btn sm" onclick="setStatus('${o.id}','ready')">${
            o.deliveryPoint && o.deliveryPoint !== 'shop' ? '已投柜' : '待取'
          }</button>
          <button type="button" class="btn sm primary" onclick="setStatus('${o.id}','done')">完成</button>
        </div>
      </div>`;
        })
        .join('')
    : '<p class="muted">暂无待制作订单</p>';
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
  const labels = { making: '开始制作', ready: '待取餐', done: '完成' };
  try {
    const data = await api('/api/orders/batch-status', {
      method: 'POST',
      body: JSON.stringify({ ids, status }),
    });
    toast(data.tip || `已${labels[status] || '更新'} ${data.count} 单`);
    const sel = $('#selectAllPending');
    if (sel) sel.checked = false;
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
        <div><strong>${o.productName}</strong> · ${o.specName} ×${o.quantity}</div>
        <div class="meta">${fulfillmentNote(o)} · ${amountNote(o)} · ${ts}${o.printed ? ' · 已打标' : ''}</div>
        <div class="actions">
          ${o.pickupCode ? `<button type="button" class="btn sm green" onclick="printLabel('${o.id}')">打印标签</button>` : ''}
                ${['paid', 'making'].includes(o.status) ? `<button type="button" class="btn sm" onclick="setStatus('${o.id}','ready')">${
                  o.deliveryPoint && o.deliveryPoint !== 'shop' ? '已投柜' : '待取'
                }</button>` : ''}
                ${['paid', 'making', 'ready'].includes(o.status) ? `<button type="button" class="btn sm primary" onclick="setStatus('${o.id}','done')">完成</button>` : ''}
          ${o.pickupCode ? `<button type="button" class="btn sm" onclick="cloudPrint('${o.id}')">云打印</button>` : ''}
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

async function loadProducts() {
  const { list } = await api('/api/admin/products');
  if (!list.length) {
    $('#productTable').innerHTML = '<p class="muted" style="padding:16px">暂无商品</p>';
    return;
  }
  $('#productTable').innerHTML = list
    .map((p) => {
      const specs = (p.specs || []).map((s) => `${s.name}¥${s.price}`).join(' / ');
      const thumb = p.cover
        ? `<img class="product-thumb" src="${mediaSrc(p.cover)}" alt="" />`
        : '<div class="product-thumb"></div>';
      return `<div class="product-card">
        ${thumb}
        <div class="info">
          <div><strong>${p.name}</strong> · ${p.status === 1 ? '上架' : '下架'}</div>
          <div class="muted">${p.category} · ${specs}</div>
          ${p.desc ? `<div class="muted">${p.desc}</div>` : ''}
          <div class="actions">
            <button type="button" class="btn sm" data-edit='${JSON.stringify(p).replace(/'/g, '&#39;')}' onclick="editProduct(JSON.parse(this.dataset.edit))">编辑</button>
            ${p.status === 1 ? `<button type="button" class="btn sm" onclick="offProduct('${p.id}')">下架</button>` : ''}
          </div>
        </div>
      </div>`;
    })
    .join('');
}

window.editProduct = function editProduct(p) {
  $('#productDialogTitle').textContent = p?.id ? '编辑商品' : '新增商品';
  $('#p_id').value = p?.id || '';
  $('#p_name').value = p?.name || '';
  $('#p_category').value = p?.category || '果切系列';
  $('#p_desc').value = p?.desc || '';
  setCoverPreview(p?.cover || '');
  $('#coverGallery').classList.add('hidden');
  $('#coverGallery').innerHTML = '';
  $('#p_specs').value = JSON.stringify(
    p?.specs || [{ id: 'std', name: '标准', price: 15, stock: 999 }],
    null,
    2
  );
  $('#p_extras').value = JSON.stringify(p?.extras || [], null, 2);
  $('#productDialog').showModal();
};

async function saveProduct(e) {
  e.preventDefault();
  const id = $('#p_id').value;
  let specs, extras;
  try {
    specs = JSON.parse($('#p_specs').value || '[]');
    extras = JSON.parse($('#p_extras').value || '[]');
  } catch {
    alert('规格/加料 JSON 格式错误');
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
  loadProducts();
};

window.setStatus = async function setStatus(id, status) {
  await api(`/api/orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
  refresh();
};

window.printLabel = async function printLabel(orderId) {
  const data = await api(`/api/print/label/${orderId}`);
  const w = window.open('', '_blank', 'width=420,height=320');
  if (!w) {
    toast('浏览器拦截了弹窗，请允许后重试');
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

window.cloudPrint = async function cloudPrint(orderId) {
  try {
    await api('/api/print/cloud', { method: 'POST', body: JSON.stringify({ orderId }) });
    toast('已发送到云打印机');
    refresh();
  } catch (e) {
    toast(e.message || '云打印失败');
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
    $('#verifyResult').textContent = `核销成功\n取餐码 ${data.order.pickupCode}\n${data.order.productName} · ${data.order.specName}\n¥${data.order.amount}`;
    $('#verifyInput').value = '';
    refresh();
  } catch (e) {
    $('#verifyResult').textContent = e.message;
  }
}

async function loadDelivery() {
  const { points } = await api('/api/admin/delivery');
  const box = $('#deliveryList');
  if (!box) return;
  box.innerHTML = (points || [])
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
    .join('');
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

async function refresh() {
  if (!state.token) return;
  try {
    if (state.tab === 'dashboard') await loadStats();
    if (state.tab === 'orders') await loadOrders();
    if (state.tab === 'products') await loadProducts();
    if (state.tab === 'delivery') await loadDelivery();
  } catch (e) {
    if (String(e.message).includes('登录') || String(e.message).includes('过期') || String(e.message).includes('权限')) logout();
    else console.error(e);
  }
}

$('#autoPrint').checked = localStorage.getItem('sg_auto_print') === '1';
$('#soundOn').checked = localStorage.getItem('sg_sound') !== '0';
$('#autoPrint').addEventListener('change', () => {
  localStorage.setItem('sg_auto_print', $('#autoPrint').checked ? '1' : '0');
});
$('#soundOn').addEventListener('change', () => {
  localStorage.setItem('sg_sound', $('#soundOn').checked ? '1' : '0');
});

$('#loginBtn').addEventListener('click', login);
$('#logoutBtn')?.addEventListener('click', logout);
$('#logoutBtnMobile')?.addEventListener('click', logout);
$('#refreshBtn').addEventListener('click', refresh);
$('#statusFilter').addEventListener('change', loadOrders);
$('#verifyBtn').addEventListener('click', verify);
$('#saveDeliveryBtn')?.addEventListener('click', saveDelivery);
$('#addProductBtn').addEventListener('click', () => editProduct(null));
$('#saveProductBtn').addEventListener('click', saveProduct);
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
$('#batchDoneBtn')?.addEventListener('click', () => batchSetStatus('done'));
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
