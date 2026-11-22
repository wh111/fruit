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
    offsetX: 'sg_detong_offset_x',
    offsetY: 'sg_detong_offset_y',
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
    codeType: 'text', // text 杯贴给顾客 | barcode 条形码
    brandFont: 2.6,
    codeFont: 5.2,
    nameFont: 3.8,
    subFont: 4.4,
    footFont: 2.0,
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
    barcodeHeight: 7,
    textHeight: 2.2,
    slogan: '免洗什锦 臭氧消毒 低农残',
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

  function migrateOrderTpl(tpl) {
    const next = { ...DEFAULT_ORDER_TPL, ...(tpl || {}) };
    if (Number(next.codeFont) >= 8) next.codeFont = DEFAULT_ORDER_TPL.codeFont;
    if (Number(next.nameFont) <= 3) next.nameFont = DEFAULT_ORDER_TPL.nameFont;
    if (Number(next.subFont) <= 2.8) next.subFont = DEFAULT_ORDER_TPL.subFont;
    return next;
  }

  function extraFruitNames(list) {
    return (list || [])
      .filter((e) => e && e.kind !== 'topping' && e.kind !== 'sideMeal')
      .map((e) => (typeof e === 'string' ? e : e.name))
      .map((n) => String(n || '').trim())
      .filter(Boolean);
  }

  function kitchenPicks(order, item) {
    const fruits = [];
    const tops = [];
    const seenF = new Set();
    const seenT = new Set();
    const addF = (n) => {
      const name = String(n || '').trim();
      if (!name || seenF.has(name)) return;
      seenF.add(name);
      fruits.push(name);
    };
    const addT = (n) => {
      const name = String(n || '').trim();
      if (!name || seenT.has(name)) return;
      seenT.add(name);
      tops.push(name);
    };
    if (item) {
      extraFruitNames(item.extras).forEach(addF);
      (item.toppings || []).forEach((t) => addT(t && t.name));
      (item.extras || []).forEach((e) => {
        if (e && e.kind === 'topping') addT(e.name);
      });
    } else {
      extraFruitNames(order.extras).forEach(addF);
      (order.items || []).forEach((it) => extraFruitNames(it.extras).forEach(addF));
      (order.toppings || []).forEach((t) => addT(t && t.name));
      (order.items || []).forEach((it) => (it.toppings || []).forEach((t) => addT(t && t.name)));
      (order.extras || []).forEach((e) => {
        if (e && e.kind === 'topping') addT(e.name);
      });
      (order.items || []).forEach((it) =>
        (it.extras || []).forEach((e) => {
          if (e && e.kind === 'topping') addT(e.name);
        })
      );
    }
    const picksLine = [fruits.join('、'), tops.length ? `小料${tops.join('、')}` : ''].filter(Boolean).join('  ');
    return { fruits, tops, picksLine };
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
      width: Number(localStorage.getItem(KEY.width) || 40),
      height: Number(localStorage.getItem(KEY.height) || 30),
      offsetX: Number(localStorage.getItem(KEY.offsetX) || 0),
      offsetY: Number(localStorage.getItem(KEY.offsetY) || 0),
      enabled: localStorage.getItem(KEY.enabled) !== '0',
      orderTpl: migrateOrderTpl(loadJson(KEY.orderTpl, DEFAULT_ORDER_TPL)),
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
    localStorage.setItem(KEY.width, String(next.width || 40));
    localStorage.setItem(KEY.height, String(next.height || 30));
    localStorage.setItem(KEY.offsetX, String(next.offsetX || 0));
    localStorage.setItem(KEY.offsetY, String(next.offsetY || 0));
    localStorage.setItem(KEY.enabled, next.enabled ? '1' : '0');
    localStorage.setItem(KEY.orderTpl, JSON.stringify(next.orderTpl));
    localStorage.setItem(KEY.batchTpl, JSON.stringify(next.batchTpl));
    return next;
  }

  function isAvailable() {
    return !!(state.ready && state.api && loadSettings().enabled);
  }

  function allowUsbPrinter(api) {
    if (!api || api._sgUsbOpen) return;
    // 未安装 Windows 驱动时，DP30S 以 HID 出现，dtpweb 会直接丢弃打印任务。
    // 本机打印助手可以打开这台机器，因此不再按 HID 拒绝。
    api.isHidPrinter = function () {
      return false;
    };
    api._sgUsbOpen = true;
  }

  function openPrinter(api, printerName) {
    return new Promise((resolve) => {
      const list = api.getPrinters({ onlyLocal: false }) || [];
      let device = null;
      if (printerName && printerName.includes('@')) {
        const [name, ip] = printerName.split('@');
        device = { name, ip };
      } else if (printerName) {
        device =
          list.find(
            (p) => p && (p.name === printerName || p.deviceName === printerName || p.printerName === printerName)
          ) || printerName;
      } else {
        device = list[0];
      }
      if (!device) return resolve(false);
      api.openPrinter(device, (ok) => resolve(!!ok));
    });
  }

  /** 间隙纸 + 中速，避免走纸漂、标签越打越歪 */
  function prepareLabelPrinter(api) {
    try {
      if (typeof api.setGapType === 'function') api.setGapType(2);
    } catch (_) {
      /* ignore */
    }
    try {
      if (typeof api.setPrintSpeed === 'function') api.setPrintSpeed(2);
    } catch (_) {
      /* ignore */
    }
  }

  function printPages(res) {
    const pages = res && (res.printData || (res.resultInfo && res.resultInfo.printData));
    if (!Array.isArray(pages) || !pages.length) return [];
    return pages;
  }

  const LOCAL_USB_ORIGIN = 'http://127.0.0.1:3000';

  function isLocalAdminHost() {
    return location.hostname === '127.0.0.1' || location.hostname === 'localhost';
  }

  async function postUsbPages(url, pages) {
    const token = localStorage.getItem('sg_admin_token') || '';
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token ? `Bearer ${token}` : '',
      },
      body: JSON.stringify({ pages }),
      signal: AbortSignal.timeout(4000),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || 'USB 打印失败');
    return data;
  }

  function waitForUsbBridge(ms = 6000) {
    return new Promise((resolve, reject) => {
      if (window.sgUsbBridge && !window.sgUsbBridge.closed && window.sgUsbBridgeReady) {
        resolve(window.sgUsbBridge);
        return;
      }
      const timer = setTimeout(() => {
        window.removeEventListener('message', onMsg);
        reject(new Error('本机打印通道未连上。请点「打开本机打印通道」，并允许弹出窗口。'));
      }, ms);
      function onMsg(ev) {
        if (ev.origin !== LOCAL_USB_ORIGIN && ev.origin !== 'http://localhost:3000') return;
        if (!ev.data || ev.data.type !== 'sg-usb-ready') return;
        window.sgUsbBridgeReady = true;
        if (ev.source) window.sgUsbBridge = ev.source;
        clearTimeout(timer);
        window.removeEventListener('message', onMsg);
        resolve(window.sgUsbBridge);
      }
      window.addEventListener('message', onMsg);
    });
  }

  function sendViaLocalBridge(type, payload) {
    return new Promise((resolve, reject) => {
      const w = window.sgUsbBridge;
      if (!w || w.closed) {
        reject(new Error('请先点「打开本机打印通道」，用店里这台电脑接下 USB 打印'));
        return;
      }
      const id = 'usb-' + Date.now() + '-' + Math.random().toString(16).slice(2);
      const timer = setTimeout(() => {
        window.removeEventListener('message', onMsg);
        reject(new Error('本机打印超时，请确认打印通道窗口还开着'));
      }, 25000);
      function onMsg(ev) {
        if (ev.origin !== LOCAL_USB_ORIGIN && ev.origin !== 'http://localhost:3000') return;
        const d = ev.data || {};
        if (d.type !== 'sg-usb-result' || d.id !== id) return;
        clearTimeout(timer);
        window.removeEventListener('message', onMsg);
        if (d.ok) resolve(d.data || { ok: true });
        else reject(new Error(d.error || 'USB 打印失败'));
      }
      window.addEventListener('message', onMsg);
      try {
        w.postMessage({ type, id, ...payload }, '*');
      } catch (e) {
        clearTimeout(timer);
        window.removeEventListener('message', onMsg);
        reject(new Error('本机打印通道已失效，请再点一次「打开本机打印通道」'));
      }
    });
  }

  function openLocalUsbBridge() {
    window.sgUsbBridgeReady = false;
    const w = window.open(LOCAL_USB_ORIGIN + '/admin/usb-bridge.html', 'sg-usb-bridge', 'width=420,height=240');
    window.sgUsbBridge = w;
    if (!w) throw new Error('浏览器拦截了本机打印窗口，请允许弹出窗口后重试');
    return w;
  }

  function prepareUsb() {
    if (isLocalAdminHost()) return;
    try {
      if (!window.sgUsbBridge || window.sgUsbBridge.closed) openLocalUsbBridge();
    } catch (_) {
      /* 自动打印可能没有点击手势 */
    }
  }

  async function sendToUsb(pages) {
    if (isLocalAdminHost()) {
      return postUsbPages('/api/admin/print/usb', pages);
    }
    // 线上是 https，不能直接 fetch 本机 http，否则会被浏览器拦住或一直转圈。
    if (!window.sgUsbBridge || window.sgUsbBridge.closed || !window.sgUsbBridgeReady) {
      prepareUsb();
      await waitForUsbBridge();
    }
    return sendViaLocalBridge('sg-usb-print', { pages });
  }

  async function postReceipt(url, ticket) {
    const token = localStorage.getItem('sg_admin_token') || '';
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token ? `Bearer ${token}` : '',
      },
      body: JSON.stringify({ ticket }),
      signal: AbortSignal.timeout(20000),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || '热敏打印失败');
    return data;
  }

  async function sendReceipt(ticket) {
    if (isLocalAdminHost()) {
      return postReceipt('/api/admin/print/receipt', ticket);
    }
    if (!window.sgUsbBridge || window.sgUsbBridge.closed || !window.sgUsbBridgeReady) {
      prepareUsb();
      await waitForUsbBridge();
    }
    return sendViaLocalBridge('sg-receipt-print', { ticket });
  }

  function receiptLines(order) {
    const items = Array.isArray(order.items) && order.items.length ? order.items : null;
    if (items) return items;
    return [
      {
        productName: order.productName,
        specName: order.specName,
        quantity: order.quantity,
        extras: order.extras,
        toppings: order.toppings,
      },
    ];
  }

  function itemTitle(item) {
    const name = String((item && item.productName) || '').trim();
    const spec = String((item && item.specName) || '').trim();
    if (name && spec && spec !== '标准') return `${name} · ${spec}`;
    return name || spec || '水果捞';
  }

  function buildReceiptTicket(order, shopName, item) {
    const picks = kitchenPicks(order, item);
    return {
      shop: shopName || '四季果先',
      code: String(order.pickupCode || ''),
      title: itemTitle(item),
      fruits: picks.fruits,
      toppingLine: picks.tops.length ? `小料 ${picks.tops.join('、')}` : '',
      qty: Number(item.quantity) || 1,
      time: formatPickup(order),
    };
  }

  function commitJob(api) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('打印机没有响应，请确认已开机并装好标签纸'));
      }, 20000);
      api.commitJob((res) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const pages = printPages(res);
        if (!pages.length) {
          reject(new Error('打印助手没有返回打印数据'));
          return;
        }
        sendToUsb(pages).then(() => resolve(res)).catch(reject);
      });
    });
  }

  function beginJob(api, width, height, extra) {
    const started = api.startJob({
      width,
      height,
      orientation: 0,
      jobName: 'Print',
      // 当前 dtpweb 2.6 只接受 action=1 才会真正出纸，4096 会返回参数错误。
      action: 1,
      gapType: 2,
      ...(extra || {}),
    });
    if (!started) throw new Error('无法开始打印，请确认打印机已开机并装好标签纸');
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
    prepareUsb();
    const api = state.api;
    if (!api || !state.ready) throw new Error('德佟打印助手未连接');
    const settings = loadSettings();
    if (!settings.enabled) throw new Error('已关闭德佟打印');
    const ok = await openPrinter(api, settings.printer);
    if (!ok) throw new Error('打开德佟打印机失败');
    try {
      prepareLabelPrinter(api);
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
      const W = settings.width || 40;
      const H = settings.height || 30;
      const qrText = String(order.qrPayload || order.orderNo || order.id);
      const picks = kitchenPicks(order);
      const title = `${order.productName || ''} · ${order.specName || ''}`.trim();
      const sub = [
        picks.picksLine,
        Number(order.quantity) > 1 ? `×${order.quantity}` : '',
        tpl.showPrice ? `¥${order.amount ?? ''}` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      const footParts = [];
      if (tpl.showTime) footParts.push(formatPickup(order));
      if (tpl.showDelivery) footParts.push(deliveryText(order));
      const foot = footParts.join(' · ');

      beginJob(api, W, H, jobOffset(settings));

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
        let y = 0.8;
        const x = 2;
        const w = W - 4;
        const brandH = 2.8;
        const brandY = tpl.showBrand ? Math.max(1.2, H - brandH - 0.3) : H;
        const contentBottom = tpl.showBrand ? brandY - 0.4 : H;
        if (tpl.showCode) {
          const codeH = 5.4;
          api.drawText({
            text: String(order.pickupCode),
            x,
            y,
            width: w,
            height: codeH,
            fontHeight: Math.min(tpl.codeFont || 5.2, 5.4),
            fontStyle: 1,
          });
          y += codeH + 0.2;
        }
        if (tpl.showName) {
          api.drawText({
            text: title.slice(0, 24),
            x,
            y,
            width: w,
            height: 4.4,
            fontHeight: Math.max(tpl.nameFont || 3.8, 3.6),
            fontStyle: 1,
          });
          y += 4.5;
        }
        const pickText = picks.picksLine || sub;
        if (pickText && y < contentBottom - 1) {
          api.drawText({
            text: pickText,
            x,
            y,
            width: w,
            height: Math.max(6, contentBottom - y - (foot ? 2.4 : 0.2)),
            fontHeight: Math.max(tpl.subFont || 4.4, 4.2),
            fontStyle: 1,
          });
        }
        if (tpl.showBrand) {
          api.drawText({
            text: tpl.brand,
            x,
            y: brandY,
            width: w,
            height: brandH,
            fontHeight: tpl.brandFont,
            fontStyle: 1,
          });
        }
      }

      await commitJob(api);
      return { ok: true, provider: 'detong' };
    });
  }

  async function printOrderReceipt(payload) {
    const order = payload && payload.order;
    if (!order || !order.pickupCode) throw new Error('订单无取餐码');
    prepareUsb();
    const shopName = payload.shopName || loadSettings().orderTpl.brand || '四季果先';
    const lines = receiptLines(order);
    let first = true;
    for (const item of lines) {
      const ticket = buildReceiptTicket(order, shopName, item);
      if (first) {
        const notes = [];
        if (order.fridayGift && order.fridayGift.name) notes.push(`赠${order.fridayGift.name}`);
        if (order.canProcess) notes.push('可加工');
        if (notes.length) ticket.fruits = (ticket.fruits || []).concat(notes);
        first = false;
      }
      await sendReceipt(ticket);
    }
    return { ok: true, count: lines.length };
  }

  function jobOffset(settings) {
    const offsetX = Number(settings && settings.offsetX) || 0;
    const offsetY = Number(settings && settings.offsetY) || 0;
    const extra = {};
    if (offsetX) extra.offsetX = offsetX;
    if (offsetY) extra.offsetY = offsetY;
    return extra;
  }

  function drawCenteredText(api, text, x, y, width, height, fontHeight, fontStyle) {
    api.drawText({
      text,
      x,
      y,
      width,
      height,
      fontHeight,
      fontStyle: fontStyle || 0,
      horizontalAlignment: 1,
      verticalAlignment: 1,
    });
  }

  /**
   * 打印一张商品/库存条形码标签
   * item: { code, title?, name?, spec?, price?, brand? }
   */
  async function drawBarcodeLabel(api, settings, item, overrides) {
    const tpl = { ...DEFAULT_BATCH_TPL, ...settings.batchTpl, ...(overrides || {}) };
    const W = settings.width || 40;
    const H = settings.height || 30;
    const code = String(item.code || '').trim();
    if (!code) throw new Error('条码内容为空');

    beginJob(api, W, H, jobOffset(settings));
    const pad = 1.5;
    const innerW = W - pad * 2;
    let y = 0.6;
    if (tpl.showBrand) {
      drawCenteredText(api, item.brand || tpl.brand, pad, y, innerW, 2.3, 2.1, 1);
      y += 2.4;
    }
    const name = String(item.name || '').trim();
    const spec = String(item.spec || '').trim();
    const title = name || String(item.title || '').trim();
    if (tpl.showTitle && title) {
      const twoLine = title.length > 10;
      drawCenteredText(api, title, pad, y, innerW, twoLine ? 4.8 : 2.8, twoLine ? 2.3 : 2.6, 1);
      y += twoLine ? 5.0 : 3.0;
    }
    const slogan = String(item.slogan != null ? item.slogan : tpl.slogan || '').trim();
    if (slogan) {
      drawCenteredText(api, slogan, pad, y, innerW, 2.4, 1.85, 0);
      y += 2.5;
    }
    const footBits = [];
    if (spec) footBits.push(spec);
    if (tpl.showPrice && (item.price || item.price === 0)) footBits.push(`¥${item.price}`);
    const ean = isEan13Code(code) || /^\d{13}$/.test(code);
    const human = tpl.showHuman;
    const footH = footBits.length ? 2.8 : 0;
    const humanH = human ? 2.0 : 0;
    const barH = Math.max(6, Math.min(7.2, H - y - footH - humanH - 1.0));
    const barW = Math.min(ean ? 24 : innerW * 0.72, innerW);
    const barX = pad + (innerW - barW) / 2;
    api.draw1DBarcode({
      text: ean ? toEan13(code) : code,
      x: barX,
      y,
      width: barW,
      height: barH,
      textHeight: human ? humanH : 0,
      barPixels: 2,
      barcodeType: ean ? EAN13_TYPE : CODE128_TYPE,
      horizontalAlignment: 1,
    });
    y += barH + (human ? humanH + 0.3 : 0.5);
    if (footBits.length) {
      drawCenteredText(api, footBits.join('  '), pad, Math.min(y, H - 3.0), innerW, 2.8, 2.4, 1);
    }
    await commitJob(api);
  }

  function printBarcodeLabel(item, overrides) {
    return withPrinter(async (api, settings) => {
      await drawBarcodeLabel(api, settings, item, overrides);
      return { ok: true };
    });
  }

  /** 批量打印，items: [{code,title,price,copies?}] */
  async function printBarcodeBatch(items, { onProgress, gapMs = 80 } = {}) {
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
      await withPrinter(async (api, settings) => {
        for (const it of list) {
          const copies = Math.max(1, Math.min(200, Number(it.copies) || 1));
          for (let i = 0; i < copies; i++) {
            await drawBarcodeLabel(api, settings, it);
            done += 1;
            if (onProgress) onProgress({ done, total, current: it });
            if (gapMs > 0) await new Promise((r) => setTimeout(r, gapMs));
          }
        }
      });
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
      const usbHint = isLocalAdminHost()
        ? ''
        : window.sgUsbBridge && !window.sgUsbBridge.closed
          ? ' · 本机 USB 通道已开'
          : ' · 线上打印请先点「打开本机打印通道」';
      el.textContent = `已连接打印助手 · 检测到 ${state.printers.length} 台设备${usbHint}`;
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
    set('detongOffsetX', s.offsetX || 0);
    set('detongOffsetY', s.offsetY || 0);
    set('orderTplBrand', ot.brand);
    set('orderTplShowBrand', ot.showBrand, true);
    set('orderTplShowCode', ot.showCode, true);
    set('orderTplShowName', ot.showName, true);
    set('orderTplShowPrice', ot.showPrice, true);
    set('orderTplShowTime', ot.showTime, true);
    set('orderTplShowDelivery', ot.showDelivery, true);
    set('orderTplCodeType', ot.codeType === 'barcode' ? 'barcode' : 'text');
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

  const EAN13_TYPE = 22; // dtpweb LPA_1DBT_EAN13
  const CODE128_TYPE = 28;

  function ean13CheckDigit(d12) {
    const s = String(d12)
      .replace(/\D/g, '')
      .padStart(12, '0')
      .slice(0, 12);
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += Number(s[i]) * (i % 2 === 0 ? 1 : 3);
    return String((10 - (sum % 10)) % 10);
  }

  function toEan13(raw) {
    const digits = String(raw || '').replace(/\D/g, '');
    const body = (digits.length >= 13 ? digits.slice(0, 12) : digits.slice(-12)).padStart(12, '0');
    return body + ean13CheckDigit(body);
  }

  function isEan13Code(code) {
    const s = String(code || '').trim();
    return /^\d{13}$/.test(s) && s === toEan13(s);
  }

  /** 稳定 13 位 EAN-13：优先规格/商品自带 barcode，否则由商品 id 生成 */
  function skuBarcode(product, spec) {
    const stored = (spec && spec.barcode) || (product && product.barcode) || '';
    const storedDigits = String(stored).replace(/\D/g, '');
    if (storedDigits.length >= 12) return toEan13(storedDigits);

    const key = `${product && product.id ? product.id : 'x'}|${(spec && spec.id) || 'std'}`;
    let h = 2166136261;
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return toEan13(`21${String(h >>> 0).padStart(10, '0').slice(-10)}`);
  }

  function isRetailMixProduct(p) {
    if (!p) return false;
    const cat = String(p.category || '');
    return cat === '免洗什锦' || cat === '水果零售' || cat === '零售什锦';
  }

  function retailDefaultCopies() {
    const n = Number($('retailLabelDefaultCopies')?.value);
    if (!Number.isFinite(n) || n < 0) return 10;
    return Math.min(200, Math.floor(n));
  }

  function retailRows() {
    return [...document.querySelectorAll('#retailLabelBody tr[data-code]')];
  }

  function visibleRetailRows() {
    return retailRows().filter((tr) => tr.style.display !== 'none');
  }

  function selectedRetailRows() {
    return retailRows().filter((tr) => tr.querySelector('.retail-pick')?.checked);
  }

  function syncRetailSelectAll() {
    const all = $('retailLabelSelectAll');
    if (!all) return;
    const rows = visibleRetailRows();
    const checked = rows.filter((tr) => tr.querySelector('.retail-pick')?.checked);
    all.checked = rows.length > 0 && checked.length === rows.length;
    all.indeterminate = checked.length > 0 && checked.length < rows.length;
  }

  function filterRetailRows() {
    const q = String($('retailLabelFilter')?.value || '')
      .trim()
      .toLowerCase();
    retailRows().forEach((tr) => {
      const hay = `${tr.dataset.name || ''} ${tr.dataset.title || ''} ${tr.dataset.spec || ''}`.toLowerCase();
      tr.style.display = !q || hay.includes(q) ? '' : 'none';
    });
    syncRetailSelectAll();
  }

  function collectRetailPrintItems() {
    const fallback = retailDefaultCopies();
    return selectedRetailRows()
      .map((tr) => {
        let copies = Math.max(0, Math.min(200, Number(tr.querySelector('.retail-copies')?.value) || 0));
        if (copies <= 0) copies = fallback;
        if (copies <= 0) return null;
        return {
          code: tr.dataset.code,
          title: tr.dataset.title || '',
          name: tr.dataset.name || '',
          spec: tr.dataset.spec || '',
          slogan: '免洗什锦 臭氧消毒 低农残',
          price: tr.dataset.price !== '' ? tr.dataset.price : undefined,
          copies,
        };
      })
      .filter(Boolean);
  }

  async function loadRetailMixLabels() {
    const body = $('retailLabelBody');
    const hint = $('retailLabelHint');
    if (!body) return;
    body.innerHTML = '<tr><td colspan="6" class="muted">加载中…</td></tr>';
    if (hint) hint.textContent = '';
    try {
      const token = localStorage.getItem('sg_admin_token') || '';
      const res = await fetch('/api/admin/products', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '拉取商品失败');

      const onShelf = (data.list || []).filter((p) => isRetailMixProduct(p) && p.status !== 0);
      const rows = [];
      onShelf.forEach((p) => {
        const specs = p.specs && p.specs.length ? p.specs : [{ id: 'std', name: '标准', price: 0 }];
        specs.forEach((sp) => {
          const code = skuBarcode(p, sp);
          const title = `${p.name}${sp.name ? ' · ' + sp.name : ''}`;
          rows.push({
            productId: p.id,
            name: p.name,
            specName: sp.name || '',
            price: sp.price,
            code,
            title,
          });
        });
      });

      if (!rows.length) {
        body.innerHTML =
          '<tr><td colspan="6" class="muted">暂无上架的免洗什锦。请到「商品」页把什锦上架。</td></tr>';
        if (hint) hint.textContent = '未找到上架菜单';
        return;
      }

      const def = retailDefaultCopies();
      body.innerHTML = rows
        .map(
          (r) => `<tr data-code="${escapeAttr(r.code)}" data-name="${escapeAttr(r.name)}" data-spec="${escapeAttr(r.specName || '')}" data-title="${escapeAttr(r.title)}" data-price="${escapeAttr(r.price ?? '')}">
            <td class="pick-cell"><input type="checkbox" class="retail-pick" /></td>
            <td>${escapeHtml(r.name)}</td>
            <td>${escapeHtml(r.specName || '-')}</td>
            <td>${r.price != null && r.price !== '' ? '¥' + r.price : '-'}</td>
            <td class="code-cell">${escapeHtml(r.code)}</td>
            <td><input type="number" class="retail-copies" min="0" max="200" value="${def}" /></td>
          </tr>`
        )
        .join('');
      if (hint) hint.textContent = `已加载 ${onShelf.length} 个上架商品 · ${rows.length} 个规格。请勾选要打的品种。`;
      filterRetailRows();
    } catch (e) {
      body.innerHTML = `<tr><td colspan="6" class="muted">${escapeHtml(e.message || '加载失败')}</td></tr>`;
      if (hint) hint.textContent = e.message || '加载失败';
      if (typeof toast === 'function') toast(e.message || '加载免洗什锦菜单失败');
    }
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, '&#39;');
  }

  function fillRetailCopies(value) {
    const n = Math.max(0, Math.min(200, Number(value) || 0));
    const rows = selectedRetailRows();
    if (!rows.length) {
      if (typeof toast === 'function') toast('请先勾选要打的品种');
      return;
    }
    rows.forEach((tr) => {
      const inp = tr.querySelector('.retail-copies');
      if (inp) inp.value = String(n);
    });
  }

  function clearRetailSelection() {
    retailRows().forEach((tr) => {
      const box = tr.querySelector('.retail-pick');
      if (box) box.checked = false;
    });
    syncRetailSelectAll();
  }

  async function printRetailMixLabels() {
    const picked = selectedRetailRows();
    if (!picked.length) {
      if (typeof toast === 'function') toast('请先勾选要打的品种，不会一次打完全部');
      setBatchProgress('未勾选品种');
      return;
    }
    const items = collectRetailPrintItems();
    if (!items.length) {
      if (typeof toast === 'function') toast('已选品种的张数都是 0，请填写张数');
      setBatchProgress('未选择打印张数');
      return;
    }
    const total = items.reduce((sum, it) => sum + it.copies, 0);
    if (!confirm(`将打印已选的 ${items.length} 种，共 ${total} 张条形码标签，确认？`)) return;
    await runBatch(items);
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
    allowUsbPrinter(api);
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
    w?.addEventListener('change', () => saveSettings({ width: Number(w.value) || 40 }));
    h?.addEventListener('change', () => saveSettings({ height: Number(h.value) || 30 }));
    $('detongOffsetX')?.addEventListener('change', (e) => {
      saveSettings({ offsetX: Number(e.target.value) || 0 });
    });
    $('detongOffsetY')?.addEventListener('change', (e) => {
      saveSettings({ offsetY: Number(e.target.value) || 0 });
    });

    window.addEventListener('message', (ev) => {
      if (ev.origin !== LOCAL_USB_ORIGIN && ev.origin !== 'http://localhost:3000') return;
      if (ev.data && ev.data.type === 'sg-usb-ready') {
        window.sgUsbBridgeReady = true;
        if (ev.source) window.sgUsbBridge = ev.source;
        updateStatusUI();
      }
    });
    $('detongUsbBridge')?.addEventListener('click', () => {
      try {
        openLocalUsbBridge();
        if (typeof toast === 'function') toast('已打开本机打印通道，请不要关掉那个小窗口');
      } catch (e) {
        if (typeof toast === 'function') toast(e.message || '打不开本机打印通道');
      }
    });
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
      const btn = $('detongTest');
      if (btn) btn.disabled = true;
      if (typeof toast === 'function') toast('正在打印测试标签…');
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
        if (typeof toast === 'function') toast('测试标签已送到打印机');
      } catch (e) {
        if (typeof toast === 'function') toast(e.message || '测试打印失败');
      } finally {
        if (btn) btn.disabled = false;
      }
    });

    $('receiptTest')?.addEventListener('click', async () => {
      const btn = $('receiptTest');
      if (btn) btn.disabled = true;
      if (typeof toast === 'function') toast('正在打印测试小票…');
      try {
        await printOrderReceipt({
          shopName: loadSettings().orderTpl.brand || '四季果先',
          order: {
            pickupCode: 'A001',
            productName: '三拼自选水果捞',
            specName: '标准',
            quantity: 1,
            extras: [{ name: '哈密瓜' }, { name: '芒果' }, { name: '凤梨' }, { name: '椰果', kind: 'topping' }],
            fulfillmentType: 'now',
            createdAt: Date.now(),
          },
        });
        if (typeof toast === 'function') toast('测试小票已送到 POS-80');
      } catch (e) {
        if (typeof toast === 'function') toast(e.message || '热敏打印失败');
      } finally {
        if (btn) btn.disabled = false;
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
            return specs.map((sp) => ({
              code: skuBarcode(p, sp),
              title: `${p.name}${sp.name ? ' · ' + sp.name : ''}`,
              price: sp.price,
              copies,
            }));
          });
        if (!items.length) throw new Error('没有在售商品');
        await runBatch(items);
      } catch (e) {
        if (typeof toast === 'function') toast(e.message || '从商品生成失败');
        setBatchProgress(e.message || '失败');
      }
    });

    $('retailLabelRefresh')?.addEventListener('click', () => {
      loadRetailMixLabels();
    });
    $('retailLabelFillCopies')?.addEventListener('click', () => {
      fillRetailCopies(retailDefaultCopies());
    });
    $('retailLabelClearCopies')?.addEventListener('click', () => {
      clearRetailSelection();
    });
    $('retailLabelPrint')?.addEventListener('click', () => {
      printRetailMixLabels();
    });
    $('retailLabelFilter')?.addEventListener('input', filterRetailRows);
    $('retailLabelSelectAll')?.addEventListener('change', (e) => {
      const on = !!e.target.checked;
      visibleRetailRows().forEach((tr) => {
        const box = tr.querySelector('.retail-pick');
        if (box) box.checked = on;
      });
      syncRetailSelectAll();
    });
    $('retailLabelBody')?.addEventListener('change', (e) => {
      if (e.target && e.target.classList.contains('retail-pick')) syncRetailSelectAll();
    });
    // 首次进入管理端时若已在标签页，稍后由 admin.refresh 再拉一次
    setTimeout(() => {
      if (document.getElementById('tab-hardware') && !document.getElementById('tab-hardware').classList.contains('hidden')) {
        loadRetailMixLabels();
      }
    }, 0);

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
    prepareUsb,
    printOrderLabel,
    printOrderReceipt,
    printBarcodeLabel,
    printBarcodeBatch,
    buildSerialItems,
    skuBarcode,
    loadRetailMixLabels,
    loadSettings,
    saveSettings,
    refreshPrinterSelect,
    getState: () => ({ ...state }),
  };
})(window);
