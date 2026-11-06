const CART_KEY = 'sgx_cart';
const CHECKOUT_KEY = 'sgx_checkout';

function lineKey(line) {
  const extras = (line.extras || []).slice().sort().join(',');
  const tops = (line.toppingIds || []).slice().sort().join(',');
  return `${line.productId}|${line.specId}|${extras}|${tops}`;
}

function readCart() {
  try {
    const list = wx.getStorageSync(CART_KEY);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeCart(list) {
  wx.setStorageSync(CART_KEY, Array.isArray(list) ? list : []);
  return list;
}

function cartCount(list) {
  return (list || readCart()).reduce((s, it) => s + (Number(it.quantity) || 0), 0);
}

function cartEstimate(list) {
  return (list || readCart()).reduce((s, it) => {
    const unit = Number(it.unitPrice) || 0;
    const qty = Number(it.quantity) || 0;
    return s + unit * qty;
  }, 0);
}

function addToCart(line) {
  const item = {
    productId: line.productId,
    productName: line.productName || '',
    productCategory: line.productCategory || '',
    cover: line.cover || '',
    coverUrl: line.coverUrl || '',
    specId: line.specId,
    specName: line.specName || '',
    extras: Array.isArray(line.extras) ? line.extras.slice() : [],
    toppingIds: Array.isArray(line.toppingIds) ? line.toppingIds.slice() : [],
    toppingNames: Array.isArray(line.toppingNames) ? line.toppingNames.slice() : [],
    quantity: Math.max(1, Number(line.quantity) || 1),
    unitPrice: Number(line.unitPrice) || 0,
  };
  const key = lineKey(item);
  const list = readCart();
  const idx = list.findIndex((x) => lineKey(x) === key);
  if (idx >= 0) {
    list[idx].quantity = (Number(list[idx].quantity) || 0) + item.quantity;
  } else {
    list.push(item);
  }
  writeCart(list);
  return list;
}

function setQty(index, quantity) {
  const list = readCart();
  if (index < 0 || index >= list.length) return list;
  const q = Number(quantity) || 0;
  if (q <= 0) list.splice(index, 1);
  else list[index].quantity = q;
  writeCart(list);
  return list;
}

function removeAt(index) {
  const list = readCart();
  if (index < 0 || index >= list.length) return list;
  list.splice(index, 1);
  writeCart(list);
  return list;
}

function clearCart() {
  writeCart([]);
}

function setCheckoutItems(items, { fromCart = false } = {}) {
  wx.setStorageSync(CHECKOUT_KEY, {
    items: Array.isArray(items) ? items : [],
    fromCart: !!fromCart,
    at: Date.now(),
  });
}

function readCheckout() {
  try {
    const data = wx.getStorageSync(CHECKOUT_KEY);
    if (!data || !Array.isArray(data.items) || !data.items.length) return null;
    return data;
  } catch {
    return null;
  }
}

function clearCheckout() {
  try {
    wx.removeStorageSync(CHECKOUT_KEY);
  } catch {
    /* ignore */
  }
}

function toOrderPayloadItems(items) {
  return (items || []).map((it) => ({
    productId: it.productId,
    specId: it.specId,
    quantity: Math.max(1, Number(it.quantity) || 1),
    extras: Array.isArray(it.extras) ? it.extras : [],
    toppingIds: Array.isArray(it.toppingIds) ? it.toppingIds : [],
  }));
}

module.exports = {
  readCart,
  writeCart,
  cartCount,
  cartEstimate,
  addToCart,
  setQty,
  removeAt,
  clearCart,
  setCheckoutItems,
  readCheckout,
  clearCheckout,
  toOrderPayloadItems,
  lineKey,
};
