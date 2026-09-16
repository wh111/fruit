# 真实微信支付 + 云打印机配置

## 一、微信支付（推荐：个体工商户直连）

目标方案：**先办个体户执照 → 自己在微信支付开户 → 直连小程序 JSAPI**。  
开发用 `PAY_MODE=mock` 时，调用链与正式一致：`预支付 → 收银台 → confirm`，不会在 create 时直接入账。

| 模式 | `.env` |
|------|--------|
| 开发模拟 | `PAY_MODE=mock` |
| 正式个体户直连 | `PAY_MODE=wechat` + `WX_MCH_ID`=个体户商户号（**不填** `WX_SUB_MCH_ID`） |
| 服务商通道（备选） | 再填 `WX_SUB_MCH_ID` |

### 1. 准备材料（个体户直连）

1. **个体工商户营业执照**  
2. 已认证**微信小程序** → AppID、AppSecret  
3. [微信支付商户平台](https://pay.weixin.qq.com/) 申请商户号（主体选个体工商户）  
4. API 安全 → **APIv2 密钥**（32 位）  
5. 关联小程序 AppID，开通 **JSAPI 支付**  
6. 回调：`https://sijixiansheng.xin/api/pay/notify`

### 2. 填写 `server/.env`

```bash
# 开发
PAY_MODE=mock

# 上线改为：
# PAY_MODE=wechat
WX_APPID=wx你的小程序AppID
WX_SECRET=你的小程序AppSecret
WX_MCH_ID=个体户商户号
WX_API_KEY=APIv2密钥32位
WX_NOTIFY_URL=https://sijixiansheng.xin/api/pay/notify
```

### 3. 支付流程（mock 与 wechat 相同）

1. `POST /api/auth/wxlogin` → openid  
2. `POST /api/orders` → 待支付订单  
3. `POST /api/pay/create` → 预支付参数（`paid: false`）  
4. 收银台：mock 弹窗确认 / 正式 `wx.requestPayment`  
5. 取消则 `POST /api/orders/:id/cancel`  
6. 成功则 `POST /api/pay/confirm` → 入账、取餐码、云打印  
7. 正式另有微信异步回调 `POST /api/pay/notify`  

---

## 二、订阅消息（取餐/投柜提醒）

用户支付前会弹出一次性订阅授权；后台把订单标为 **ready** 时服务端调用微信推送。

### 1. 公众平台配置

1. [微信公众平台](https://mp.weixin.qq.com/) → 功能 → 订阅消息  
2. 选用餐饮/取餐类模板（含商品名、取餐点、取餐码、温馨提示等字段）  
3. 记下模板 ID，以及每个字段的 key（如 `thing1`、`character_string3`）

### 2. 填写 `server/.env`

```bash
WX_SUBSCRIBE_READY_TMPL_ID=你的模板ID
# 按你选用的模板改字段名；缺省示例如下
WX_SUBSCRIBE_READY_KEYS={"product":"thing1","place":"thing2","code":"character_string3","tip":"thing4"}
# 开发版调试可改 developer；上线用 formal
WX_SUBSCRIBE_STATE=formal
```

还需已配置 `WX_APPID`、`WX_SECRET`（与支付共用）。未配模板 ID 时接口静默跳过，不影响下单。

### 3. 流程

1. 小程序支付前 `wx.requestSubscribeMessage`（`GET /api/subscribe/config` 取 tmplIds）  
2. 店员后台将订单改为「可取/已投柜」`ready`  
3. 服务端 `subscribeMessage.send` → 用户微信服务通知  

---

## 三、云打印机

支付成功后，后端会自动调用云打印（`CLOUD_PRINT_ENABLED=true`）。

### 方案 A：飞鹅云（推荐）

```bash
CLOUD_PRINT_ENABLED=true
CLOUD_PRINT_PROVIDER=feie
CLOUD_PRINT_USER=...
CLOUD_PRINT_UKEY=...
CLOUD_PRINT_SN=...
```

### 方案 B：易联云

```bash
CLOUD_PRINT_ENABLED=true
CLOUD_PRINT_PROVIDER=yilianyun
YLY_CLIENT_ID=...
YLY_CLIENT_SECRET=...
YLY_MACHINE_CODE=...
```

---

## 四、上线清单

| 项目 | 说明 |
|------|------|
| 个体户执照 + 微信商户号 | 直连，勿优先走服务商 |
| `PAY_MODE=wechat` + WX_* | 上线必填 |
| 订阅消息模板 `WX_SUBSCRIBE_READY_*` | 取餐/投柜提醒，建议开启 |
| 云打印 | 建议开启 |
| 小程序合法域名 | `https://sijixiansheng.xin` |

改完 `.env` 后重启服务 / 部署。
