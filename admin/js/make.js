const API = '';
const state = {
  token: localStorage.getItem('sg_make_token') || '',
  stream: null,
  recorder: null,
  chunks: [],
  makeBatchId: '',
  recording: false,
  uploading: false,
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

function updateSelHint() {
  const ids = selectedIds();
  const codes = $$('.order-check:checked').map((el) => el.dataset.code).filter(Boolean);
  $('#selHint').textContent = ids.length ? `已选 ${ids.length}：${codes.join('、')}` : '未选择';
}

async function refreshList() {
  const { list } = await api('/api/admin/orders');
  const show = list.filter((o) => ['paid', 'making', 'ready'].includes(o.status));
  $('#list').innerHTML = show.length
    ? show
        .map((o) => {
          const checkable = ['paid', 'making'].includes(o.status);
          return `<label class="card">
            ${checkable ? `<input type="checkbox" class="order-check" value="${o.id}" data-code="${o.pickupCode || ''}" ${o.status === 'making' ? 'checked' : ''}/>` : '<span style="width:20px"></span>'}
            <div class="code">${o.pickupCode || '--'}</div>
            <div class="meta">
              <div>${o.productName} · ${o.specName}</div>
              <div class="tag ${o.status}">${STATUS[o.status] || o.status}${o.videoUrl ? ' · 已有视频' : ''}</div>
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
    const data = await api('/api/orders/batch-status', {
      method: 'POST',
      body: JSON.stringify({ ids, status: 'making' }),
    });
    state.makeBatchId = data.makeBatchId || '';
    $('#statusText').textContent = data.tip || `制作中 ${data.count} 单，正在录像`;
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

    const batchData = await api('/api/orders/batch-status', {
      method: 'POST',
      body: JSON.stringify({ ids, status: 'ready' }),
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
  startCamera().then(refreshList).catch(() => refreshList());
} else {
  showMain(false);
}

setInterval(() => {
  if (state.token && !state.uploading) refreshList().catch(() => {});
}, 8000);
