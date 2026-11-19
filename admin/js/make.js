const API = '';
const state = {
  token: localStorage.getItem('sg_make_token') || '',
  stream: null,
  recorder: null,
  chunks: [],
  makeBatchId: '',
  recording: false,
  uploading: false,
  toppings: [],
  selectedToppingIds: new Set(),
  ordersCache: [],
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const STATUS = { paid: '待制作', making: '制作中', ready: '待取餐', done: '已完成' };

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(`${API}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

function setBadge(mode) {
  const el = $('#recBadge');
  el.className = 'badge';
  if (mode === 'rec') {
    el.classList.add('on');
    el.textContent = '录像中';
  } else if (mode === 'up') {
    el.classList.add('up');
    el.textContent = '上传中';
  } else {
    el.textContent = '未录像';
  }
}

function showMain(ok) {
  $('#login').classList.toggle('hidden', ok);
  $('#main').classList.toggle('hidden', !ok);
}

async function login() {
  $('#loginErr').textContent = '';
  try {
    const data = await api('/api/auth/admin/login', {
      method: 'POST',
      body: JSON.stringify({
        username: $('#user').value.trim(),
        password: $('#pass').value,
      }),
    });
    state.token = data.token;
    localStorage.setItem('sg_make_token', data.token);
    showMain(true);
    await loadToppings();
    await startCamera();
    await refreshList();
  } catch (e) {
    $('#loginErr').textContent = e.message;
  }
}

function logout() {
  stopRecorder(false);
  stopCamera();
  state.token = '';
  localStorage.removeItem('sg_make_token');
  showMain(false);
}

async function startCamera() {
  try {
    stopCamera();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
    state.stream = stream;
    const v = $('#preview');
    v.srcObject = stream;
    await v.play().catch(() => {});
  } catch (e) {
    $('#statusText').textContent = '无法打开摄像头：' + e.message + '（请用手机浏览器并允许权限）';
  }
}

function stopCamera() {
  if (state.stream) {
    state.stream.getTracks().forEach((t) => t.stop());
    state.stream = null;
  }
  const v = $('#preview');
  if (v) v.srcObject = null;
}

function pickMime() {
  const list = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ];
  for (const t of list) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

function startRecorder() {
  if (!state.stream) throw new Error('摄像头未就绪');
  if (state.recording) return;
  const mime = pickMime();
  state.chunks = [];
  const rec = mime
    ? new MediaRecorder(state.stream, { mimeType: mime, videoBitsPerSecond: 1600000 })
    : new MediaRecorder(state.stream);
  state.recorder = rec;
  rec.ondataavailable = (e) => {
    if (e.data && e.data.size) state.chunks.push(e.data);
  };
  rec.start(1000);
  state.recording = true;
  setBadge('rec');
}

function stopRecorder(expectData = true) {
  return new Promise((resolve) => {
    const rec = state.recorder;
    if (!rec || rec.state === 'inactive') {
      state.recording = false;
      setBadge('off');
      resolve(null);
      return;
    }
    rec.onstop = () => {
      state.recording = false;
      setBadge('off');
      if (!expectData || !state.chunks.length) {
        resolve(null);
        return;
      }
      const type = rec.mimeType || 'video/webm';
      resolve(new Blob(state.chunks, { type }));
    };
    try {
      rec.stop();
    } catch {
      resolve(null);
    }
  });
}

function selectedIds() {
  return $$('.order-check:checked').map((el) => el.value);
}

function isFruitBowl(order) {
  if (!order) return false;
  const cat = String(order.productCategory || '');
  if (cat === '水果捞' || cat === '酸奶捞') return true;
  if (Array.isArray(order.items) && order.items.some((it) => it && (it.productCategory === '水果捞' || it.productCategory === '酸奶捞'))) {
    return true;
  }
  return /水果捞|捞$/.test(String(order.productName || ''));
}

function orderItemsHtml(o) {
  const items = Array.isArray(o.items) && o.items.length ? o.items : null;
  if (items) {
    return items
      .map((it) => {
        const fruits = (it.extras || [])
          .filter((e) => e && e.kind !== 'topping' && e.kind !== 'sideMeal')
          .map((e) => e.name)
          .filter(Boolean);
        const tops = (it.toppings || []).map((t) => t.name).filter(Boolean);
        const tip = [
          fruits.length ? fruits.join('、') : '',
          tops.length ? `小料 ${tops.join('/')}` : '',
        ]
          .filter(Boolean)
          .join(' · ');
        return `<div>${it.productName} · ${it.specName}×${it.quantity}${tip ? ` · ${tip}` : ''}</div>`;
      })
      .join('');
  }
  return `<div>${o.productName} · ${o.specName}</div>`;
}

function selectedFruitBowlOrders() {
  const ids = new Set(selectedIds());
  return (state.ordersCache || []).filter((o) => ids.has(o.id) && isFruitBowl(o));
}

function selectedToppingIds() {
  return [...state.selectedToppingIds];
}

function updateSelHint() {
  const ids = selectedIds();
  const codes = $$('.order-check:checked').map((el) => el.dataset.code).filter(Boolean);
  $('#selHint').textContent = ids.length ? `已选 ${ids.length}：${codes.join('、')}` : '未选择';
  updateToppingPanel();
}

function renderToppingChips() {
  const box = $('#toppingChips');
  if (!box) return;
  const list = state.toppings || [];
  if (!list.length) {
    box.innerHTML = '<span class="muted">暂无上架小料，请到后台「小料」维护</span>';
    return;
  }
  box.innerHTML = list
    .map((t) => {
      const on = state.selectedToppingIds.has(t.id) ? 'on' : '';
      const price = Number(t.price) > 0 ? ` ¥${t.price}` : '';
      return `<button type="button" class="topping-chip ${on}" data-id="${t.id}">${t.name}${price}</button>`;
    })
    .join('');
  box.querySelectorAll('.topping-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      if (state.selectedToppingIds.has(id)) state.selectedToppingIds.delete(id);
      else state.selectedToppingIds.add(id);
      renderToppingChips();
      updateToppingPanel();
    });
  });
}

function updateToppingPanel() {
  const bowls = selectedFruitBowlOrders();
  const panel = $('#toppingPanel');
  if (!panel) return;
  if (!bowls.length) {
    panel.classList.add('hidden');
    return;
  }
  panel.classList.remove('hidden');
  const names = selectedToppingIds()
    .map((id) => (state.toppings || []).find((t) => t.id === id)?.name)
    .filter(Boolean);
  $('#toppingHint').textContent = names.length
    ? `已选小料：${names.join('、')}（将写入 ${bowls.length} 单水果捞）`
    : `已选 ${bowls.length} 单水果捞，可点选小料后开始制作`;
}

async function loadToppings() {
  try {
    const data = await api('/api/admin/toppings');
    state.toppings = data.active || (data.list || []).filter((t) => t.status !== 0);
    renderToppingChips();
  } catch {
    state.toppings = [];
    renderToppingChips();
  }
}

async function refreshList() {
  const { list } = await api('/api/admin/orders');
  state.ordersCache = list || [];
  const show = list
    .filter((o) => ['paid', 'making', 'ready'].includes(o.status))
    .sort((a, b) => {
      const ar = a.fulfillmentType === 'reserve' && a.status === 'paid' ? 1 : 0;
      const br = b.fulfillmentType === 'reserve' && b.status === 'paid' ? 1 : 0;
      if (ar !== br) return ar - br;
      return (a.pickupAt || a.paidAt || 0) - (b.pickupAt || b.paidAt || 0);
    });
  $('#list').innerHTML = show.length
    ? show
        .map((o) => {
          const checkable = ['paid', 'making'].includes(o.status);
          const sideExtras = (o.extras || []).filter((e) => e && e.kind === 'sideMeal');
          const sideMeal =
            (o.sideMeal && o.sideMeal.name) || (sideExtras[0] && sideExtras[0].name) || '';
          const sideTag = sideMeal
            ? `<div class="muted">代餐 ${sideMeal.replace(/^小食套餐·/, '')}</div>`
            : '';
          const bowlTag = isFruitBowl(o) ? ' · 含水果捞' : '';
          return `<label class="card">
            ${checkable ? `<input type="checkbox" class="order-check" value="${o.id}" data-code="${o.pickupCode || ''}" data-bowl="${isFruitBowl(o) ? '1' : '0'}" ${o.status === 'making' ? 'checked' : ''}/>` : '<span style="width:20px"></span>'}
            <div class="code">${o.pickupCode || '--'}</div>
            <div class="meta">
              ${orderItemsHtml(o)}
              ${sideTag}
              <div class="tag ${o.status}">${STATUS[o.status] || o.status}${o.videoUrl ? ' · 已有视频' : ''}${bowlTag}</div>
              <div class="muted">${o.fulfillmentType === 'reserve' ? `预约 ${o.pickupAtText || ''}` : '现取'}${
                o.deliveryPoint && o.deliveryPoint !== 'shop' ? ` · ${o.deliveryPointName}` : ' · 到店'
              } · ¥${o.amount}</div>
            </div>
          </label>`;
        })
        .join('')
    : '<p class="muted">暂无订单</p>';
  $$('.order-check').forEach((c) => c.addEventListener('change', updateSelHint));
  updateSelHint();
}

async function startMaking() {
  const ids = selectedIds();
  if (!ids.length) {
    $('#statusText').textContent = '请先勾选要做的单';
    return;
  }
  try {
    $('#statusText').textContent = '开始制作并录像…';
    if (!state.stream) await startCamera();
    startRecorder();
    const payload = { ids, status: 'making' };
    if (selectedFruitBowlOrders().length) {
      payload.toppingIds = selectedToppingIds();
    }
    const data = await api('/api/orders/batch-status', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    state.makeBatchId = data.makeBatchId || '';
    const tipExtra =
      payload.toppingIds && payload.toppingIds.length
        ? `，小料 ${payload.toppingIds.length} 种`
        : '';
    $('#statusText').textContent = (data.tip || `制作中 ${data.count} 单，正在录像`) + tipExtra;
    await refreshList();
  } catch (e) {
    await stopRecorder(false);
    $('#statusText').textContent = e.message;
  }
}

async function finishReady() {
  let ids = selectedIds();
  // 若没勾选，自动把制作中的都待取
  if (!ids.length) {
    ids = $$('.order-check')
      .filter((el) => el.closest('.card')?.textContent.includes('制作中') || true)
      .map((el) => el.value);
    // better: from API
    const { list } = await api('/api/admin/orders');
    ids = list.filter((o) => o.status === 'making').map((o) => o.id);
  }
  if (!ids.length) {
    $('#statusText').textContent = '没有制作中的订单';
    return;
  }

  try {
    setBadge('up');
    state.uploading = true;
    $('#statusText').textContent = '停止录像并上传…';
    const blob = await stopRecorder(true);

    const readyPayload = { ids, status: 'ready' };
    const bowlIds = ids.filter((id) => isFruitBowl((state.ordersCache || []).find((o) => o.id === id)));
    if (bowlIds.length && selectedToppingIds().length) {
      readyPayload.toppingIds = selectedToppingIds();
    }
    const batchData = await api('/api/orders/batch-status', {
      method: 'POST',
      body: JSON.stringify(readyPayload),
    });

    // 取 makeBatchId：优先录像时记下的，否则从订单读
    let makeBatchId = state.makeBatchId;
    if (!makeBatchId) {
      const { list } = await api('/api/admin/orders');
      const o = list.find((x) => ids.includes(x.id) && x.makeBatchId);
      makeBatchId = o?.makeBatchId || '';
    }

    if (blob && blob.size > 1000) {
      const q = makeBatchId
        ? `makeBatchId=${encodeURIComponent(makeBatchId)}`
        : `orderId=${encodeURIComponent(ids[0])}`;
      const res = await fetch(`${API}/api/admin/videos/upload?${q}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${state.token}`,
          'Content-Type': blob.type || 'video/webm',
        },
        body: blob,
      });
      const up = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(up.error || '视频上传失败');
      $('#statusText').textContent = `已待取 ${batchData.count} 单，视频已自动上传（绑定 ${up.boundOrders} 单）`;
    } else {
      $('#statusText').textContent = `已待取 ${batchData.count} 单（无有效录像，可检查摄像头权限）`;
    }

    state.makeBatchId = '';
    await refreshList();
  } catch (e) {
    $('#statusText').textContent = e.message;
  } finally {
    state.uploading = false;
    setBadge(state.recording ? 'rec' : 'off');
  }
}

$('#loginBtn').addEventListener('click', login);
$('#logoutBtn').addEventListener('click', logout);
$('#selectPaid').addEventListener('click', () => {
  $$('.order-check').forEach((c) => {
    const tag = c.closest('.card')?.querySelector('.tag');
    if (tag && tag.textContent.includes('待制作')) c.checked = true;
  });
  updateSelHint();
});
$('#startBtn').addEventListener('click', startMaking);
$('#readyBtn').addEventListener('click', finishReady);

if (state.token) {
  showMain(true);
  Promise.all([loadToppings(), startCamera().catch(() => {})])
    .then(() => refreshList())
    .catch(() => refreshList());
} else {
  showMain(false);
}

setInterval(() => {
  if (state.token && !state.uploading) refreshList().catch(() => {});
}, 8000);
