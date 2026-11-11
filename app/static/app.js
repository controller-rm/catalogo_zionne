/* Catálogo Virtual Zionne — versão online (API) */
const LOGO = '/static/img/logo.png';
const BRL = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const SESS = 'zionne_session', ASESS = 'zionne_admin_session';
const $ = id => document.getElementById(id);

let data = { products: [], collections: [], home: { benefits: [] }, notices: [], inspirations: [], settings: {} };
let clients = [], me = null, adminUser = '', orderStatus = [], adminPreview = false;
let cart = [], myOrders = [], adminOrders = [];

/* ---------------------------------------------------------------- API */
async function api(path, { method = 'GET', body, admin = false, form } = {}) {
  const tok = localStorage.getItem(admin ? ASESS : SESS);
  const headers = {};
  if (tok) headers.Authorization = 'Bearer ' + tok;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(path, { method, headers, body: form || (body !== undefined ? JSON.stringify(body) : undefined) });
  let j = null;
  try { j = await r.json(); } catch { }
  if (!r.ok) {
    const msg = (j && j.detail) || ('Erro ' + r.status);
    if (r.status === 401) {
      if (admin) { localStorage.removeItem(ASESS); }
      else if (!adminPreview) { localStorage.removeItem(SESS); }
    }
    const e = new Error(msg); e.status = r.status; throw e;
  }
  return j;
}
async function uploadImage(file) {
  const fd = new FormData(); fd.append('file', file);
  const r = await api('/api/admin/upload', { method: 'POST', admin: true, form: fd });
  return r.url;
}

/* ---------------------------------------------------------------- views */
function show(view) {
  ['loginView', 'appView', 'adminView', 'loading'].forEach(v => $(v).classList.toggle('hidden', v !== view));
  window.scrollTo(0, 0);
}
function showLogin(msg) {
  show('loginView');
  const err = $('loginError');
  if (msg) { err.textContent = msg; err.classList.remove('hidden'); } else err.classList.add('hidden');
}

/* ---------------------------------------------------------------- login cliente */
async function login() {
  const doc = $('loginDoc').value, token = $('loginToken').value.trim(), err = $('loginError'), btn = $('loginBtn');
  if (!doc || !token) { err.textContent = 'Informe CNPJ/CPF e token.'; err.classList.remove('hidden'); return; }
  btn.disabled = true; btn.textContent = 'Entrando...';
  try {
    const r = await api('/api/login', { method: 'POST', body: { doc, token } });
    localStorage.setItem(SESS, r.session);
    err.classList.add('hidden');
    await loadCatalog();
  } catch (e) {
    err.textContent = e.message; err.classList.remove('hidden');
  } finally { btn.disabled = false; btn.textContent = 'Acessar catálogo'; }
}
async function loadCatalog() {
  const r = await api('/api/catalog');
  adminPreview = false;
  me = r.client;
  data = { products: r.products, collections: r.collections, home: r.home, notices: r.notices, inspirations: r.inspirations, settings: r.settings };
  loadCart();
  showApp(me);
  loadMyOrders();
}
function cartKey() { return 'zionne_cart_' + (adminPreview ? 'preview' : (me?.id || 0)); }
function loadCart() {
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(cartKey()) || '[]'); } catch { }
  // mantém só produtos ainda ativos e atualiza preço/nome
  cart = saved.map(ci => { const p = data.products.find(x => x.id === ci.id && x.active); return p ? { id: p.id, sku: p.sku, name: p.name, price: p.price, qty: normalizeOrderQty(p, ci.qty) } : null; }).filter(Boolean);
}
function showApp(c) {
  show('appView');
  $('previewBar').classList.toggle('hidden', !adminPreview);
  const validity = c?.validity || '2026-12-31', validDate = new Date(validity + 'T12:00:00'), today = new Date();
  $('clientNameTop').textContent = c?.name || 'Cliente Zionne';
  $('validTop').textContent = 'Válido até ' + validDate.toLocaleDateString('pt-BR');
  $('partnerClientName').textContent = c?.name || 'Cliente Zionne';
  $('partnerValidity').textContent = validDate.toLocaleDateString('pt-BR');
  $('partnerPriceTable').textContent = c?.priceTable || 'Padrão';
  const days = Math.max(0, Math.ceil((new Date(validity + 'T23:59:59') - today) / 86400000));
  $('partnerDays').textContent = days + ' dias restantes';
  const yearStart = new Date(today.getFullYear(), 0, 1), yearEnd = new Date(today.getFullYear(), 11, 31, 23, 59, 59);
  const pct = Math.max(4, Math.min(100, (Math.max(0, new Date(validity + 'T23:59:59') - today) / Math.max(1, yearEnd - yearStart)) * 100));
  $('validityProgress').style.width = pct + '%';
  $('payment').innerHTML = (data.settings.payments?.length ? data.settings.payments : ['A combinar']).map(p => `<option>${esc(p)}</option>`).join('');
  refreshCatalog();
}
function logoutCatalog() {
  if (adminPreview) { openAdmin(); return; }
  localStorage.removeItem(SESS);
  cart = []; me = null;
  $('loginToken').value = '';
  showLogin();
}
function refreshCatalog() { renderHome(); renderFilters(); renderProducts(); updateCart(); renderMyOrders(); }
function goto(id, btn) { document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }); if (btn) { document.querySelectorAll('.side').forEach(x => x.classList.remove('active')); btn.classList.add('active'); } }
function syncSearch(v) { $('search').value = v; goto('catalog'); renderProducts(); }

/* ---------------------------------------------------------------- home */
function renderHome() {
  const h = data.home;
  $('heroTitle').textContent = h.title || ''; $('heroSubtitle').textContent = h.subtitle || ''; $('heroButton').textContent = h.button || 'Ver coleções'; $('collectionsTitle').textContent = h.collectionsTitle || 'Coleções em destaque';
  const hb = $('heroBanner');
  if (h.bannerImage) { hb.classList.add('hasImage'); hb.style.backgroundImage = `url("${h.bannerImage}")`; } else { hb.classList.remove('hasImage'); hb.style.backgroundImage = ''; }
  const fs = data.collections.filter(c => c.active && c.featured).sort((a, b) => a.order - b.order);
  $('collectionCards').innerHTML = fs.map(c => `<article class="collection" onclick="filterCollection(this.dataset.name)" data-name="${esc(c.name)}"><div class="cpic ${c.image ? 'hasImage' : ''}" style="${c.image ? '' : `background:linear-gradient(145deg,${esc(c.color1)},#faf5e9 60%,${esc(c.color2)})`}">${c.image ? `<img src="${esc(c.image)}" alt="${esc(c.name)}" loading="lazy">` : ''}</div><div class="collectionBody"><b>${esc(c.name)}</b>${c.description ? `<span class="collectionDesc">${esc(c.description)}</span>` : ''}<span>Ver coleção →</span></div></article>`).join('');
  $('benefits').innerHTML = (h.benefits || []).filter(b => b.active).map(b => `<div class="benefit"><span class="ico">${esc(b.icon)}</span><div><b>${esc(b.title)}</b><span>${esc(b.text)}</span></div></div>`).join('');
  $('footerInstitutional').innerHTML = esc(data.settings.institutional || '').replace(/\n|\\n/g, '<br>');
  $('footerContact').innerHTML = `<b>Atendimento Comercial</b><br>${formatWhats(data.settings.whats)}<br>${esc(data.settings.email || '')}`;
  renderNotices(); renderInspirations();
}
function todayYMD() { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
function isNoticeVisible(n) { const t = todayYMD(); return n.active && (!n.startDate || t >= n.startDate) && (!n.endDate || t <= n.endDate); }
function noticeCard(n) { return `<article class="noticeCard"><div class="noticeImage">${n.image ? `<img src="${esc(n.image)}" alt="${esc(n.title)}" loading="lazy">` : ''}</div><div class="noticeContent"><div class="noticeKicker">Aviso Zionne</div><h3>${esc(n.title)}</h3><p>${esc(n.description || '')}</p><div class="noticeMeta">${formatPeriod(n.startDate, n.endDate)}</div>${n.link ? `<a class="noticeLink" href="${esc(n.link)}" target="_blank" rel="noopener">Saiba mais →</a>` : ''}</div></article>`; }
function renderNotices() {
  const list = data.notices.filter(isNoticeVisible).sort((a, b) => a.order - b.order);
  $('noticeCards').innerHTML = list.length ? list.map(noticeCard).join('') : `<div class="noticeEmpty" style="grid-column:1/-1">Nenhum aviso ativo no momento.</div>`;
}
function showAllNotices() {
  const list = data.notices.filter(isNoticeVisible).sort((a, b) => a.order - b.order);
  showModal('Avisos e novidades', list.length ? `<div class="noticeGrid" style="grid-template-columns:1fr">${list.map(noticeCard).join('')}</div>` : '<p class="small muted">Nenhum aviso ativo no momento.</p>');
}
function formatPeriod(a, b) {
  const fmt = s => s ? new Date(s + 'T12:00:00').toLocaleDateString('pt-BR') : '';
  if (a && b) return `${fmt(a)} a ${fmt(b)}`; if (a) return `A partir de ${fmt(a)}`; if (b) return `Até ${fmt(b)}`; return 'Período não informado';
}
function inspireCard(x, i) { return `<article class="inspireCard ${i ? 'small' : ''}">${x.image ? `<img src="${esc(x.image)}" alt="${esc(x.title)}" loading="lazy">` : ''}<div class="inspireOverlay"><div class="k">Inspiração Zionne</div><h3>${esc(x.title)}</h3><p>${esc(x.description || '')}</p>${x.linkType !== 'none' ? `<a href="javascript:void(0)" onclick="openInspiration(${x.id})">Ver composição →</a>` : ''}</div></article>`; }
function sortedInspirations() { return data.inspirations.filter(x => x.active).sort((a, b) => (Number(b.featured) - Number(a.featured)) || (a.order - b.order)); }
function renderInspirations() {
  const list = sortedInspirations().slice(0, 3);
  $('inspirationCards').innerHTML = list.length ? list.map(inspireCard).join('') : `<div class="inspireEmpty" style="grid-column:1/-1">Nenhuma inspiração ativa.</div>`;
}
function showAllInspirations() {
  const list = sortedInspirations();
  showModal('Inspire-se com a Zionne', list.length ? `<div style="display:grid;gap:12px">${list.map((x) => inspireCard(x, 0)).join('')}</div>` : '<p class="small muted">Nenhuma inspiração ativa.</p>');
}
function openInspiration(id) {
  const x = data.inspirations.find(a => a.id === id); if (!x) return;
  closeModal();
  if (x.linkType === 'collection' && x.linkValue) { filterCollection(x.linkValue); return; }
  if (x.linkType === 'url' && x.linkValue) { window.open(x.linkValue, '_blank'); return; }
}

/* ---------------------------------------------------------------- catálogo */
function renderFilters() {
  const active = data.collections.filter(c => c.active).sort((a, b) => a.order - b.order);
  const opts = '<option value="">Todas as coleções</option>' + active.map(c => `<option>${esc(c.name)}</option>`).join('');
  ['collectionFilter', 'adminProductCollection'].forEach(id => { const el = $(id); if (el) { const old = el.value; el.innerHTML = opts; el.value = old; } });
}
function filterCollection(name) { $('collectionFilter').value = name || ''; goto('catalog'); renderProducts(); }
function pVisual(p) {
  const click = `onclick="openImageZoom(${p.id})" title="Clique para ampliar"`;
  if (p.image) return `<div class="productImg" ${click}><img src="${esc(p.image)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='block'"><div class="placeholderPlate" style="display:none;color:#557c60"></div></div>`;
  const c = data.collections.find(x => x.name === p.collection) || { color1: '#e8e3d9', color2: '#8d806f' };
  return `<div class="productImg" ${click} style="background:linear-gradient(145deg,${esc(c.color1)},#faf5e9 65%);color:${esc(c.color2)}"><div class="placeholderPlate"></div></div>`;
}
function renderCollectionPurchaseSummary() {
  const box = $('collectionPurchaseSummary'); if (!box) return;
  const cols = data.collections.filter(c => c.active).slice().sort((a, b) => a.order - b.order);
  box.innerHTML = cols.map(c => {
    const lineSku = data.products.filter(p => p.active && p.collection === c.name).length;
    const rows = cart.filter(ci => { const p = data.products.find(x => x.id === ci.id); return p && p.active && p.collection === c.name; });
    const boughtSku = new Set(rows.map(x => x.id)).size, boughtQty = rows.reduce((a, x) => a + Number(x.qty || 0), 0);
    return `<div class="collectionSummaryCard ${boughtQty ? 'hasBuy' : ''}" data-name="${esc(c.name)}" onclick="filterCollection(this.dataset.name)" title="Clique para filtrar esta coleção"><div class="collectionSummaryName">${esc(c.name)}</div><div class="collectionSummaryStats"><div class="collectionSummaryStat"><strong>${lineSku}</strong><span>SKUs linha</span></div><div class="collectionSummaryStat"><strong>${boughtSku}</strong><span>SKUs comprados</span></div><div class="collectionSummaryStat"><strong>${boughtQty}</strong><span>Itens comprados</span></div></div></div>`;
  }).join('');
}
function renderProducts() {
  const el = $('products'); if (!el) return;
  const q = ($('search')?.value || '').toLowerCase(), cf = $('collectionFilter')?.value || '';
  const list = data.products.filter(p => p.active && (!q || p.name.toLowerCase().includes(q) || String(p.sku).includes(q) || (p.collection || '').toLowerCase().includes(q)) && (!cf || p.collection === cf));
  el.innerHTML = list.map(p => {
    const ci = cart.find(x => x.id === p.id), cartQty = ci?.qty || 0, min = Math.max(1, Number(p.minQty) || 1), pack = Math.max(1, Number(p.packQty) || 1);
    return `<article class="product ${cartQty ? 'inCart' : ''}">${pVisual(p)}<div class="productBody"><div class="sku">Cód. ${esc(p.sku)} • ${esc(p.collection)}</div><h3>${esc(p.name)}</h3><div class="desc">${esc(p.description)}</div><div class="priceRow"><span class="price">${BRL(p.price)}</span>${p.stock && p.stock !== 'Disponível' ? `<span class="stock" style="background:#fff2d8;color:#916820">${esc(p.stock)}</span>` : ''}</div><div class="productRules"><span class="productRule">Mínimo: ${min}</span><span class="productRule">Embalagem: ${pack}</span></div><div class="cartSignal ${cartQty ? '' : 'hiddenSignal'}"><span>✓ No carrinho</span><span>${cartQty} un.</span></div><div class="cardItemTotal"><span>Total deste produto</span><strong>${BRL(cartQty * p.price)}</strong></div><div class="add"><input id="q${p.id}" type="number" min="${min}" step="${pack}" value="${min}"><button onclick="addCart(${p.id})">${cartQty ? 'Adicionar mais' : 'Adicionar ao pedido'}</button></div></div></article>`;
  }).join('') || '<p class="muted small">Nenhum produto disponível.</p>';
  renderCollectionPurchaseSummary();
}
function normalizeOrderQty(p, requested) {
  const min = Math.max(1, Number(p.minQty) || 1), pack = Math.max(1, Number(p.packQty) || 1);
  let q = Math.max(min, Number(requested) || min);
  if (q % pack !== 0) q = Math.ceil(q / pack) * pack;
  return q;
}
function openImageZoom(id) {
  const p = data.products.find(x => x.id === Number(id)); if (!p) return;
  if (!p.image) { toast('Este produto ainda não possui uma foto para ampliar.'); return; }
  $('imageZoomTarget').src = p.image; $('imageZoomTarget').alt = p.name;
  $('imageZoomModal').classList.add('on'); document.body.style.overflow = 'hidden';
}
function closeImageZoom(e) {
  if (e && e.target && e.target.id === 'imageZoomTarget') return;
  $('imageZoomModal').classList.remove('on'); $('imageZoomTarget').src = ''; document.body.style.overflow = '';
}

/* ---------------------------------------------------------------- carrinho */
function addCart(id) {
  const p = data.products.find(x => x.id === id); if (!p) return;
  const input = $('q' + id), q = normalizeOrderQty(p, parseInt(input?.value || p.minQty || 1)), e = cart.find(x => x.id === id);
  if (input) input.value = q;
  e ? e.qty += q : cart.push({ id: p.id, sku: p.sku, name: p.name, price: p.price, qty: q });
  saveCart(); toast(`${q} unidade(s) adicionada(s) ao pedido`);
}
function saveCart() { localStorage.setItem(cartKey(), JSON.stringify(cart)); updateCart(); renderProducts(); }
function updateCart() {
  renderCollectionPurchaseSummary();
  const q = cart.reduce((a, x) => a + x.qty, 0), t = cart.reduce((a, x) => a + x.qty * x.price, 0);
  ['cartCount', 'sideCart'].forEach(id => { const e = $(id); if (e) e.textContent = q; });
  $('subtotal').textContent = BRL(t); $('grand').textContent = BRL(t);
  $('cartItems').innerHTML = cart.length ? cart.map(x => `<div class="cartItem"><div><b>${esc(x.name)}</b><small>${esc(x.sku)} • ${BRL(x.price)} un.</small><small class="cartItemTotal">Total: ${BRL(x.price * x.qty)}</small></div><div class="qctrl"><button onclick="changeQ(${x.id},-1)">−</button><span>${x.qty}</span><button onclick="changeQ(${x.id},1)">+</button></div></div>`).join('') : '<div class="muted small" style="text-align:center;padding:45px 5px">Seu pedido ainda está vazio.</div>';
}
function changeQ(id, d) {
  const x = cart.find(i => i.id === id); if (!x) return;
  const p = data.products.find(i => i.id === id), pack = Math.max(1, Number(p?.packQty) || 1), min = Math.max(1, Number(p?.minQty) || 1);
  x.qty += d * pack;
  if (x.qty < min) cart = cart.filter(i => i.id !== id);
  saveCart();
}
function openCart() { $('cart').classList.add('open'); $('overlay').classList.add('on'); }
function closeCart() { $('cart').classList.remove('open'); $('overlay').classList.remove('on'); }
function draftOrder() {
  return { number: 'RASCUNHO', date: new Date().toLocaleDateString('pt-BR'), client: me?.name || '', payment: $('payment').value, obs: $('obs').value, items: cart.map(x => ({ ...x, total: x.qty * x.price })), total: cart.reduce((a, x) => a + x.qty * x.price, 0) };
}
function orderView(o) {
  return { number: o.number, date: new Date(o.created_at).toLocaleDateString('pt-BR'), client: o.client_name, doc: o.client_doc, payment: o.payment, obs: o.obs, items: o.items, total: o.total, status: o.status };
}
function printOrderDoc(o) {
  $('printOrder').innerHTML = `<div class="print"><div class="printHead"><img src="${LOGO}"><div style="text-align:right"><b>PEDIDO ${esc(o.number)}</b><br><small>${esc(o.date)}</small>${o.status ? `<br><small>Status: ${esc(o.status)}</small>` : ''}</div></div><p style="font-size:10px"><b>Cliente:</b> ${esc(o.client)}${o.doc ? ' — ' + esc(o.doc) : ''}<br><b>Condição:</b> ${esc(o.payment)}<br><b>Observação:</b> ${esc(o.obs || '—')}</p><table><thead><tr><th>Código</th><th>Produto</th><th>Qtd.</th><th>Unitário</th><th>Total</th></tr></thead><tbody>${o.items.map(x => `<tr><td>${esc(x.sku)}</td><td>${esc(x.name)}</td><td>${x.qty}</td><td>${BRL(x.price)}</td><td>${BRL(x.price * x.qty)}</td></tr>`).join('')}</tbody></table><div class="ptotal"><div><span>Total</span><b>${BRL(o.total)}</b></div></div></div>`;
  closeCart(); closeModal(); setTimeout(() => window.print(), 150);
}
function printPDF() { if (!cart.length) return toast('Adicione produtos ao pedido'); printOrderDoc(draftOrder()); }
function whatsText(o) {
  const m = ['Olá, Zionne!', 'Segue meu pedido pelo Catálogo Virtual.', '', `Cliente: ${o.client}`, `Pedido: ${o.number}`, `Condição: ${o.payment}`, ''];
  o.items.forEach(x => m.push(`${x.qty}x ${x.sku} - ${x.name} - ${BRL(x.qty * x.price)}`));
  m.push('', `Total: ${BRL(o.total)}`);
  if (o.obs) m.push('', `Obs.: ${o.obs}`);
  return m.join('\n');
}
function sendWhats() { if (!cart.length) return toast('Adicione produtos ao pedido'); openWhats(whatsText(draftOrder())); }
function openWhats(text, phone) { window.open('https://wa.me/' + (phone === undefined ? (data.settings.whats || '') : phone) + '?text=' + encodeURIComponent(text), '_blank'); }
function contactWhats(msg) { openWhats(msg || 'Olá, Zionne! Gostaria de falar com o atendimento comercial.', data.settings.whats || '554130430595'); }
function finalizeOrder() {
  if (!cart.length) return toast('Seu pedido está vazio');
  if (adminPreview) return toast('Pré-visualização: entre como cliente para enviar pedidos.');
  showModal('Confirmar pedido', `<div class="notice">Pedido com ${cart.reduce((a, x) => a + x.qty, 0)} item(ns) no valor de <b>${BRL(cart.reduce((a, x) => a + x.qty * x.price, 0))}</b>.<br>Condição: <b>${esc($('payment').value)}</b></div><p class="small muted">Ao confirmar, o pedido é enviado para a equipe comercial da Zionne.</p><div class="btnRow"><button class="btn" onclick="closeModal()">Voltar</button><button id="btnConfirmOrder" class="btn primary" onclick="confirmOrder()">Confirmar e enviar</button></div>`);
}
async function confirmOrder() {
  const btn = $('btnConfirmOrder'); if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }
  try {
    const o = await api('/api/orders', { method: 'POST', body: { payment: $('payment').value, obs: $('obs').value, items: cart.map(x => ({ id: x.id, qty: x.qty })) } });
    cart = []; saveCart(); $('obs').value = ''; closeCart();
    myOrders.unshift(o); renderMyOrders();
    showModal('Pedido enviado ✓', `<div class="notice">Pedido <b>${esc(o.number)}</b> recebido pela Zionne no valor de <b>${BRL(o.total)}</b>. Você pode acompanhar o andamento em "Meus pedidos".</div><div class="btnRow"><button class="btn" onclick="printMyOrder(${o.id})">Gerar PDF</button><button class="btn" onclick="whatsMyOrder(${o.id})">Enviar pelo WhatsApp</button><button class="btn primary" onclick="closeModal()">Fechar</button></div>`);
  } catch (e) {
    toast(e.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Confirmar e enviar'; }
    if (e.status === 401) setTimeout(() => showLogin(e.message), 900);
  }
}

/* ---------------------------------------------------------------- meus pedidos */
function statusTag(s) {
  const cls = { 'Recebido': 'warn', 'Em análise': 'warn', 'Em separação': 'blue', 'Faturado': 'on', 'Cancelado': 'red' }[s] || 'off';
  return `<span class="tag ${cls}">${esc(s)}</span>`;
}
async function loadMyOrders(notify) {
  if (adminPreview) { myOrders = []; renderMyOrders(); return; }
  try { myOrders = await api('/api/orders/mine'); renderMyOrders(); if (notify) toast('Pedidos atualizados'); }
  catch (e) { if (e.status === 401) showLogin(e.message); }
}
function renderMyOrders() {
  const open = myOrders.filter(o => !['Faturado', 'Cancelado'].includes(o.status)).length;
  ['sideOrders', 'topOrders'].forEach(id => { const e = $(id); if (e) e.textContent = open; });
  $('myOrdersBody').innerHTML = myOrders.length ? myOrders.map(o => `<tr><td><b>${esc(o.number)}</b></td><td>${new Date(o.created_at).toLocaleDateString('pt-BR')}</td><td>${o.items.reduce((a, x) => a + x.qty, 0)}</td><td>${BRL(o.total)}</td><td>${esc(o.payment)}</td><td>${statusTag(o.status)}</td><td class="actionsCell"><button class="link" onclick="viewMyOrder(${o.id})">Visualizar</button><button class="link" onclick="printMyOrder(${o.id})">PDF</button></td></tr>`).join('') : `<tr><td colspan="7" class="muted" style="text-align:center;padding:24px">${adminPreview ? 'Pré-visualização: os pedidos do cliente aparecem aqui.' : 'Você ainda não enviou pedidos pelo catálogo.'}</td></tr>`;
}
function orderItemsTable(items) {
  return `<table class="orderItems"><thead><tr><th>Código</th><th>Produto</th><th>Qtd.</th><th>Unitário</th><th>Total</th></tr></thead><tbody>${items.map(x => `<tr><td>${esc(x.sku)}</td><td>${esc(x.name)}</td><td>${x.qty}</td><td>${BRL(x.price)}</td><td>${BRL(x.price * x.qty)}</td></tr>`).join('')}</tbody></table>`;
}
function viewMyOrder(id) {
  const o = myOrders.find(x => x.id === id); if (!o) return;
  showModal('Pedido ' + o.number, `<p class="small">Data: <b>${new Date(o.created_at).toLocaleString('pt-BR')}</b> • Condição: <b>${esc(o.payment)}</b> • Status: ${statusTag(o.status)}</p>${o.obs ? `<p class="small muted">Obs.: ${esc(o.obs)}</p>` : ''}${orderItemsTable(o.items)}<div class="total" style="margin-top:10px"><span>Total</span><b class="grand">${BRL(o.total)}</b></div><div class="btnRow"><button class="btn" onclick="repeatOrder(${o.id})">Repetir pedido</button><button class="btn" onclick="whatsMyOrder(${o.id})">WhatsApp</button><button class="btn primary" onclick="printMyOrder(${o.id})">Gerar PDF</button></div>`);
}
function printMyOrder(id) { const o = myOrders.find(x => x.id === id); if (o) printOrderDoc(orderView(o)); }
function whatsMyOrder(id) { const o = myOrders.find(x => x.id === id); if (o) openWhats(whatsText(orderView(o))); }
function repeatOrder(id) {
  const o = myOrders.find(x => x.id === id); if (!o) return;
  let added = 0;
  o.items.forEach(it => { const p = data.products.find(x => x.id === it.id && x.active); if (!p) return; const e = cart.find(x => x.id === p.id); e ? e.qty += it.qty : cart.push({ id: p.id, sku: p.sku, name: p.name, price: p.price, qty: normalizeOrderQty(p, it.qty) }); added++; });
  saveCart(); closeModal(); openCart();
  toast(added ? `${added} produto(s) adicionados com o preço atual` : 'Nenhum produto deste pedido está disponível');
}

/* ================================================================ ADMIN */
function requestAdminLogin() {
  if (localStorage.getItem(ASESS)) { openAdmin(); return; }
  show(me ? 'appView' : 'loginView');
  showModal('Acesso Administrativo', `<div class="adminLoginBox"><img class="adminLoginLogo" src="${LOGO}"><p class="small muted">Área exclusiva para a equipe Zionne. Informe usuário e senha.</p><div class="field"><label>Usuário</label><input id="admLoginUser" autocomplete="username"></div><div class="field"><label>Senha</label><input id="admLoginPass" type="password" autocomplete="current-password" onkeydown="if(event.key==='Enter')validateAdminLogin()"></div><div id="admLoginError" class="error hidden"></div><button id="admLoginBtn" class="btn primary" style="width:100%" onclick="validateAdminLogin()">Entrar na Administração</button></div>`);
  setTimeout(() => $('admLoginUser')?.focus(), 80);
}
async function validateAdminLogin() {
  const err = $('admLoginError'), btn = $('admLoginBtn');
  btn.disabled = true;
  try {
    const r = await api('/api/admin/login', { method: 'POST', body: { user: $('admLoginUser').value.trim(), password: $('admLoginPass').value } });
    localStorage.setItem(ASESS, r.session); closeModal(); await openAdmin();
  } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); btn.disabled = false; }
}
async function openAdmin() {
  try {
    const r = await api('/api/admin/data', { admin: true });
    data = r.content; clients = r.clients; adminUser = r.adminUser; orderStatus = r.orderStatus;
    adminPreview = false;
    show('adminView');
    if (location.pathname !== '/admin') history.replaceState(null, '', '/admin');
    refreshAdmin();
    loadAdminOrders();
  } catch (e) {
    toast(e.message);
    if (e.status === 401) { localStorage.removeItem(ASESS); requestAdminLogin(); }
  }
}
function logoutAdmin() { localStorage.removeItem(ASESS); history.replaceState(null, '', '/'); start(); }
function previewCatalog() {
  adminPreview = true;
  me = { name: 'Pré-visualização (Admin)', validity: new Date(new Date().getFullYear(), 11, 31).toISOString().slice(0, 10), priceTable: '—' };
  loadCart(); showApp(me); myOrders = []; renderMyOrders();
}
function refreshAdmin() { renderFilters(); renderAdminProducts(); renderAdminCollections(); renderAdminNotices(); renderAdminInspirations(); renderHomeAdmin(); renderClients(); renderSettings(); renderDashboard(); renderAdminOrders(); }
function adminTab(id, btn) { document.querySelectorAll('.adminSection').forEach(s => s.classList.remove('active')); $(id).classList.add('active'); document.querySelectorAll('.adminSide button').forEach(b => b.classList.remove('active')); btn.classList.add('active'); if (id === 'ordersAdmin') loadAdminOrders(); }

let saving = Promise.resolve();
function saveData(msg) {
  saving = saving.then(async () => {
    try {
      const r = await api('/api/admin/content', { method: 'PUT', admin: true, body: { content: data } });
      data = r.content; refreshAdmin(); if (msg) toast(msg); return true;
    } catch (e) {
      toast('Não foi possível salvar: ' + e.message);
      if (e.status === 401) requestAdminLogin(); else openAdmin();
      return false;
    }
  });
  return saving;
}
async function saveClients(msg) {
  try { const r = await api('/api/admin/clients', { method: 'PUT', admin: true, body: { clients } }); clients = r.clients; renderClients(); renderDashboard(); if (msg) toast(msg); return true; }
  catch (e) { toast('Não foi possível salvar: ' + e.message); const r = await api('/api/admin/data', { admin: true }).catch(() => null); if (r) { clients = r.clients; renderClients(); } return false; }
}
function renderDashboard() {
  $('mProducts').textContent = data.products.filter(p => p.active).length;
  $('mCollections').textContent = data.collections.filter(c => c.active).length;
  $('mOrdersNew').textContent = adminOrders.filter(o => o.status === 'Recebido').length;
  $('mClients').textContent = clients.filter(c => c.active).length;
  $('adminNoticeCount').textContent = data.notices.filter(n => n.active).length;
  $('adminInspireCount').textContent = data.inspirations.filter(n => n.active).length;
  $('adminOrdersCount').textContent = adminOrders.filter(o => o.status === 'Recebido').length;
  $('siteUrl').textContent = location.origin + '/';
}
function nextId(list) { return Math.max(0, ...list.map(x => Number(x.id) || 0)) + 1; }

/* imagem genérica: envia arquivo e devolve URL */
async function handleUpload(e, previewId, cb) {
  const f = e.target.files?.[0]; if (!f) return;
  const pv = $(previewId); if (pv) pv.innerHTML = 'Enviando imagem...';
  try { const url = await uploadImage(f); cb(url); if (pv) pv.innerHTML = `<img src="${esc(url)}">`; toast('Imagem enviada'); }
  catch (err) { if (pv) pv.innerHTML = 'Falha no envio'; toast(err.message); }
}

/* ---------------------------------------------------------------- pedidos (admin) */
async function loadAdminOrders() {
  try { adminOrders = await api('/api/admin/orders', { admin: true }); renderAdminOrders(); renderDashboard(); } catch (e) { if (e.status === 401) requestAdminLogin(); }
}
function renderAdminOrders() {
  const sel = $('adminOrderStatus');
  if (sel && sel.options.length <= 1) sel.innerHTML = '<option value="">Todos os status</option>' + orderStatus.map(s => `<option>${esc(s)}</option>`).join('');
  const q = ($('adminOrderSearch')?.value || '').toLowerCase(), st = sel?.value || '';
  const list = adminOrders.filter(o => (!st || o.status === st) && (!q || (o.number || '').toLowerCase().includes(q) || (o.client_name || '').toLowerCase().includes(q) || (o.client_doc || '').includes(q)));
  $('adminOrdersBody').innerHTML = list.length ? list.map(o => `<tr><td><b>${esc(o.number)}</b></td><td>${new Date(o.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td><td><b>${esc(o.client_name)}</b><br><span class="muted">${esc(o.client_doc || '')}</span></td><td>${o.items.reduce((a, x) => a + x.qty, 0)}</td><td><b>${BRL(o.total)}</b></td><td>${esc(o.payment)}</td><td><select class="statusSel" onchange="setOrderStatus(${o.id},this.value)">${orderStatus.map(s => `<option ${s === o.status ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></td><td class="actionsCell"><button onclick="viewAdminOrder(${o.id})">Ver</button><button onclick="printAdminOrder(${o.id})">PDF</button><button class="red" onclick="deleteAdminOrder(${o.id})">Excluir</button></td></tr>`).join('') : '<tr><td colspan="8" class="muted" style="text-align:center;padding:24px">Nenhum pedido encontrado.</td></tr>';
}
async function setOrderStatus(id, status) {
  try { await api('/api/admin/orders/' + id, { method: 'PATCH', admin: true, body: { status } }); const o = adminOrders.find(x => x.id === id); if (o) o.status = status; renderDashboard(); toast('Status atualizado: ' + status); }
  catch (e) { toast(e.message); loadAdminOrders(); }
}
function viewAdminOrder(id) {
  const o = adminOrders.find(x => x.id === id); if (!o) return;
  showModal('Pedido ' + o.number, `<p class="small">Cliente: <b>${esc(o.client_name)}</b> — ${esc(o.client_doc || '')} • Tabela: ${esc(o.price_table || '—')}<br>Data: <b>${new Date(o.created_at).toLocaleString('pt-BR')}</b> • Condição: <b>${esc(o.payment)}</b> • Status: ${statusTag(o.status)}</p>${o.obs ? `<div class="notice">Obs.: ${esc(o.obs)}</div>` : ''}${orderItemsTable(o.items)}<div class="total" style="margin-top:10px"><span>Total</span><b class="grand">${BRL(o.total)}</b></div><div class="btnRow"><button class="btn primary" onclick="printAdminOrder(${o.id})">Gerar PDF</button></div>`);
}
function printAdminOrder(id) { const o = adminOrders.find(x => x.id === id); if (o) printOrderDoc(orderView(o)); }
async function deleteAdminOrder(id) {
  const o = adminOrders.find(x => x.id === id);
  if (!confirm(`Excluir definitivamente o pedido ${o?.number}? Prefira usar o status "Cancelado" para manter histórico.`)) return;
  try { await api('/api/admin/orders/' + id, { method: 'DELETE', admin: true }); adminOrders = adminOrders.filter(x => x.id !== id); renderAdminOrders(); renderDashboard(); toast('Pedido excluído'); } catch (e) { toast(e.message); }
}
function exportOrdersCsv() { window.open('/api/admin/orders.csv?session=' + encodeURIComponent(localStorage.getItem(ASESS) || ''), '_blank'); }

/* ---------------------------------------------------------------- produtos */
function renderAdminProducts() {
  const body = $('adminProductsBody'); if (!body) return;
  const q = ($('adminProductSearch')?.value || '').toLowerCase(), cf = $('adminProductCollection')?.value || '';
  const list = data.products.filter(p => (!q || p.name.toLowerCase().includes(q) || String(p.sku).includes(q)) && (!cf || p.collection === cf));
  body.innerHTML = list.map(p => `<tr><td>${p.image ? `<img class="thumb" src="${esc(p.image)}" loading="lazy">` : `<div class="thumb"></div>`}</td><td>${esc(p.sku)}</td><td><b>${esc(p.name)}</b></td><td>${esc(p.collection)}</td><td>${BRL(p.price)}</td><td>${p.minQty || 1}</td><td>${p.packQty || 1}</td><td><span class="tag ${p.active ? 'on' : 'off'}">${p.active ? 'Ativo' : 'Fora de linha'}</span></td><td class="actionsCell"><button onclick="editProduct(${p.id})">Editar</button><button onclick="toggleProduct(${p.id})">${p.active ? 'Fora de linha' : 'Ativar'}</button><button class="red" onclick="deleteProduct(${p.id})">Excluir</button></td></tr>`).join('');
}
let tempImage = '';
function productForm(p = {}) {
  const opts = data.collections.slice().sort((a, b) => a.order - b.order).map(c => `<option ${p.collection === c.name ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  return `<div class="grid2"><div><div class="field"><label>Código</label><input id="pfSku" value="${esc(p.sku || '')}"></div><div class="field"><label>Nome do produto</label><input id="pfName" value="${esc(p.name || '')}"></div><div class="field"><label>Coleção</label><select id="pfCollection">${opts}</select></div><div class="grid2"><div class="field"><label>Preço</label><input id="pfPrice" type="number" step="0.01" value="${p.price ?? ''}"></div><div class="field"><label>Estoque</label><select id="pfStock">${['Disponível', 'Baixo estoque', 'Sob encomenda', 'Esgotado'].map(s => `<option ${p.stock === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div></div><div class="field"><label>Descrição</label><textarea id="pfDesc" rows="3">${esc(p.description || '')}</textarea></div><div class="grid2"><div class="field"><label>Quantidade mínima</label><input id="pfMinQty" type="number" min="1" value="${p.minQty || 1}"></div><div class="field"><label>Embalagem / múltiplo</label><input id="pfPackQty" type="number" min="1" value="${p.packQty || 1}"></div></div><p class="small muted">Ex.: mínimo 6 e embalagem 6 → cliente compra 6, 12, 18...</p><label class="checkRow"><input id="pfActive" type="checkbox" ${p.active !== false ? 'checked' : ''}> Produto ativo</label></div><div><div class="field"><label>URL da imagem</label><input id="pfImage" value="${esc(p.image || '')}" oninput="previewPF()"></div><div class="field"><label>Ou enviar foto</label><input id="pfFile" type="file" accept="image/*" onchange="handleUpload(event,'pfPreview',u=>{tempImage=u;$('pfImage').value=u})"></div><div class="imagePreview" id="pfPreview">${p.image ? `<img src="${esc(p.image)}">` : 'Sem imagem'}</div><p class="small muted">A foto é otimizada automaticamente no servidor.</p></div></div><div style="text-align:right;margin-top:14px"><button class="btn primary" onclick="saveProduct(${p.id || 0})">Salvar produto</button></div>`;
}
function newProduct() { tempImage = ''; showModal('Novo produto', productForm({ active: true })); }
function editProduct(id) { const p = data.products.find(x => x.id === id); tempImage = p.image || ''; showModal('Editar produto', productForm(p)); }
function previewPF() { tempImage = $('pfImage').value.trim(); $('pfPreview').innerHTML = tempImage ? `<img src="${esc(tempImage)}">` : 'Sem imagem'; }
function saveProduct(id) {
  const obj = { sku: $('pfSku').value.trim(), name: $('pfName').value.trim(), collection: $('pfCollection').value, price: Number($('pfPrice').value || 0), stock: $('pfStock').value, description: $('pfDesc').value.trim(), minQty: Math.max(1, Number($('pfMinQty').value || 1)), packQty: Math.max(1, Number($('pfPackQty').value || 1)), active: $('pfActive').checked, image: $('pfImage').value.trim() };
  if (!obj.sku || !obj.name) return toast('Informe código e nome');
  if (data.products.some(x => x.sku === obj.sku && x.id !== id)) return toast('Já existe um produto com este código');
  if (id) Object.assign(data.products.find(x => x.id === id), obj); else { obj.id = nextId(data.products); data.products.push(obj); }
  closeModal(); saveData('Produto salvo e publicado');
}
function toggleProduct(id) { const p = data.products.find(x => x.id === id); p.active = !p.active; saveData(p.active ? 'Produto ativado' : 'Produto marcado fora de linha'); }
function deleteProduct(id) { if (!confirm('Excluir este produto? Para histórico, prefira usar Fora de linha.')) return; data.products = data.products.filter(x => x.id !== id); saveData('Produto excluído'); }

/* ---------------------------------------------------------------- coleções */
function renderAdminCollections() {
  $('adminCollectionsBody').innerHTML = data.collections.slice().sort((a, b) => a.order - b.order).map(c => `<tr><td>${c.image ? `<img class="collectionThumb" src="${esc(c.image)}" loading="lazy">` : `<div class="collectionThumbEmpty"></div>`}</td><td>${c.order}</td><td><b>${esc(c.name)}</b></td><td>${esc(c.description || '')}</td><td>${data.products.filter(p => p.collection === c.name).length}</td><td><span class="tag ${c.featured ? 'on' : 'off'}">${c.featured ? 'Sim' : 'Não'}</span></td><td><span class="tag ${c.active ? 'on' : 'off'}">${c.active ? 'Ativa' : 'Inativa'}</span></td><td class="actionsCell"><button onclick="editCollection(${c.id})">Editar</button><button onclick="toggleFeatured(${c.id})">${c.featured ? 'Remover destaque' : 'Destacar'}</button><button onclick="toggleCollection(${c.id})">${c.active ? 'Desativar' : 'Ativar'}</button></td></tr>`).join('');
}
let tempCollectionImage = '';
function collectionForm(c = {}) {
  tempCollectionImage = c.image || '';
  return `<div class="grid2"><div><div class="field"><label>Nome da coleção</label><input id="cfName" value="${esc(c.name || '')}"></div><div class="field"><label>Descrição da coleção</label><textarea id="cfDescription" rows="3" placeholder="Texto exibido no destaque da coleção">${esc(c.description || '')}</textarea></div><div class="field"><label>Ordem</label><input id="cfOrder" type="number" value="${c.order || data.collections.length + 1}"></div><label class="checkRow"><input id="cfFeatured" type="checkbox" ${c.featured ? 'checked' : ''}> Exibir em destaque na Home</label><br><label class="checkRow"><input id="cfActive" type="checkbox" ${c.active !== false ? 'checked' : ''}> Coleção ativa</label><div class="grid2" style="margin-top:10px"><div class="field"><label>Cor base</label><input id="cfColor1" type="color" value="${c.color1 || '#d8e5c9'}"></div><div class="field"><label>Cor de destaque</label><input id="cfColor2" type="color" value="${c.color2 || '#75a064'}"></div></div></div><div><div class="field"><label>URL da imagem da coleção</label><input id="cfImageUrl" value="${esc(c.image || '')}" placeholder="https://..." oninput="tempCollectionImage=this.value.trim();$('cfImagePreview').innerHTML=tempCollectionImage?'<img src=&quot;'+tempCollectionImage+'&quot;>':'Sem imagem'"></div><div class="field"><label>Ou enviar imagem</label><input type="file" accept="image/*" onchange="handleUpload(event,'cfImagePreview',u=>{tempCollectionImage=u;$('cfImageUrl').value=u})"></div><div id="cfImagePreview" class="collectionImagePreview">${c.image ? `<img src="${esc(c.image)}">` : 'Sem imagem'}</div></div></div><div style="text-align:right;margin-top:12px"><button class="btn primary" onclick="saveCollection(${c.id || 0})">Salvar coleção</button></div>`;
}
function newCollection() { showModal('Nova coleção', collectionForm({ active: true, featured: false })); }
function editCollection(id) { showModal('Editar coleção', collectionForm(data.collections.find(x => x.id === id))); }
function saveCollection(id) {
  const name = $('cfName').value.trim();
  if (!name) return toast('Informe o nome da coleção');
  if (data.collections.some(x => x.name.toLowerCase() === name.toLowerCase() && x.id !== id)) return toast('Já existe uma coleção com este nome');
  const obj = { name, description: $('cfDescription').value.trim(), order: Number($('cfOrder').value || 1), featured: $('cfFeatured').checked, active: $('cfActive').checked, color1: $('cfColor1').value, color2: $('cfColor2').value, image: $('cfImageUrl').value.trim() || tempCollectionImage };
  if (id) {
    const cur = data.collections.find(x => x.id === id), oldName = cur.name;
    Object.assign(cur, obj);
    if (oldName !== name) { data.products.filter(p => p.collection === oldName).forEach(p => p.collection = name); data.inspirations.filter(x => x.linkValue === oldName).forEach(x => x.linkValue = name); }
  } else { obj.id = nextId(data.collections); data.collections.push(obj); }
  closeModal(); saveData('Coleção salva e publicada');
}
function toggleFeatured(id) { const c = data.collections.find(x => x.id === id); c.featured = !c.featured; saveData('Destaques atualizados'); }
function toggleCollection(id) { const c = data.collections.find(x => x.id === id); c.active = !c.active; saveData(c.active ? 'Coleção ativada' : 'Coleção desativada'); }

/* ---------------------------------------------------------------- avisos */
function renderAdminNotices() {
  $('adminNoticesBody').innerHTML = data.notices.slice().sort((a, b) => a.order - b.order).map(n => `<tr><td>${n.image ? `<img class="listThumbWide" src="${esc(n.image)}">` : `<div class="listThumbWide"></div>`}</td><td><b>${esc(n.title)}</b><br><span class="muted">${esc((n.description || '').slice(0, 55))}</span></td><td>${formatPeriod(n.startDate, n.endDate)}</td><td>${n.order}</td><td><span class="tag ${isNoticeVisible(n) ? 'on' : n.active ? 'warn' : 'off'}">${isNoticeVisible(n) ? 'Exibindo' : n.active ? 'Fora do período' : 'Inativo'}</span></td><td class="actionsCell"><button onclick="editNotice(${n.id})">Editar</button><button onclick="toggleNotice(${n.id})">${n.active ? 'Desativar' : 'Ativar'}</button><button class="red" onclick="deleteNotice(${n.id})">Excluir</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted" style="text-align:center;padding:20px">Nenhum aviso cadastrado.</td></tr>';
}
let tempNoticeImage = '';
function noticeForm(n = {}) {
  tempNoticeImage = n.image || '';
  return `<div class="grid2"><div><div class="field"><label>Título</label><input id="nfTitle" value="${esc(n.title || '')}"></div><div class="field"><label>Descrição</label><textarea id="nfDesc" rows="4">${esc(n.description || '')}</textarea></div><div class="grid2"><div class="field"><label>Data inicial</label><input id="nfStart" type="date" value="${n.startDate || ''}"></div><div class="field"><label>Data final</label><input id="nfEnd" type="date" value="${n.endDate || ''}"></div></div><div class="field"><label>Ordem</label><input id="nfOrder" type="number" value="${n.order || 1}"></div><div class="field"><label>Link opcional</label><input id="nfLink" value="${esc(n.link || '')}" placeholder="https://..."></div><label class="checkRow"><input id="nfActive" type="checkbox" ${n.active !== false ? 'checked' : ''}> Aviso ativo</label></div><div><div class="field"><label>URL da imagem</label><input id="nfImageUrl" value="${esc(n.image || '')}" oninput="tempNoticeImage=this.value.trim();$('nfPreview').innerHTML=tempNoticeImage?'<img src=&quot;'+tempNoticeImage+'&quot;>':'Sem imagem'"></div><div class="field"><label>Ou enviar imagem</label><input type="file" accept="image/*" onchange="handleUpload(event,'nfPreview',u=>{tempNoticeImage=u;$('nfImageUrl').value=u})"></div><div id="nfPreview" class="adminImagePreviewLarge">${n.image ? `<img src="${esc(n.image)}">` : 'Sem imagem'}</div></div></div><div style="text-align:right;margin-top:13px"><button class="btn primary" onclick="saveNotice(${n.id || 0})">Salvar aviso</button></div>`;
}
function newNotice() { showModal('Novo aviso / campanha', noticeForm({ active: true, order: data.notices.length + 1 })); }
function editNotice(id) { showModal('Editar aviso / campanha', noticeForm(data.notices.find(x => x.id === id))); }
function saveNotice(id) {
  const obj = { title: $('nfTitle').value.trim(), description: $('nfDesc').value.trim(), startDate: $('nfStart').value, endDate: $('nfEnd').value, order: Number($('nfOrder').value || 1), link: $('nfLink').value.trim(), active: $('nfActive').checked, image: $('nfImageUrl').value.trim() || tempNoticeImage };
  if (!obj.title) return toast('Informe o título do aviso');
  if (id) Object.assign(data.notices.find(x => x.id === id), obj); else { obj.id = nextId(data.notices); data.notices.push(obj); }
  closeModal(); saveData('Aviso publicado na Home');
}
function toggleNotice(id) { const n = data.notices.find(x => x.id === id); n.active = !n.active; saveData(n.active ? 'Aviso ativado' : 'Aviso desativado'); }
function deleteNotice(id) { if (!confirm('Excluir este aviso?')) return; data.notices = data.notices.filter(x => x.id !== id); saveData('Aviso excluído'); }

/* ---------------------------------------------------------------- inspirações */
function renderAdminInspirations() {
  $('adminInspirationsBody').innerHTML = data.inspirations.slice().sort((a, b) => a.order - b.order).map(x => `<tr><td>${x.image ? `<img class="listThumbWide" src="${esc(x.image)}">` : `<div class="listThumbWide"></div>`}</td><td><b>${esc(x.title)}</b><br><span class="muted">${esc((x.description || '').slice(0, 55))}</span></td><td>${esc(x.linkType === 'collection' ? (x.linkValue || 'Coleção') : x.linkType === 'url' ? 'URL externa' : 'Sem link')}</td><td>${x.order}</td><td><span class="tag ${x.featured ? 'on' : 'off'}">${x.featured ? 'Sim' : 'Não'}</span></td><td><span class="tag ${x.active ? 'on' : 'off'}">${x.active ? 'Ativa' : 'Inativa'}</span></td><td class="actionsCell"><button onclick="editInspiration(${x.id})">Editar</button><button onclick="toggleInspiration(${x.id})">${x.active ? 'Desativar' : 'Ativar'}</button><button class="red" onclick="deleteInspiration(${x.id})">Excluir</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted" style="text-align:center;padding:20px">Nenhuma inspiração cadastrada.</td></tr>';
}
let tempInspireImage = '';
function inspirationForm(x = {}) {
  tempInspireImage = x.image || '';
  const opts = data.collections.filter(c => c.active).map(c => `<option ${x.linkValue === c.name ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  return `<div class="grid2"><div><div class="field"><label>Título</label><input id="ifTitle" value="${esc(x.title || '')}"></div><div class="field"><label>Descrição</label><textarea id="ifDesc" rows="4">${esc(x.description || '')}</textarea></div><div class="field"><label>Tipo de link</label><select id="ifLinkType" onchange="toggleInspirationLinkFields()"><option value="collection" ${x.linkType === 'collection' ? 'selected' : ''}>Coleção</option><option value="url" ${x.linkType === 'url' ? 'selected' : ''}>URL externa</option><option value="none" ${x.linkType === 'none' ? 'selected' : ''}>Sem link</option></select></div><div id="ifCollectionWrap" class="field"><label>Coleção relacionada</label><select id="ifCollection">${opts}</select></div><div id="ifUrlWrap" class="field hidden"><label>URL</label><input id="ifUrl" value="${x.linkType === 'url' ? esc(x.linkValue || '') : ''}"></div><div class="field"><label>Ordem</label><input id="ifOrder" type="number" value="${x.order || 1}"></div><label class="checkRow"><input id="ifFeatured" type="checkbox" ${x.featured ? 'checked' : ''}> Destaque</label><br><label class="checkRow"><input id="ifActive" type="checkbox" ${x.active !== false ? 'checked' : ''}> Inspiração ativa</label></div><div><div class="field"><label>URL da imagem</label><input id="ifImageUrl" value="${esc(x.image || '')}" oninput="tempInspireImage=this.value.trim();$('ifPreview').innerHTML=tempInspireImage?'<img src=&quot;'+tempInspireImage+'&quot;>':'Sem imagem'"></div><div class="field"><label>Ou enviar imagem</label><input type="file" accept="image/*" onchange="handleUpload(event,'ifPreview',u=>{tempInspireImage=u;$('ifImageUrl').value=u})"></div><div id="ifPreview" class="adminImagePreviewLarge">${x.image ? `<img src="${esc(x.image)}">` : 'Sem imagem'}</div></div></div><div style="text-align:right;margin-top:13px"><button class="btn primary" onclick="saveInspiration(${x.id || 0})">Salvar inspiração</button></div>`;
}
function newInspiration() { showModal('Nova inspiração / mesa posta', inspirationForm({ active: true, featured: false, order: data.inspirations.length + 1, linkType: 'collection' })); setTimeout(toggleInspirationLinkFields, 20); }
function editInspiration(id) { showModal('Editar inspiração', inspirationForm(data.inspirations.find(a => a.id === id))); setTimeout(toggleInspirationLinkFields, 20); }
function toggleInspirationLinkFields() { const t = $('ifLinkType')?.value; if (!t) return; $('ifCollectionWrap').classList.toggle('hidden', t !== 'collection'); $('ifUrlWrap').classList.toggle('hidden', t !== 'url'); }
function saveInspiration(id) {
  const lt = $('ifLinkType').value; let lv = ''; if (lt === 'collection') lv = $('ifCollection').value; if (lt === 'url') lv = $('ifUrl').value.trim();
  const obj = { title: $('ifTitle').value.trim(), description: $('ifDesc').value.trim(), linkType: lt, linkValue: lv, order: Number($('ifOrder').value || 1), featured: $('ifFeatured').checked, active: $('ifActive').checked, image: $('ifImageUrl').value.trim() || tempInspireImage };
  if (!obj.title) return toast('Informe o título');
  if (id) Object.assign(data.inspirations.find(x => x.id === id), obj); else { obj.id = nextId(data.inspirations); data.inspirations.push(obj); }
  closeModal(); saveData('Inspiração publicada na Home');
}
function toggleInspiration(id) { const x = data.inspirations.find(a => a.id === id); x.active = !x.active; saveData(x.active ? 'Inspiração ativada' : 'Inspiração desativada'); }
function deleteInspiration(id) { if (!confirm('Excluir esta inspiração?')) return; data.inspirations = data.inspirations.filter(x => x.id !== id); saveData('Inspiração excluída'); }

/* ---------------------------------------------------------------- home (admin) */
let tempBannerImage = '';
function renderHomeAdmin() {
  const h = data.home;
  $('homeTitle').value = h.title || ''; $('homeSubtitle').value = h.subtitle || ''; $('homeButton').value = h.button || ''; $('homeCollectionsTitle').value = h.collectionsTitle || ''; $('homeBannerUrl').value = h.bannerImage || '';
  tempBannerImage = h.bannerImage || ''; pv(); previewBannerAdmin();
  ['homeTitle', 'homeSubtitle', 'homeButton'].forEach(id => { $(id).oninput = () => { pv(); }; });
  $('benefitEditor').innerHTML = (h.benefits || []).map((b, i) => `<div class="formCard"><div class="field"><label>Ícone</label><input id="bi${i}" value="${esc(b.icon)}"></div><div class="field"><label>Título</label><input id="bt${i}" value="${esc(b.title)}"></div><div class="field"><label>Descrição</label><input id="bx${i}" value="${esc(b.text)}"></div><label class="checkRow"><input id="ba${i}" type="checkbox" ${b.active ? 'checked' : ''}> Exibir</label></div>`).join('');
}
function previewBannerAdmin() { const img = tempBannerImage; $('bannerPreview').style.backgroundImage = img ? `url("${img}")` : 'linear-gradient(120deg,#f7f1e6,#dce3ce)'; }
function loadBannerFile(e) { handleUpload(e, null, u => { tempBannerImage = u; $('homeBannerUrl').value = u; previewBannerAdmin(); }); }
function clearBannerImage() { tempBannerImage = ''; $('homeBannerUrl').value = ''; previewBannerAdmin(); }
function pv() { $('pvTitle').textContent = $('homeTitle').value; $('pvSubtitle').textContent = $('homeSubtitle').value; $('pvButton').textContent = $('homeButton').value; }
function saveHome() {
  const h = data.home;
  h.title = $('homeTitle').value; h.subtitle = $('homeSubtitle').value; h.button = $('homeButton').value; h.collectionsTitle = $('homeCollectionsTitle').value; h.bannerImage = $('homeBannerUrl').value.trim() || tempBannerImage;
  h.benefits = h.benefits.map((b, i) => ({ icon: $('bi' + i).value, title: $('bt' + i).value, text: $('bx' + i).value, active: $('ba' + i).checked }));
  saveData('Página inicial publicada');
}

/* ---------------------------------------------------------------- clientes */
let lastGeneratedToken = '';
function normalizeDoc(v) { return (v || '').replace(/\D/g, ''); }
async function serverToken(doc, validity) { const r = await api('/api/admin/token', { method: 'POST', admin: true, body: { doc, validity } }); return r.token; }
async function generateTokenFromDocValidity() {
  const doc = normalizeDoc($('tgDoc').value), validity = $('tgValidity').value;
  if (!doc || !validity) return toast('Informe CNPJ/CPF e validade.');
  try { lastGeneratedToken = await serverToken(doc, validity); $('tgResult').textContent = lastGeneratedToken; $('tgResultWrap').classList.remove('hidden'); } catch (e) { toast(e.message); }
}
function useGeneratedTokenInClient() {
  if (!lastGeneratedToken) return toast('Gere um token primeiro.');
  showModal('Novo cliente / token', clientForm({ active: true, name: $('tgName').value.trim(), docDisplay: $('tgDoc').value.trim(), token: lastGeneratedToken, validity: $('tgValidity').value, priceTable: 'Revenda Premium' }));
}
function renderClients() {
  const b = $('clientsBody'); if (!b) return;
  const q = ($('adminClientSearch')?.value || '').toLowerCase(), qd = normalizeDoc(q);
  const list = clients.filter(c => !q || (c.name || '').toLowerCase().includes(q) || (qd && (c.doc || '').includes(qd)));
  const today = todayYMD();
  b.innerHTML = list.map(c => { const expired = c.validity < today; return `<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.docDisplay || c.doc)}</td><td style="font-family:Consolas">${esc(c.token)}</td><td>${new Date(c.validity + 'T12:00:00').toLocaleDateString('pt-BR')}</td><td>${esc(c.priceTable || 'Padrão')}</td><td><span class="tag ${!c.active ? 'off' : expired ? 'warn' : 'on'}">${!c.active ? 'Bloqueado' : expired ? 'Vencido' : 'Ativo'}</span></td><td class="actionsCell"><button onclick="shareClient(${c.id})">Link / WhatsApp</button><button onclick="editClient(${c.id})">Editar</button><button onclick="renewClient(${c.id})">Renovar</button><button onclick="toggleClient(${c.id})">${c.active ? 'Bloquear' : 'Ativar'}</button><button class="red" onclick="deleteClient(${c.id})">Excluir</button></td></tr>`; }).join('') || '<tr><td colspan="7" class="muted" style="text-align:center;padding:20px">Nenhum cliente cadastrado.</td></tr>';
}
function clientForm(c = {}) {
  const d = new Date(); d.setFullYear(d.getFullYear() + 1);
  return `<div class="grid2"><div class="field"><label>Cliente</label><input id="clName" value="${esc(c.name || '')}"></div><div class="field"><label>CNPJ / CPF</label><input id="clDoc" value="${esc(c.docDisplay || '')}"></div><div class="field"><label>Validade</label><input id="clValidity" type="date" value="${c.validity || d.toISOString().slice(0, 10)}"></div><div class="field"><label>Tabela de preço</label><input id="clPrice" value="${esc(c.priceTable || 'Revenda Premium')}"></div><div class="field" style="grid-column:1/-1"><label>Token</label><div style="display:flex;gap:6px"><input id="clToken" value="${esc(c.token || '')}"><button type="button" class="btn" onclick="generateClientFormToken()">Gerar</button></div></div><label class="checkRow"><input id="clActive" type="checkbox" ${c.active !== false ? 'checked' : ''}> Acesso ativo</label></div><div style="text-align:right;margin-top:12px"><button class="btn primary" onclick="saveClient(${c.id || 0})">Salvar acesso</button></div>`;
}
async function generateClientFormToken() {
  const doc = normalizeDoc($('clDoc').value), validity = $('clValidity').value;
  if (!doc || !validity) return toast('Informe CNPJ/CPF e validade antes de gerar.');
  try { $('clToken').value = await serverToken(doc, validity); } catch (e) { toast(e.message); }
}
function newClient() { showModal('Novo cliente / token', clientForm({ active: true })); }
function editClient(id) { showModal('Editar cliente / token', clientForm(clients.find(x => x.id === id))); }
async function saveClient(id) {
  const display = $('clDoc').value.trim();
  const obj = { name: $('clName').value.trim(), doc: normalizeDoc(display), docDisplay: display, token: $('clToken').value.trim().toUpperCase(), validity: $('clValidity').value, priceTable: $('clPrice').value.trim(), active: $('clActive').checked };
  if (!obj.name || !obj.doc || !obj.token || !obj.validity) return toast('Preencha cliente, CNPJ/CPF, validade e token.');
  if (clients.some(x => x.doc === obj.doc && x.id !== id)) return toast('Já existe um cliente com este CNPJ/CPF.');
  const backup = JSON.parse(JSON.stringify(clients));
  if (id) Object.assign(clients.find(x => x.id === id), obj); else { obj.id = nextId(clients); clients.push(obj); }
  const ok = await saveClients('Acesso salvo');
  if (ok) { closeModal(); if (!id) shareClient(obj.id); } else clients = backup;
}
function shareLink(c) { return `${location.origin}/?doc=${encodeURIComponent(c.doc)}&token=${encodeURIComponent(c.token)}`; }
function shareMessage(c) {
  return `Olá, ${c.name}!\n\nSeu acesso ao Catálogo Virtual Zionne está liberado.\n\nAcesse pelo link:\n${shareLink(c)}\n\nCNPJ/CPF: ${c.docDisplay || c.doc}\nToken: ${c.token}\nVálido até: ${new Date(c.validity + 'T12:00:00').toLocaleDateString('pt-BR')}\n\nQualquer dúvida, estamos à disposição.\nEquipe Zionne`;
}
function shareClient(id) {
  const c = clients.find(x => x.id === id); if (!c) return;
  showModal('Compartilhar acesso — ' + c.name, `<p class="small muted">Envie este link ao cliente. Ele abre o catálogo já com o CNPJ/CPF e o token preenchidos.</p><div class="shareBox">${esc(shareLink(c))}</div><div class="field"><label>Mensagem pronta</label><textarea id="shareMsg" rows="10">${esc(shareMessage(c))}</textarea></div><div class="btnRow"><button class="btn" onclick="copyText('${esc(shareLink(c))}','Link copiado')">Copiar link</button><button class="btn" onclick="copyText($('shareMsg').value,'Mensagem copiada')">Copiar mensagem</button><button class="btn primary" onclick="openWhats($('shareMsg').value,'')">Enviar pelo WhatsApp</button></div>`);
}
function renewClient(id) { const c = clients.find(x => x.id === id), d = new Date(Math.max(new Date(c.validity + 'T12:00:00'), new Date())); d.setFullYear(d.getFullYear() + 1); c.validity = d.toISOString().slice(0, 10); c.active = true; saveClients('Validade renovada até ' + d.toLocaleDateString('pt-BR')); }
function toggleClient(id) { const c = clients.find(x => x.id === id); c.active = !c.active; saveClients(c.active ? 'Acesso ativado' : 'Acesso bloqueado'); }
function deleteClient(id) { const c = clients.find(x => x.id === id); if (!confirm(`Excluir o acesso de ${c.name}? Os pedidos já enviados continuam no histórico.`)) return; clients = clients.filter(x => x.id !== id); saveClients('Cliente excluído'); }

/* ---------------------------------------------------------------- configurações */
function renderSettings() {
  const s = data.settings;
  $('setWhats').value = s.whats || ''; $('setEmail').value = s.email || ''; $('setInstitutional').value = (s.institutional || '').replace(/\\n/g, '\n');
  $('setPayments').value = (s.payments || []).join('\n'); $('setAdminUser').value = adminUser; $('setAdminPassword').value = '';
}
async function saveSettings() {
  const s = data.settings;
  s.whats = $('setWhats').value.replace(/\D/g, ''); s.email = $('setEmail').value.trim(); s.institutional = $('setInstitutional').value;
  s.payments = $('setPayments').value.split('\n').map(x => x.trim()).filter(Boolean);
  const user = $('setAdminUser').value.trim(), pw = $('setAdminPassword').value;
  if (user !== adminUser || pw) {
    try { const r = await api('/api/admin/credentials', { method: 'POST', admin: true, body: { user, password: pw } }); adminUser = r.user; $('setAdminPassword').value = ''; }
    catch (e) { return toast(e.message); }
  }
  saveData('Configurações salvas');
}
async function exportConfig() {
  try {
    const r = await fetch('/api/admin/backup', { headers: { Authorization: 'Bearer ' + localStorage.getItem(ASESS) } });
    if (!r.ok) throw new Error('Sessão expirada');
    const blob = await r.blob(), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'zionne_catalogo_backup_' + todayYMD() + '.json'; a.click(); URL.revokeObjectURL(a.href);
    toast('Backup exportado');
  } catch (e) { toast(e.message); }
}
function importConfig(e) {
  const f = e.target.files?.[0]; if (!f) return;
  const r = new FileReader();
  r.onload = async () => {
    let obj; try { obj = JSON.parse(r.result); } catch { return alert('Arquivo JSON inválido'); }
    if (!confirm('Importar este backup? Produtos, coleções, textos e clientes atuais serão substituídos pelos do arquivo.')) return;
    toast('Importando... (pode levar alguns segundos se houver fotos)');
    try { await api('/api/admin/import', { method: 'POST', admin: true, body: obj }); await openAdmin(); toast('Backup importado'); } catch (err) { toast(err.message); }
  };
  r.readAsText(f); e.target.value = '';
}

/* ---------------------------------------------------------------- util */
function showModal(title, body) { $('modalTitle').textContent = title; $('modalBody').innerHTML = body; $('modal').classList.add('on'); }
function closeModal() { $('modal').classList.remove('on'); }
let toastTimer;
function toast(t) { const e = $('toast'); e.textContent = t; e.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => e.classList.remove('show'), 2400); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m])); }
function formatWhats(w) { const d = (w || '').replace(/\D/g, ''); return d.length >= 12 ? '(' + d.slice(2, 4) + ') ' + d.slice(4, d.length - 4) + '-' + d.slice(-4) : (w || ''); }
function copyText(t, msg) { (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => toast(msg || 'Copiado'), () => { prompt('Copie o texto:', t); }); }

document.addEventListener('keydown', e => { if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'a') requestAdminLogin(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if ($('imageZoomModal').classList.contains('on')) closeImageZoom(); else closeModal(); } });
let clicks = 0, clickTimer;
$('brandClick').addEventListener('click', () => { clicks++; clearTimeout(clickTimer); clickTimer = setTimeout(() => clicks = 0, 1200); if (clicks >= 5) { clicks = 0; requestAdminLogin(); } });

/* ---------------------------------------------------------------- início */
async function start() {
  const qs = new URLSearchParams(location.search);
  if (location.pathname === '/admin') {
    if (localStorage.getItem(ASESS)) return openAdmin();
    showLogin(); return requestAdminLogin();
  }
  if (qs.get('doc') && qs.get('token')) {
    $('loginDoc').value = qs.get('doc'); $('loginToken').value = qs.get('token');
    history.replaceState(null, '', '/');
    showLogin(); return login();
  }
  if (localStorage.getItem(SESS)) {
    try { await loadCatalog(); return; } catch (e) { return showLogin(e.status === 401 ? e.message : 'Não foi possível conectar ao servidor. Tente novamente.'); }
  }
  showLogin();
}
start();
