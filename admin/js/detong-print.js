/**
 * 德佟标签机（dtpweb）
 * - 订单杯贴：字段可自定义
 * - 批量条形码：连号 / 手动列表 / 从商品生成
 */
(function (global) {
  const KEY = {
    printer: 'sg_detong_printer',
    width: 'sg_detong_label_w',
    height: 'sg_detong_label_h',
    enabled: 'sg_detong_enabled',
    orderTpl: 'sg_detong_order_tpl',
    batchTpl: 'sg_detong_batch_tpl',
  };

  const DEFAULT_ORDER_TPL = {
    brand: '四季果先',
    showBrand: true,
    showCode: true,
    showName: true,
    showPrice: true,
    showTime: true,
    showDelivery: true,
    codeType: 'qr', // qr | barcode
    brandFont: 2.6,
    codeFont: 7.5,
    nameFont: 2.8,
    subFont: 2.4,
    footFont: 2.2,
  };

  const DEFAULT_BATCH_TPL = {
    brand: '四季果先',
    showBrand: true,
    showTitle: true,
    showPrice: true,
    showHuman: true,
    brandFont: 2.6,
    titleFont: 3.2,
    priceFont: 2.8,
    barcodeHeight: 12,
    textHeight: 3,
  };

  const state = {
    api: null,
    ready: false,
    printers: [],
    lastError: '',
    batchRunning: false,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return { ...fallback };
      return { ...fallback, ...JSON.parse(raw) };
    } catch {
      return { ...fallback };
    }
  }

  function loadSettings() {
    return {
      printer: localStorage.getItem(KEY.printer) || '',
      width: Number(localStorage.getItem(KEY.width) || 50),
      height: Number(localStorage.getItem(KEY.height) || 30),
      enabled: localStorage.getItem(KEY.enabled) !== '0',
      orderTpl: loadJson(KEY.orderTpl, DEFAULT_ORDER_TPL),
      batchTpl: loadJson(KEY.batchTpl, DEFAULT_BATCH_TPL),
    };
  }

  function saveSettings(partial) {
    const cur = loadSettings();
    const next = {
      ...cur,
      ...partial,
      orderTpl: { ...cur.orderTpl, ...(partial.orderTpl || {}) },
      batchTpl: { ...cur.batchTpl, ...(partial.batchTpl || {}) },
    };
    localStorage.setItem(KEY.printer, next.printer || '');
    localStorage.setItem(KEY.width, String(next.width || 50));
    localStorage.setItem(KEY.height, String(next.height || 30));
    localStorage.setItem(KEY.enabled, next.enabled ? '1' : '0');
    localStorage.setItem(KEY.orderTpl, JSON.stringify(next.orderTpl));
    localStorage.setItem(KEY.batchTpl, JSON.stringify(next.batchTpl));
    return next;
  }

  function isAvailable() {
    return !!(state.ready && state.api && loadSettings().enabled);
  }

  function openPrinter(api, printerName) {
    return new Promise((resolve) => {
      if (!printerName) {
        const list = api.getPrinters({ onlyLocal: false }) || [];
        const first = list[0];
        if (!first) return resolve(false);
        const name = typeof first === 'string' ? first : first.name;
        api.openPrinter(name, (ok) => resolve(!!ok));
        return;
      }
      if (printerName.includes('@')) {
        const [name, ip] = printerName.split('@');
        api.openPrinter({ name, ip }, (ok) => resolve(!!ok));
      } else {
        api.openPrinter(printerName, (ok) => resolve(!!ok));
      }
    });
  }

  function commitJob(api) {
    return new Promise((resolve) => {
      api.commitJob(() => resolve());
    });
  }

  function formatPickup(order) {
    if (order.fulfillmentType === 'reserve' && (order.pickupAtText || order.pickupAt)) {
      return `预约 ${order.pickupAtText || ''}`;
    }
    const t = new Date(order.paidAt || order.createdAt || Date.now());
    const mm = String(t.getMonth() + 1).padStart(2, '0');
    const dd = String(t.getDate()).padStart(2, '0');
    const hh = String(t.getHours()).padStart(2, '0');
    const mi = String(t.getMinutes()).padStart(2, '0');
    return `现取 ${mm}-${dd} ${hh}:${mi}`;
  }

  function deliveryText(order) {
    if (order.deliveryPoint && order.deliveryPoint !== 'shop') {
      return order.deliveryPointName || order.deliveryPoint;
    }
    return '到店取';
  }

  async function withPrinter(fn) {
    const api = state.api;
    if (!api || !state.ready) throw new Error('德佟打印助手未连接');
    const settings = loadSettings();
    if (!settings.enabled) throw new Error('已关闭德佟打印');
    const ok = await openPrinter(api, settings.printer);
    if (!ok) throw new Error('打开德佟打印机失败');
    try {
      return await fn(api, settings);
    } finally {
      try {
        api.closePrinter();
      } catch (_) {
        /* ignore */
      }
    }
  }

  /** 打印订单杯贴（字段由 orderTpl 控制） */
  function printOrderLabel(payload) {
    return withPrinter(async (api, settings) => {
      const order = payload.order;
      if (!order || !order.pickupCode) throw new Error('订单无取餐码');
      const tpl = { ...DEFAULT_ORDER_TPL, ...settings.orderTpl };
      if (payload.shopName) tpl.brand = payload.shopName;
      const W = settings.width || 50;
      const H = settings.height || 30;
      const qrText = String(order.qrPayload || order.orderNo || order.id);
      const title = `${order.productName || ''} · ${order.specName || ''}`.trim();
      const sub = `×${order.quantity || 1}${tpl.showPrice ? ` · ¥${order.amount ?? ''}` : ''}`;
      const footParts = [];
      if (tpl.showTime) footParts.push(formatPickup(order));
      if (tpl.showDelivery) footParts.push(deliveryText(order));
      const foot = footParts.join(' · ');

      api.startJob({ width: W, height: H });

      let tx = 2;
      let tw = W - 4;
      if (tpl.codeType === 'barcode') {
        const bh = Math.min(H * 0.38, 12);
        api.draw1DBarcode({
          text: String(order.pickupCode || qrText).replace(/[^0-9A-Za-z\-]/g, ''),
          x: 2,
          y: 1.5,
          width: W - 4,
          height: bh,
          textHeight: tpl.showCode ? 0 : 2.5,
          barPixels: 2,
        });
        let y = bh + 3;
        if (tpl.showBrand) {
          api.drawText({
            text: tpl.brand,
            x: 2,
            y,
            width: tw,
            height: 3.2,
            fontHeight: tpl.brandFont,
            fontStyle: 1,
          });
          y += 3.4;
        }
        if (tpl.showCode) {
          api.drawText({
            text: String(order.pickupCode),
            x: 2,
            y,
            width: tw,
            height: 6,
            fontHeight: Math.min(tpl.codeFont, 6),
            fontStyle: 1,
          });
          y += 5.5;
        }
        if (tpl.showName) {
          api.drawText({
            text: title.slice(0, 28),
            x: 2,
            y,
            width: tw,
            height: 3.5,
            fontHeight: tpl.nameFont,
          });
          y += 3.6;
        }
        if (tpl.showPrice || order.quantity) {
          api.drawText({
            text: sub,
            x: 2,
            y,
            width: tw,
            height: 3,
            fontHeight: tpl.subFont,
          });
        }
      } else {
        const qrSize = Math.min(H - 4, 18);
        api.draw2DQRCode({
          text: qrText,
          x: 2,
          y: (H - qrSize) / 2,
          width: qrSize,
        });
        tx = qrSize + 4;
        tw = W - tx - 1.5;
        let y = 1.2;
        if (tpl.showBrand) {
          api.drawText({
            text: tpl.brand,
            x: tx,
            y,
            width: tw,
            height: 3.2,
            fontHeight: tpl.brandFont,
            fontStyle: 1,
          });
          y += 3.3;
        }
        if (tpl.showCode) {
          api.drawText({
            text: String(order.pickupCode),
            x: tx,
            y,
            width: tw,
            height: 8,
            fontHeight: tpl.codeFont,
            fontStyle: 1,
          });
          y += 8.5;
        }
        if (tpl.showName) {
          api.drawText({
            text: title.slice(0, 28),
            x: tx,
            y,
            width: tw,
            height: 4,
            fontHeight: tpl.nameFont,
          });
          y += 4;
        }
        api.drawText({
          text: sub,
          x: tx,
          y,
          width: tw,
          height: 3.5,
          fontHeight: tpl.subFont,
        });
        if (foot) {
          api.drawText({
            text: foot.slice(0, 36),
            x: tx,
            y: H - 5,
            width: tw,
            height: 3.5,
            fontHeight: tpl.footFont,
          });
        }
      }

      await commitJob(api);
      return { ok: true, provider: 'detong' };
    });
  }

  /**
   * 打印一张商品/库存条形码标签
   * item: { code, title?, price?, brand? }
   */
  function printBarcodeLabel(item, overrides) {
    return withPrinter(async (api, settings) => {
      const tpl = { ...DEFAULT_BATCH_TPL, ...settings.batchTpl, ...(overrides || {}) };
      const W = settings.width || 50;
      const H = settings.height || 30;
      const code = String(item.code || '').trim();
      if (!code) throw new Error('条码内容为空');

      api.startJob({ width: W, height: H });
      let y = 1.2;
      if (tpl.showBrand) {
        api.drawText({
          text: item.brand || tpl.brand,
          x: 2,
          y,
          width: W - 4,
          height: 3.2,
          fontHeight: tpl.brandFont,
          fontStyle: 1,
        });
        y += 3.4;
      }
      if (tpl.showTitle && item.title) {
        api.drawText({
          text: String(item.title).slice(0, 32),
          x: 2,
          y,
          width: W - 4,
          height: 4,
          fontHeight: tpl.titleFont,
        });
        y += 4.2;
      }
      const barH = Math.min(tpl.barcodeHeight || 12, H - y - (tpl.showPrice || tpl.showHuman ? 7 : 2));
      api.draw1DBarcode({
        text: code,
        x: 2,
        y,
        width: W - 4,
        height: Math.max(8, barH),
        textHeight: tpl.showHuman ? tpl.textHeight || 3 : 0,
        barPixels: 2,
      });
      y += Math.max(8, barH) + (tpl.showHuman ? (tpl.textHeight || 3) + 1.5 : 1);
      if (tpl.showPrice && (item.price || item.price === 0)) {
        api.drawText({
          text: `¥${item.price}`,
          x: 2,
          y: Math.min(y, H - 4),
          width: W - 4,
          height: 3.5,
          fontHeight: tpl.priceFont,
          fontStyle: 1,
        });
      }
      await commitJob(api);
      return { ok: true };
    });
  }

  /** 批量打印，items: [{code,title,price,copies?}] */
  async function printBarcodeBatch(items, { onProgress, gapMs = 350 } = {}) {
    if (state.batchRunning) throw new Error('批量打印进行中');
    const list = (items || []).filter((x) => x && x.code);
    if (!list.length) throw new Error('没有可打印的条码');
    if (!isAvailable()) throw new Error('德佟打印机不可用');

    state.batchRunning = true;
    let done = 0;
    let total = 0;
    list.forEach((it) => {
      total += Math.max(1, Number(it.copies) || 1);
    });
    try {
      for (const it of list) {
        const copies = Math.max(1, Math.min(200, Number(it.copies) || 1));
        for (let i = 0; i < copies; i++) {
          await printBarcodeLabel(it);
          done += 1;
          if (onProgress) onProgress({ done, total, current: it });
          if (gapMs > 0) await new Promise((r) => setTimeout(r, gapMs));
        }
      }
      return { ok: true, printed: done };
    } finally {
      state.batchRunning = false;
    }
  }

  /** 连号生成：prefix + start..start+count-1（补零） */
  function buildSerialItems({ prefix, start, count, pad, title, price, copies }) {
    const n = Math.max(1, Math.min(500, Number(count) || 1));
    const s = Number(start) || 1;
    const p = Math.max(0, Math.min(8, Number(pad) || 4));
    const items = [];
    for (let i = 0; i < n; i++) {
      const num = String(s + i).padStart(p, '0');
      items.push({
        code: `${prefix || ''}${num}`,
        title: title || '',
        price: price === '' || price == null ? undefined : price,
        copies: Math.max(1, Number(copies) || 1),
      });
    }
    return items;
  }

  function refreshPrinterSelect() {
    const sel = $('detongPrinter');
    if (!sel || !state.api) return;
    const settings = loadSettings();
    const list = state.api.getPrinters({ onlyLocal: false }) || [];
    state.printers = list;
    sel.innerHTML = '';
    if (!list.length) {
      sel.innerHTML = '<option value="">未检测到打印机</option>';
      return;
    }
    list.forEach((item) => {
      const local = state.api.isLocalPrinter ? state.api.isLocalPrinter(item) : !item.ip;
      const name = typeof item === 'string' ? item : item.name;
      const value = local || !item.ip ? name : `${name}@${item.ip}`;
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = value;
      if (value === settings.printer) opt.selected = true;
      sel.appendChild(opt);
    });
    if (!settings.printer && list[0]) {
      const first = list[0];
      const name = typeof first === 'string' ? first : first.name;
      const value =
        state.api.isLocalPrinter && state.api.isLocalPrinter(first)
          ? name
          : first.ip
            ? `${name}@${first.ip}`
            : name;
      saveSettings({ printer: value });
      sel.value = value;
    }
  }

  function updateStatusUI() {
    const el = $('detongStatus');
    if (!el) return;
    if (state.ready) {
      el.textContent = `已连接打印助手 · 检测到 ${state.printers.length} 台设备`;
      el.className = 'muted ok-line';
    } else {
      el.textContent = state.lastError || '未检测到德佟打印助手（需在本机安装并启动）';
      el.className = 'muted warn-line';
    }
  }

  function bindCheckbox(id, tplKey, field) {
    const el = $(id);
    if (!el) return;
    const settings = loadSettings();
    el.checked = !!(settings[tplKey] && settings[tplKey][field]);
    el.addEventListener('change', () => {
      saveSettings({ [tplKey]: { [field]: el.checked } });
    });
  }

  function bindInput(id, tplKey, field, cast) {
    const el = $(id);
    if (!el) return;
    const settings = loadSettings();
    const v = settings[tplKey] && settings[tplKey][field];
    if (v !== undefined && v !== null) el.value = String(v);
    el.addEventListener('change', () => {
      const val = cast ? cast(el.value) : el.value;
      saveSettings({ [tplKey]: { [field]: val } });
    });
  }

  function fillTemplateForm() {
    const s = loadSettings();
    const ot = s.orderTpl;
    const bt = s.batchTpl;
    const set = (id, val, isCheck) => {
      const el = $(id);
      if (!el) return;
      if (isCheck) el.checked = !!val;
      else el.value = val == null ? '' : String(val);
    };
    set('detongEnabled', s.enabled, true);
    set('detongWidth', s.width);
    set('detongHeight', s.height);
    set('orderTplBrand', ot.brand);
    set('orderTplShowBrand', ot.showBrand, true);
    set('orderTplShowCode', ot.showCode, true);
    set('orderTplShowName', ot.showName, true);
    set('orderTplShowPrice', ot.showPrice, true);
    set('orderTplShowTime', ot.showTime, true);
    set('orderTplShowDelivery', ot.showDelivery, true);
    set('orderTplCodeType', ot.codeType || 'qr');
    set('batchTplBrand', bt.brand);
    set('batchTplShowBrand', bt.showBrand, true);
    set('batchTplShowTitle', bt.showTitle, true);
    set('batchTplShowPrice', bt.showPrice, true);
    set('batchTplShowHuman', bt.showHuman, true);
  }

  function wireTemplateForm() {
    bindInput('orderTplBrand', 'orderTpl', 'brand');
    bindCheckbox('orderTplShowBrand', 'orderTpl', 'showBrand');
    bindCheckbox('orderTplShowCode', 'orderTpl', 'showCode');
    bindCheckbox('orderTplShowName', 'orderTpl', 'showName');
    bindCheckbox('orderTplShowPrice', 'orderTpl', 'showPrice');
    bindCheckbox('orderTplShowTime', 'orderTpl', 'showTime');
    bindCheckbox('orderTplShowDelivery', 'orderTpl', 'showDelivery');
    bindInput('orderTplCodeType', 'orderTpl', 'codeType');
    bindInput('batchTplBrand', 'batchTpl', 'brand');
    bindCheckbox('batchTplShowBrand', 'batchTpl', 'showBrand');
    bindCheckbox('batchTplShowTitle', 'batchTpl', 'showTitle');
    bindCheckbox('batchTplShowPrice', 'batchTpl', 'showPrice');
    bindCheckbox('batchTplShowHuman', 'batchTpl', 'showHuman');
  }

  function parseManualList(text) {
    // 每行: 条码,品名,价格,份数
    return String(text || '')
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(/[,，\t]/).map((x) => x.trim());
        return {
          code: parts[0],
          title: parts[1] || '',
          price: parts[2] !== undefined && parts[2] !== '' ? parts[2] : undefined,
          copies: parts[3] ? Number(parts[3]) : 1,
        };
      })
      .filter((x) => x.code);
  }

  function setBatchProgress(msg) {
    const el = $('batchPrintProgress');
    if (el) el.textContent = msg || '';
  }

  async function runBatch(items) {
    setBatchProgress('准备打印…');
    try {
      const res = await printBarcodeBatch(items, {
        onProgress: ({ done, total, current }) => {
          setBatchProgress(`打印中 ${done}/${total} · ${current.code}`);
        },
      });
      setBatchProgress(`完成，共 ${res.printed} 张`);
      if (typeof toast === 'function') toast(`批量打印完成：${res.printed} 张`);
    } catch (e) {
      setBatchProgress(e.message || '失败');
      if (typeof toast === 'function') toast(e.message || '批量打印失败');
    }
  }

  function init() {
    if (typeof dtpweb === 'undefined' || !dtpweb.getInstance) {
      state.lastError = '未加载 dtpweb SDK';
      updateStatusUI();
      return;
    }

    const api = dtpweb.getInstance();
    state.api = api;
    api.checkPlugin((resp) => {
      if (resp && resp.statusCode === 0) {
        state.ready = true;
        state.lastError = '';
        try {
          if (api.discoveryPrinters) api.discoveryPrinters(1);
        } catch (_) {
          /* ignore */
        }
        setTimeout(() => {
          refreshPrinterSelect();
          updateStatusUI();
        }, 800);
      } else {
        state.ready = false;
        state.lastError = '未检测到打印助手，请安装德佟 dtpweb 并保持运行';
        updateStatusUI();
      }
    });

    fillTemplateForm();
    wireTemplateForm();

    const en = $('detongEnabled');
    const w = $('detongWidth');
    const h = $('detongHeight');
    en?.addEventListener('change', () => {
      saveSettings({ enabled: en.checked });
      updateStatusUI();
    });
    $('detongPrinter')?.addEventListener('change', (e) => {
      saveSettings({ printer: e.target.value });
    });
    w?.addEventListener('change', () => saveSettings({ width: Number(w.value) || 50 }));
    h?.addEventListener('change', () => saveSettings({ height: Number(h.value) || 30 }));

    $('detongRefresh')?.addEventListener('click', () => {
      try {
        if (state.api?.discoveryPrinters) state.api.discoveryPrinters(1);
      } catch (_) {
        /* ignore */
      }
      setTimeout(() => {
        refreshPrinterSelect();
        updateStatusUI();
        if (typeof toast === 'function') toast('已刷新打印机列表');
      }, 600);
    });

    $('detongTest')?.addEventListener('click', async () => {
      try {
        await printOrderLabel({
          shopName: loadSettings().orderTpl.brand || '四季果先',
          order: {
            pickupCode: 'A001',
            productName: '测试标签',
            specName: '标准',
            quantity: 1,
            amount: 10,
            orderNo: 'TEST-' + Date.now(),
            qrPayload: 'TEST-' + Date.now(),
            fulfillmentType: 'now',
            createdAt: Date.now(),
          },
        });
        if (typeof toast === 'function') toast('订单测试标签已发送');
      } catch (e) {
        if (typeof toast === 'function') toast(e.message || '测试打印失败');
      }
    });

    $('batchSerialPrint')?.addEventListener('click', async () => {
      const items = buildSerialItems({
        prefix: $('batchPrefix')?.value || '',
        start: $('batchStart')?.value,
        count: $('batchCount')?.value,
        pad: $('batchPad')?.value,
        title: $('batchTitle')?.value || '',
        price: $('batchPrice')?.value,
        copies: $('batchCopies')?.value || 1,
      });
      await runBatch(items);
    });

    $('batchManualPrint')?.addEventListener('click', async () => {
      const items = parseManualList($('batchManualList')?.value);
      await runBatch(items);
    });

    $('batchFromProducts')?.addEventListener('click', async () => {
      try {
        const token = localStorage.getItem('sg_admin_token') || '';
        const res = await fetch('/api/admin/products', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '拉取商品失败');
        const copies = Math.max(1, Number($('batchCopies')?.value) || 1);
        const items = (data.list || [])
          .filter((p) => p.status !== 0)
          .flatMap((p) => {
            const specs = p.specs && p.specs.length ? p.specs : [{ id: 'std', name: '标准', price: 0 }];
            return specs.map((sp) => {
              const raw = String(p.barcode || `SG${String(p.id).replace(/-/g, '').slice(-8)}${sp.id || ''}`);
              return {
                code: raw.replace(/[^0-9A-Za-z\-]/g, '').slice(0, 22) || `SG${Date.now().toString().slice(-8)}`,
                title: `${p.name}${sp.name ? ' · ' + sp.name : ''}`,
                price: sp.price,
                copies,
              };
            });
          });
        if (!items.length) throw new Error('没有在售商品');
        await runBatch(items);
      } catch (e) {
        if (typeof toast === 'function') toast(e.message || '从商品生成失败');
        setBatchProgress(e.message || '失败');
      }
    });

    const previewBatch = () => {
      const mode = document.querySelector('input[name="batchMode"]:checked')?.value || 'serial';
      let items = [];
      if (mode === 'manual') items = parseManualList($('batchManualList')?.value);
      else {
        items = buildSerialItems({
          prefix: $('batchPrefix')?.value || '',
          start: $('batchStart')?.value,
          count: $('batchCount')?.value,
          pad: $('batchPad')?.value,
          title: $('batchTitle')?.value || '',
          price: $('batchPrice')?.value,
          copies: $('batchCopies')?.value || 1,
        });
      }
      const box = $('batchPreviewBox');
      if (!box) return;
      box.textContent = items
        .slice(0, 30)
        .map(
          (it, i) =>
            `${i + 1}. ${it.code}  ${it.title || ''}  ${it.price != null && it.price !== '' ? '¥' + it.price : ''}  ×${it.copies || 1}`
        )
        .join('\n');
      if (items.length > 30) box.textContent += `\n…共 ${items.length} 条`;
    };
    $('batchPreview')?.addEventListener('click', previewBatch);
    $('batchPreviewManual')?.addEventListener('click', previewBatch);

    const syncMode = () => {
      const mode = document.querySelector('input[name="batchMode"]:checked')?.value || 'serial';
      const serial = $('batchSerialBox');
      const manual = $('batchManualBox');
      if (serial) serial.style.display = mode === 'serial' ? '' : 'none';
      if (manual) manual.style.display = mode === 'manual' ? '' : 'none';
    };
    document.querySelectorAll('input[name="batchMode"]').forEach((r) => {
      r.addEventListener('change', syncMode);
    });
    syncMode();
  }

  global.DetongPrint = {
    init,
    isAvailable,
    printOrderLabel,
    printBarcodeLabel,
    printBarcodeBatch,
    buildSerialItems,
    loadSettings,
    saveSettings,
    refreshPrinterSelect,
    getState: () => ({ ...state }),
  };
})(window);
