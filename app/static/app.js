/* Catálogo Virtual Zionne — versão online (API) */
const LOGO = '/static/img/logo.png';
const BRL = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const SESS = 'zionne_session', ASESS = 'zionne_admin_session';
const $ = id => document.getElementById(id);

let data = { products: [], collections: [], home: { benefits: [] }, notices: [], inspirations: [], kits: [], settings: {} };
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
  data = { products: r.products, collections: r.collections, home: r.home, notices: r.notices, inspirations: r.inspirations, kits: r.kits || [], settings: r.settings };
  loadCart();
  showApp(me);
  loadMyOrders();
}
function cartKey() { return 'zionne_cart_' + (adminPreview ? 'preview' : (me?.id || 0)); }
function loadCart() {
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(cartKey()) || '[]'); } catch { }
  // mantém só produtos ainda ativos e atualiza preço/nome
  cart = saved.map(ci => {
    if (ci.type === 'kit') { const k = clientKits().find(x => x.id === ci.kitId && !x.soldOut); return k ? kitCartLine(k, ci.qty) : null; }
    const p = data.products.find(x => x.id === ci.id && x.active); return p ? prodCartLine(p, normalizeOrderQty(p, ci.qty)) : null;
  }).filter(Boolean);
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
function refreshCatalog() { renderHome(); renderFilters(); renderProducts(); renderKits(); renderKitBanners(); updateCart(); renderMyOrders(); }
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
  const fill = (id, list, count) => { const el = $(id); if (!el) return; const old = el.value; el.innerHTML = '<option value="">Todas as coleções</option>' + list.map(c => `<option value="${esc(c.name)}">${esc(c.name)}${count ? ` (${data.products.filter(p => p.collection === c.name).length})` : ''}</option>`).join(''); el.value = old; };
  fill('collectionFilter', active, false);
  fill('adminProductCollection', data.collections.slice().sort((a, b) => a.name.localeCompare(b.name)), true);
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
    const rows = cart.filter(ci => { if (ci.type === 'kit') return false; const p = data.products.find(x => x.id === ci.id); return p && p.active && p.collection === c.name; });
    const boughtSku = new Set(rows.map(x => x.id)).size, boughtQty = rows.reduce((a, x) => a + Number(x.qty || 0), 0);
    return `<div class="collectionSummaryCard ${boughtQty ? 'hasBuy' : ''}" data-name="${esc(c.name)}" onclick="filterCollection(this.dataset.name)" title="Clique para filtrar esta coleção"><div class="collectionSummaryName">${esc(c.name)}</div><div class="collectionSummaryStats"><div class="collectionSummaryStat"><strong>${lineSku}</strong><span>SKUs linha</span></div><div class="collectionSummaryStat"><strong>${boughtSku}</strong><span>SKUs comprados</span></div><div class="collectionSummaryStat"><strong>${boughtQty}</strong><span>Itens comprados</span></div></div></div>`;
  }).join('');
}
function renderProducts() {
  const el = $('products'); if (!el) return;
  const q = ($('search')?.value || '').toLowerCase(), cf = $('collectionFilter')?.value || '';
  const list = data.products.filter(p => p.active && (!q || p.name.toLowerCase().includes(q) || String(p.sku).includes(q) || (p.collection || '').toLowerCase().includes(q)) && (!cf || p.collection === cf));
  el.innerHTML = list.map(p => {
    const ci = cart.find(x => x.key === 'p' + p.id), cartQty = ci?.qty || 0, min = Math.max(1, Number(p.minQty) || 1), pack = Math.max(1, Number(p.packQty) || 1);
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
  const input = $('q' + id), q = normalizeOrderQty(p, parseInt(input?.value || p.minQty || 1)), e = cart.find(x => x.key === 'p' + id);
  if (input) input.value = q;
  e ? e.qty += q : cart.push(prodCartLine(p, q));
  saveCart(); toast(`${q} unidade(s) adicionada(s) ao pedido`);
}
function prodCartLine(p, qty) { return { key: 'p' + p.id, type: 'product', id: p.id, sku: p.sku, name: p.name, price: p.price, qty }; }
function kitCartLine(k, qty) { return { key: 'k' + k.id, type: 'kit', kitId: k.id, sku: 'KIT-' + k.id, name: 'Kit ' + k.name, price: k.price, fullPrice: k.full, qty, components: k.components, maxKits: k.maxKits }; }
function compsText(x) { return (x.components || []).map(c => `${c.qty * x.qty}x ${c.name} a ${BRL(c.promoPrice ?? c.price)} (de ${BRL(c.price)})`).join('\n'); }
function saveCart() { localStorage.setItem(cartKey(), JSON.stringify(cart)); updateCart(); renderProducts(); renderKits(); }
function updateCart() {
  renderCollectionPurchaseSummary();
  const q = cart.reduce((a, x) => a + x.qty, 0), t = cart.reduce((a, x) => a + x.qty * x.price, 0);
  ['cartCount', 'sideCart'].forEach(id => { const e = $(id); if (e) e.textContent = q; });
  $('subtotal').textContent = BRL(t); $('grand').textContent = BRL(t);
  $('cartItems').innerHTML = cart.length ? cart.map(x => `<div class="cartItem"><div><b>${esc(x.name)}</b>${x.type === 'kit' ? '<span class="kitTag">KIT</span>' : ''}<small>${esc(x.sku)} • ${BRL(x.price)} ${x.type === 'kit' ? 'por kit' : 'un.'}</small>${x.type === 'kit' ? `<small class="comps">${esc(compsText(x)).replace(/\n/g, '<br>')}</small>` : ''}<small class="cartItemTotal">Total: ${BRL(x.price * x.qty)}</small></div><div class="qctrl"><button onclick="changeQ('${x.key}',-1)">−</button><span>${x.qty}</span><button onclick="changeQ('${x.key}',1)">+</button></div></div>`).join('') : '<div class="muted small" style="text-align:center;padding:45px 5px">Seu pedido ainda está vazio.</div>';
}
function changeQ(key, d) {
  const x = cart.find(i => i.key === key); if (!x) return;
  if (x.type === 'kit') {
    x.qty += d;
    if (x.maxKits != null && x.qty > x.maxKits) { x.qty = x.maxKits; toast(`Disponível no máximo ${x.maxKits} kit(s)`); }
    if (x.qty < 1) cart = cart.filter(i => i.key !== key);
    return saveCart();
  }
  const p = data.products.find(i => i.id === x.id), pack = Math.max(1, Number(p?.packQty) || 1), min = Math.max(1, Number(p?.minQty) || 1);
  x.qty += d * pack;
  if (x.qty < min) cart = cart.filter(i => i.key !== key);
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
  $('printOrder').innerHTML = `<div class="print"><div class="printHead"><img src="${LOGO}"><div style="text-align:right"><b>PEDIDO ${esc(o.number)}</b><br><small>${esc(o.date)}</small>${o.status ? `<br><small>Status: ${esc(o.status)}</small>` : ''}</div></div><p style="font-size:10px"><b>Cliente:</b> ${esc(o.client)}${o.doc ? ' — ' + esc(o.doc) : ''}<br><b>Condição:</b> ${esc(o.payment)}<br><b>Observação:</b> ${esc(o.obs || '—')}</p><table><thead><tr><th>Código</th><th>Produto</th><th>Qtd.</th><th>Unitário</th><th>Total</th></tr></thead><tbody>${itemRows(o.items)}</tbody></table><div class="ptotal"><div><span>Total</span><b>${BRL(o.total)}</b></div></div></div>`;
  closeCart(); closeModal(); setTimeout(() => window.print(), 150);
}
function printPDF() { if (!cart.length) return toast('Adicione produtos ao pedido'); printOrderDoc(draftOrder()); }
function whatsText(o) {
  const m = ['Olá, Zionne!', 'Segue meu pedido pelo Catálogo Virtual.', '', `Cliente: ${o.client}`, `Pedido: ${o.number}`, `Condição: ${o.payment}`, ''];
  o.items.forEach(x => { m.push(`${x.qty}x ${x.sku} - ${x.name} - ${BRL(x.qty * x.price)}`); (x.components || []).forEach(c => m.push(`   ↳ ${c.qty * x.qty}x ${c.sku} ${c.name}${c.promoPrice != null ? ' a ' + BRL(c.promoPrice) : ''}`)); });
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
    const o = await api('/api/orders', { method: 'POST', body: { payment: $('payment').value, obs: $('obs').value, items: cart.map(x => x.type === 'kit' ? { kitId: x.kitId, qty: x.qty } : { id: x.id, qty: x.qty }) } });
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
function itemRows(items) {
  return items.map(x => `<tr><td>${esc(x.sku)}</td><td>${esc(x.name)}${x.type === 'kit' && x.fullPrice ? ` <small style="color:#a8452f">(de ${BRL(x.fullPrice)} por ${BRL(x.price)})</small>` : ''}</td><td>${x.qty}</td><td>${BRL(x.price)}</td><td>${BRL(x.price * x.qty)}</td></tr>` +
    (x.components || []).map(c => `<tr class="comp"><td>↳ ${esc(c.sku)}</td><td>${esc(c.name)} — ${c.qty} por kit${c.promoPrice != null ? ` (de ${BRL(c.price)})` : ''}</td><td>${c.qty * x.qty}</td><td>${c.promoPrice != null ? BRL(c.promoPrice) : ''}</td><td>${c.promoPrice != null ? BRL(c.promoPrice * c.qty * x.qty) : ''}</td></tr>`).join('')).join('');
}
function orderItemsTable(items) {
  return `<table class="orderItems"><thead><tr><th>Código</th><th>Produto</th><th>Qtd.</th><th>Unitário</th><th>Total</th></tr></thead><tbody>${itemRows(items)}</tbody></table>`;
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
  o.items.forEach(it => {
    if (it.type === 'kit') { const k = clientKits().find(x => x.id === it.kitId && !x.soldOut); if (!k) return; const e = cart.find(x => x.key === 'k' + k.id); e ? e.qty += it.qty : cart.push(kitCartLine(k, it.qty)); added++; return; }
    const p = data.products.find(x => x.id === it.id && x.active); if (!p) return; const e = cart.find(x => x.key === 'p' + p.id); e ? e.qty += it.qty : cart.push(prodCartLine(p, normalizeOrderQty(p, it.qty))); added++;
  });
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
let previewGroup = '';
function setPreviewGroup(v) { previewGroup = v; loadCart(); refreshCatalog(); }
function previewCatalog() {
  adminPreview = true;
  me = { name: 'Pré-visualização (Admin)', validity: new Date(new Date().getFullYear(), 11, 31).toISOString().slice(0, 10), priceTable: '—' };
  loadCart(); showApp(me); myOrders = []; renderMyOrders();
  $('previewGroupSel').innerHTML = '<option value="">Cliente sem grupo</option>' + groups().map(g => `<option value="${g.id}" ${String(previewGroup) === String(g.id) ? 'selected' : ''}>${esc(g.name)}</option>`).join('');
}
function refreshAdmin() { data.kits = data.kits || []; data.groups = data.groups || []; renderGroups(); renderFilters(); renderAdminProducts(); renderAdminKits(); renderAdminCollections(); renderAdminNotices(); renderAdminInspirations(); renderHomeAdmin(); renderClients(); renderSettings(); renderDashboard(); renderAdminOrders(); }
function adminTab(id, btn) { document.querySelectorAll('.adminSection').forEach(s => s.classList.remove('active')); $(id).classList.add('active'); document.querySelectorAll('.adminSide button').forEach(b => b.classList.remove('active')); btn.classList.add('active'); if (id === 'ordersAdmin') loadAdminOrders(); if (id === 'intelAdmin') intelInit(); }

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
  try { const r = await api('/api/admin/clients', { method: 'PUT', admin: true, body: { clients } }); clients = r.clients; renderClients(); renderGroups(); renderDashboard(); if (msg) toast(msg); return true; }
  catch (e) { toast('Não foi possível salvar: ' + e.message); const r = await api('/api/admin/data', { admin: true }).catch(() => null); if (r) { clients = r.clients; renderClients(); } return false; }
}
function renderDashboard() {
  $('mProducts').textContent = data.products.filter(p => p.active).length;
  $('mCollections').textContent = data.collections.filter(c => c.active).length;
  $('mOrdersNew').textContent = adminOrders.filter(o => o.status === 'Recebido').length;
  $('mClients').textContent = clients.filter(c => c.active).length;
  $('adminNoticeCount').textContent = data.notices.filter(n => n.active).length;
  $('adminInspireCount').textContent = data.inspirations.filter(n => n.active).length;
  $('adminKitCount').textContent = (data.kits || []).filter(k => k.active).length;
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
  $('adminOrdersBody').innerHTML = list.length ? list.map(o => `<tr><td><b>${esc(o.number)}</b></td><td>${new Date(o.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td><td><b>${esc(o.client_name)}</b><br><span class="muted">${esc(o.client_doc || '')}</span></td><td>${o.items.reduce((a, x) => a + x.qty, 0)}</td><td><b>${BRL(o.total)}</b></td><td>${esc(o.payment)}</td><td><select class="statusSel" onchange="setOrderStatus(${o.id},this.value)">${orderStatus.map(s => `<option ${s === o.status ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></td><td class="actionsCell"><button onclick="viewAdminOrder(${o.id})">Ver</button><button onclick="openIntelTab();setTimeout(()=>intelFromOrder(${o.id}),50)">Analisar</button><button onclick="printAdminOrder(${o.id})">PDF</button><button class="red" onclick="deleteAdminOrder(${o.id})">Excluir</button></td></tr>`).join('') : '<tr><td colspan="8" class="muted" style="text-align:center;padding:24px">Nenhum pedido encontrado.</td></tr>';
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
function prodMarginCell(p) {
  const f = finOf(p); if (!f.hasCost) return '<span class="muted" title="Sem custo cadastrado">—</span>';
  const m = marginAt(f, p.price), st = finStatus(m, f.lucro, f.lucroMin);
  return `<span title="Custo ${BRL(f.cost)} • Preço ideal ${BRL(f.ideal)}">${dotF(st)}${pctF(m)}${p.price < f.ideal - 0.005 ? `<br><span class="small" style="color:#a56a00">ideal ${BRL(f.ideal)}</span>` : ''}</span>`;
}
function renderAdminProducts() {
  const body = $('adminProductsBody'); if (!body) return;
  const q = ($('adminProductSearch')?.value || '').toLowerCase(), cf = $('adminProductCollection')?.value || '';
  const list = data.products.filter(p => (!q || p.name.toLowerCase().includes(q) || String(p.sku).includes(q)) && (!cf || p.collection === cf));
  body.innerHTML = list.map(p => `<tr><td>${p.image ? `<img class="thumb" src="${esc(p.image)}" loading="lazy" style="cursor:zoom-in" onclick="zoomUrl(this.src)" onerror="this.outerHTML='<div class=&quot;thumb imgErrThumb&quot; title=&quot;Imagem não carregou&quot;>⚠</div>'">` : `<div class="thumb"></div>`}</td><td>${esc(p.sku)}</td><td><b>${esc(p.name)}</b></td><td>${esc(p.collection)}</td><td>${BRL(p.price)}</td><td>${prodMarginCell(p)}</td><td>${p.stockQty === '' || p.stockQty == null ? '<span class="muted">—</span>' : Number(p.stockQty).toLocaleString('pt-BR')}</td><td>${p.minQty || 1}</td><td>${p.packQty || 1}</td><td><span class="tag ${p.active ? 'on' : 'off'}">${p.active ? 'Ativo' : 'Fora de linha'}</span></td><td class="actionsCell"><button onclick="editProduct(${p.id})">Editar</button><button onclick="toggleProduct(${p.id})">${p.active ? 'Fora de linha' : 'Ativar'}</button><button class="red" onclick="deleteProduct(${p.id})">Excluir</button></td></tr>`).join('');
}
let tempImage = '';
function productForm(p = {}) {
  const opts = data.collections.slice().sort((a, b) => a.order - b.order).map(c => `<option ${p.collection === c.name ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  return `<div class="grid2"><div><div class="field"><label>Código</label><input id="pfSku" value="${esc(p.sku || '')}"></div><div class="field"><label>Nome do produto</label><input id="pfName" value="${esc(p.name || '')}"></div><div class="field"><label>Coleção</label><select id="pfCollection">${opts}</select></div><div class="grid2"><div class="field"><label>Preço</label><input id="pfPrice" type="number" step="0.01" value="${p.price ?? ''}"></div><div class="field"><label>Situação</label><select id="pfStock">${['Disponível', 'Baixo estoque', 'Sob encomenda', 'Esgotado'].map(s => `<option ${p.stock === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div></div><div class="field"><label>Estoque (quantidade) — usado no cálculo de kits</label><input id="pfStockQty" type="number" min="0" step="1" value="${p.stockQty ?? ''}" placeholder="Em branco = sem controle"></div><div class="field"><label>Descrição</label><textarea id="pfDesc" rows="3">${esc(p.description || '')}</textarea></div><div class="grid2"><div class="field"><label>Quantidade mínima</label><input id="pfMinQty" type="number" min="1" value="${p.minQty || 1}"></div><div class="field"><label>Embalagem / múltiplo</label><input id="pfPackQty" type="number" min="1" value="${p.packQty || 1}"></div></div><p class="small muted">Ex.: mínimo 6 e embalagem 6 → cliente compra 6, 12, 18...</p><label class="checkRow"><input id="pfActive" type="checkbox" ${p.active !== false ? 'checked' : ''}> Produto ativo</label></div><div><div class="field"><label>URL da imagem</label><input id="pfImage" value="${esc(p.image || '')}" placeholder="https://..." oninput="previewPF()"></div><div class="imagePreview pfCheck" id="pfPreview"></div><p class="small muted">Cole o link da foto. Links de compartilhamento do Google Drive, OneDrive e Dropbox são convertidos automaticamente. Clique na imagem para ampliar.</p></div></div>${productFinForm(p)}<div style="text-align:right;margin-top:14px"><button class="btn primary" onclick="saveProduct(${p.id || 0})">Salvar produto</button></div>`;
}
function newProduct() { tempImage = ''; showModal('Novo produto', productForm({ active: true }), true); imgCheck('pfPreview', ''); pfFinCalc(); $('pfPrice').addEventListener('input', pfFinCalc); }
function editProduct(id) { const p = data.products.find(x => x.id === id); tempImage = p.image || ''; showModal('Editar produto', productForm(p), true); imgCheck('pfPreview', p.image); pfFinCalc(); $('pfPrice').addEventListener('input', pfFinCalc); }
let pfTimer; function previewPF() { clearTimeout(pfTimer); pfTimer = setTimeout(() => { tempImage = normImg($('pfImage').value); imgCheck('pfPreview', tempImage); }, 350); }
function productFinForm(p) {
  const d = finDefaults(), o = p.fin || {};
  return `<div class="finBox"><div class="finHead"><b>💼 Financeiro</b><span class="lockTag">🔒 somente administrador — não aparece para o cliente</span></div>
  <div class="finGrid"><div class="field"><label>Custo líquido (Preco.Com.Liq)</label><input id="pfCost" type="number" step="0.01" min="0" value="${p.cost ?? ''}" oninput="pfFinCalc()"></div>
  ${FIN_PCT.map(([k, l]) => `<div class="field"><label>${l} %</label><input id="pf_${k}" type="number" step="0.01" value="${o[k] ?? ''}" placeholder="${String(d[k]).replace('.', ',')} (padrão)" oninput="pfFinCalc()"></div>`).join('')}</div>
  <div id="pfFinOut" class="finOut"></div></div>`;
}
function pfFinRead() {
  const fin = {}; FIN_PCT.forEach(([k]) => { const v = $('pf_' + k)?.value; if (v !== '' && v != null) fin[k] = Number(v); });
  return { cost: $('pfCost').value === '' ? '' : Number($('pfCost').value), fin };
}
function pfFinCalc() {
  const out = $('pfFinOut'); if (!out) return;
  const r = pfFinRead(), f = finOf(r), price = Number($('pfPrice').value || 0);
  if (!f.hasCost) { out.innerHTML = '<span class="muted small">Informe o custo líquido para calcular o preço ideal e a margem.</span>'; return; }
  const m = marginAt(f, price), st = finStatus(m, f.lucro, f.lucroMin);
  out.innerHTML = `<div><small>Deduções s/ venda</small><b>${String(+f.ded.toFixed(2)).replace('.', ',')}%</b></div><div><small>Preço ideal (lucro ${String(f.lucro).replace('.', ',')}%)</small><b>${BRL(f.ideal)}</b></div><div><small>Preço mínimo (lucro ${String(f.lucroMin).replace('.', ',')}%)</small><b>${BRL(f.minPrice)}</b></div><div><small>Margem líquida no preço atual</small><b class="${st}">${dotF(st)}${pctF(m)}</b></div><div><small>Preço atual × ideal</small><b class="${price >= f.ideal - 0.005 ? 'g' : 'r'}">${price ? (Math.abs(price / f.ideal - 1) < 0.0005 ? 'igual ao ideal' : (price > f.ideal ? '+' : '−') + pctF(Math.abs(price / f.ideal - 1)) + (price > f.ideal ? ' acima' : ' abaixo')) : '—'}</b></div><div><small>Desconto até o lucro alvo (${String(f.lucro).replace('.', ',')}%)</small><b class="${price > f.ideal ? 'g' : 'r'}">${price ? (price > f.ideal ? pctF(1 - f.ideal / price) : 'sem margem p/ desconto') : '—'}</b></div><div><small>Desconto até o lucro mínimo (${String(f.lucroMin).replace('.', ',')}%)</small><b class="y">${price && f.minPrice ? pctF(Math.max(0, 1 - f.minPrice / price)) : '—'}</b></div><button class="btn" type="button" onclick="$('pfPrice').value=${(Math.round(f.ideal * 100) / 100).toFixed(2)};pfFinCalc()">Usar preço ideal</button>`;
}
function saveProduct(id) {
  const obj = { sku: $('pfSku').value.trim(), name: $('pfName').value.trim(), collection: $('pfCollection').value, price: Number($('pfPrice').value || 0), stock: $('pfStock').value, description: $('pfDesc').value.trim(), minQty: Math.max(1, Number($('pfMinQty').value || 1)), packQty: Math.max(1, Number($('pfPackQty').value || 1)), active: $('pfActive').checked, image: normImg($('pfImage').value), stockQty: $('pfStockQty').value === '' ? '' : Math.max(0, parseInt($('pfStockQty').value) || 0), ...pfFinRead() };
  if (!obj.sku || !obj.name) return toast('Informe código e nome');
  if (data.products.some(x => x.sku === obj.sku && x.id !== id)) return toast('Já existe um produto com este código');
  if (id) Object.assign(data.products.find(x => x.id === id), obj); else { obj.id = nextId(data.products); data.products.push(obj); }
  closeModal(); saveData('Produto salvo e publicado');
}
function toggleProduct(id) { const p = data.products.find(x => x.id === id); p.active = !p.active; saveData(p.active ? 'Produto ativado' : 'Produto marcado fora de linha'); }
function deleteProduct(id) { if (!confirm('Excluir este produto? Para histórico, prefira usar Fora de linha.')) return; data.products = data.products.filter(x => x.id !== id); saveData('Produto excluído'); }

/* ---------------------------------------------------------------- coleções */
function renderAdminCollections() {
  $('adminCollectionsBody').innerHTML = data.collections.slice().sort((a, b) => a.order - b.order).map(c => `<tr><td>${c.image ? `<img class="collectionThumb" src="${esc(c.image)}" loading="lazy">` : `<div class="collectionThumbEmpty"></div>`}</td><td>${c.order}</td><td><b>${esc(c.name)}</b></td><td>${esc(c.description || '')}</td><td>${data.products.filter(p => p.collection === c.name).length}</td><td><span class="tag ${c.featured ? 'on' : 'off'}">${c.featured ? 'Sim' : 'Não'}</span></td><td><span class="tag ${c.active ? 'on' : 'off'}">${c.active ? 'Ativa' : 'Inativa'}</span></td><td class="actionsCell"><button onclick="editCollection(${c.id})">Editar</button><button onclick="toggleFeatured(${c.id})">${c.featured ? 'Remover destaque' : 'Destacar'}</button><button onclick="toggleCollection(${c.id})">${c.active ? 'Desativar' : 'Ativar'}</button><button class="red" onclick="deleteCollection(${c.id})">Excluir</button></td></tr>`).join('') || '<tr><td colspan="8" class="muted" style="text-align:center;padding:20px">Nenhuma coleção cadastrada.</td></tr>';
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
function deleteCollection(id) {
  const c = data.collections.find(x => x.id === id); if (!c) return;
  const prods = data.products.filter(p => p.collection === c.name), others = data.collections.filter(x => x.id !== id).sort((a, b) => a.name.localeCompare(b.name));
  const ids = new Set(prods.map(p => p.id)), kits = (data.kits || []).filter(k => (k.items || []).some(i => ids.has(Number(i.productId))));
  if (!prods.length) {
    if (!confirm(`Excluir a coleção "${c.name}"? Ela não tem produtos.`)) return;
    return removeCollection(c), saveData('Coleção excluída');
  }
  showModal('Excluir coleção — ' + c.name, `<div class="notice">A coleção <b>${esc(c.name)}</b> tem <b>${prods.length} produto(s)</b>. Escolha o que fazer com eles:</div>
  <div class="tableWrap" style="max-height:28vh;overflow:auto;margin:10px 0"><table class="adminTable"><tbody>${prods.map(p => `<tr><td>${esc(p.sku)}</td><td>${esc(p.name)}</td><td>${BRL(p.price)}</td></tr>`).join('')}</tbody></table></div>
  <div class="formCard" style="margin-bottom:10px"><b class="small">Mover os produtos para outra coleção</b><div style="display:flex;gap:8px;margin-top:8px"><select id="delColTarget" style="flex:1;border:1px solid var(--line);border-radius:8px;padding:9px">${others.map(o => `<option value="${esc(o.name)}">${esc(o.name)} (${data.products.filter(p => p.collection === o.name).length})</option>`).join('')}</select><button class="btn primary" ${others.length ? '' : 'disabled'} onclick="deleteCollectionMove(${id})">Mover e excluir</button></div></div>
  <div class="formCard"><b class="small" style="color:#a34b44">Excluir a coleção e os ${prods.length} produto(s)</b><p class="small muted">Use para remover dados de demonstração. Pedidos já enviados não são afetados.${kits.length ? ` <b style="color:#a34b44">Atenção: ${kits.length} kit(s) usam esses produtos (${esc(kits.map(k => k.name).join(', '))}) e deixarão de aparecer até serem ajustados.</b>` : ''}</p><button class="btn" style="color:#a34b44;border-color:#e2b8b1" onclick="deleteCollectionAll(${id})">Excluir coleção e produtos</button></div>`);
}
function removeCollection(c) {
  data.collections = data.collections.filter(x => x.id !== c.id);
  data.inspirations.filter(x => x.linkType === 'collection' && x.linkValue === c.name).forEach(x => { x.linkType = 'none'; x.linkValue = ''; });
}
function deleteCollectionMove(id) {
  const c = data.collections.find(x => x.id === id), target = $('delColTarget').value; if (!c || !target) return;
  const n = data.products.filter(p => p.collection === c.name).map(p => p.collection = target).length;
  removeCollection(c); closeModal(); saveData(`${n} produto(s) movido(s) para "${target}" e coleção excluída`);
}
function deleteCollectionAll(id) {
  const c = data.collections.find(x => x.id === id); if (!c) return;
  if (!confirm(`Confirma excluir a coleção "${c.name}" e todos os seus produtos? Esta ação não pode ser desfeita (exceto por um backup exportado).`)) return;
  const before = data.products.length; data.products = data.products.filter(p => p.collection !== c.name);
  removeCollection(c); closeModal(); saveData(`Coleção excluída com ${before - data.products.length} produto(s)`);
}
function removeEmptyCollections() {
  const empty = data.collections.filter(c => !data.products.some(p => p.collection === c.name));
  if (!empty.length) return toast('Nenhuma coleção vazia.');
  if (!confirm(`Excluir ${empty.length} coleção(ões) sem produtos?\n\n${empty.map(c => '• ' + c.name).join('\n')}`)) return;
  empty.forEach(removeCollection); saveData(`${empty.length} coleção(ões) vazia(s) excluída(s)`);
}
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
/* ---------------------------------------------------------------- grupos de clientes */
function groups() { return (data.groups || []).slice().sort((a, b) => a.name.localeCompare(b.name)); }
function groupName(id) { return (data.groups || []).find(g => g.id === Number(id))?.name; }
function groupTag(id) { const n = groupName(id); return n ? `<span class="tag blue">${esc(n)}</span>` : '<span class="muted">—</span>'; }
function renderGroups() {
  const el = $('groupsBody'); if (!el) return;
  const kitsOf = gid => (data.kits || []).filter(k => (k.groups || []).map(Number).includes(gid));
  el.innerHTML = groups().map(g => `<tr><td><b>${esc(g.name)}</b>${g.description ? `<br><span class="muted">${esc(g.description)}</span>` : ''}</td><td>${clients.filter(c => Number(c.groupId) === g.id).length}</td><td>${kitsOf(g.id).map(k => `<span class="tag warn" style="margin:1px">${esc(k.name)}</span>`).join(' ') || '<span class="muted">—</span>'}</td><td class="actionsCell"><button onclick="editGroup(${g.id})">Editar</button><button class="red" onclick="deleteGroup(${g.id})">Excluir</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted" style="text-align:center;padding:16px">Nenhum grupo cadastrado. Crie grupos para oferecer kits exclusivos.</td></tr>';
  const sel = $('adminClientGroup'); if (sel) { const v = sel.value; sel.innerHTML = '<option value="">Todos os grupos</option><option value="none">Sem grupo</option>' + groups().map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join(''); sel.value = v; }
}
function groupForm(g = {}) { return `<div class="field"><label>Nome do grupo</label><input id="gfName" value="${esc(g.name || '')}" placeholder="Ex.: Grupo A — Grandes contas"></div><div class="field"><label>Descrição (uso interno)</label><input id="gfDesc" value="${esc(g.description || '')}" placeholder="Ex.: clientes com maior poder de compra"></div><div class="btnRow"><button class="btn primary" onclick="saveGroup(${g.id || 0})">Salvar grupo</button></div>`; }
function newGroup() { showModal('Novo grupo de clientes', groupForm()); }
function editGroup(id) { showModal('Editar grupo de clientes', groupForm((data.groups || []).find(g => g.id === id))); }
function saveGroup(id) {
  const name = $('gfName').value.trim(); if (!name) return toast('Informe o nome do grupo');
  data.groups = data.groups || [];
  if (data.groups.some(g => g.name.toLowerCase() === name.toLowerCase() && g.id !== id)) return toast('Já existe um grupo com este nome');
  const obj = { name, description: $('gfDesc').value.trim() };
  if (id) Object.assign(data.groups.find(g => g.id === id), obj); else data.groups.push({ id: nextId(data.groups), ...obj });
  closeModal(); saveData('Grupo salvo');
}
async function deleteGroup(id) {
  const g = data.groups.find(x => x.id === id), kits = (data.kits || []).filter(k => (k.groups || []).map(Number).includes(id)), cl = clients.filter(c => Number(c.groupId) === id);
  if (kits.length) return alert(`O grupo "${g.name}" está vinculado a ${kits.length} kit(s): ${kits.map(k => k.name).join(', ')}.\n\nAltere o campo "Disponível para" desses kits antes de excluir o grupo.`);
  if (!confirm(`Excluir o grupo "${g.name}"?${cl.length ? `\n${cl.length} cliente(s) ficarão sem grupo.` : ''}`)) return;
  if (cl.length) { cl.forEach(c => c.groupId = ''); if (!await saveClients()) return; }
  data.groups = data.groups.filter(x => x.id !== id); saveData('Grupo excluído');
}
function renderClients() {
  const b = $('clientsBody'); if (!b) return;
  const q = ($('adminClientSearch')?.value || '').toLowerCase(), qd = normalizeDoc(q);
  const gf = $('adminClientGroup')?.value || ''; const list = clients.filter(c => (!q || (c.name || '').toLowerCase().includes(q) || (qd && (c.doc || '').includes(qd))) && (!gf || (gf === 'none' ? !c.groupId : String(c.groupId) === gf)));
  const today = todayYMD();
  b.innerHTML = list.map(c => { const expired = c.validity < today; return `<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.docDisplay || c.doc)}</td><td style="font-family:Consolas">${esc(c.token)}</td><td>${new Date(c.validity + 'T12:00:00').toLocaleDateString('pt-BR')}</td><td>${groupTag(c.groupId)}</td><td><span class="tag ${!c.active ? 'off' : expired ? 'warn' : 'on'}">${!c.active ? 'Bloqueado' : expired ? 'Vencido' : 'Ativo'}</span></td><td class="actionsCell"><button onclick="shareClient(${c.id})">Link / WhatsApp</button><button onclick="editClient(${c.id})">Editar</button><button onclick="renewClient(${c.id})">Renovar</button><button onclick="toggleClient(${c.id})">${c.active ? 'Bloquear' : 'Ativar'}</button><button class="red" onclick="deleteClient(${c.id})">Excluir</button></td></tr>`; }).join('') || '<tr><td colspan="7" class="muted" style="text-align:center;padding:20px">Nenhum cliente cadastrado.</td></tr>';
}
function clientForm(c = {}) {
  const d = new Date(); d.setFullYear(d.getFullYear() + 1);
  return `<div class="grid2"><div class="field"><label>Cliente</label><input id="clName" value="${esc(c.name || '')}"></div><div class="field"><label>CNPJ / CPF</label><input id="clDoc" value="${esc(c.docDisplay || '')}"></div><div class="field"><label>Validade</label><input id="clValidity" type="date" value="${c.validity || d.toISOString().slice(0, 10)}"></div><div class="field"><label>Grupo de clientes</label><select id="clGroup"><option value="">Sem grupo (vê só os kits para todos)</option>${groups().map(g => `<option value="${g.id}" ${Number(c.groupId) === g.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select><input id="clPrice" type="hidden" value="${esc(c.priceTable || '')}"></div><div class="field" style="grid-column:1/-1"><label>Token</label><div style="display:flex;gap:6px"><input id="clToken" value="${esc(c.token || '')}"><button type="button" class="btn" onclick="generateClientFormToken()">Gerar</button></div></div><label class="checkRow"><input id="clActive" type="checkbox" ${c.active !== false ? 'checked' : ''}> Acesso ativo</label></div><div style="text-align:right;margin-top:12px"><button class="btn primary" onclick="saveClient(${c.id || 0})">Salvar acesso</button></div>`;
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
  const obj = { name: $('clName').value.trim(), doc: normalizeDoc(display), docDisplay: display, token: $('clToken').value.trim().toUpperCase(), validity: $('clValidity').value, priceTable: $('clPrice').value.trim(), groupId: $('clGroup').value ? Number($('clGroup').value) : '', active: $('clActive').checked };
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
  const d = finDefaults(); $('finDefaults').innerHTML = [...FIN_PCT, ['bonusPct', 'Bonificação padrão'], ['generalDisc', 'Desconto geral padrão']].map(([k, l]) => `<div class="field"><label>${l} %</label><input id="fd_${k}" type="number" step="0.01" value="${d[k]}"></div>`).join('');
}
async function saveSettings() {
  const s = data.settings;
  s.whats = $('setWhats').value.replace(/\D/g, ''); s.email = $('setEmail').value.trim(); s.institutional = $('setInstitutional').value;
  s.payments = $('setPayments').value.split('\n').map(x => x.trim()).filter(Boolean);
  s.fin = {}; [...FIN_PCT, ['bonusPct'], ['generalDisc']].forEach(([k]) => s.fin[k] = numOr($('fd_' + k).value, FIN_DEF[k]));
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

/* ================================================================ KITS PROMOCIONAIS */
/* cálculo igual ao do servidor: preço cheio, desconto, preço do kit e kits possíveis pelo estoque */
function stockOf(p) { if (p.stockQty === '' || p.stockQty == null) return null; const n = parseInt(p.stockQty); return isNaN(n) ? null : Math.max(0, n); }
function apportion(rows, target) {
  const full = rows.reduce((a, r) => a + r.price * r.qty, 0), f = full ? target / full : 1;
  const promos = rows.map(r => Math.round(r.price * f * 100) / 100);
  const diff = Math.round((target - promos.reduce((a, p, i) => a + p * rows[i].qty, 0)) * 100);
  if (diff) { const i = rows.findIndex(r => r.qty === 1 || diff % r.qty === 0); if (i >= 0) promos[i] = Math.round((promos[i] + diff / rows[i].qty / 100) * 100) / 100; }
  return promos.map(x => Math.max(0, x));
}
function kitCalc(k, prods) {
  const map = new Map((prods || data.products).map(p => [p.id, p]));
  let maxK = null, limiting = null; const rows = [], missing = [];
  (k.items || []).forEach(it => {
    const p = map.get(Number(it.productId)), q = Math.max(1, parseInt(it.qty) || 1);
    if (!p) { missing.push(it.productId); return; }
    const st = stockOf(p), perItem = st == null ? null : Math.floor(st / q);
    if (perItem != null && (maxK == null || perItem < maxK)) { maxK = perItem; limiting = p.name; }
    rows.push({ p, qty: q, price: Number(p.price), manual: it.promoPrice, stock: st, perItem, inactive: !p.active });
  });
  const full = Math.round(rows.reduce((a, r) => a + r.price * r.qty, 0) * 100) / 100;
  const mode = k.discountType || 'percent', d = Number(k.discount) || 0;
  let promos;
  if (mode === 'manual') promos = rows.map(r => r.manual === '' || r.manual == null ? r.price : Math.round(Number(r.manual) * 100) / 100);
  else { const t = mode === 'percent' ? full * (1 - d / 100) : mode === 'value' ? full - d : d; promos = apportion(rows, Math.round(Math.min(Math.max(t, 0), full) * 100) / 100); }
  rows.forEach((r, i) => { r.promo = promos[i]; r.subtotal = r.price * r.qty; });
  const price = Math.round(rows.reduce((a, r) => a + r.promo * r.qty, 0) * 100) / 100, saving = Math.round((full - price) * 100) / 100;
  const limit = parseInt(k.maxKits) > 0 ? parseInt(k.maxKits) : null;
  if (limit != null && (maxK == null || limit < maxK)) { maxK = limit; limiting = 'limite da campanha'; }
  return { full, saving, price, pct: full ? saving / full * 100 : 0, maxKits: maxK, limiting, rows, missing };
}
function isKitVisible(k) { const t = todayYMD(); return k.active && (!k.startDate || t >= k.startDate) && (!k.endDate || t <= k.endDate); }
function kitBadge(k) { const pct = k.full ? k.saving / k.full * 100 : 0; return pct >= 1 ? `− ${Math.round(pct)}%` : ''; }

/* lista de kits para o catálogo (cliente vem pronto do servidor; pré-visualização do admin calcula aqui) */
function clientKits() {
  if (!adminPreview) return data.kits || [];
  return (data.kits || []).filter(isKitVisible).filter(k => !(k.groups || []).length || (previewGroup && (k.groups || []).map(Number).includes(Number(previewGroup)))).map(k => {
    const c = kitCalc(k);
    if (!c.rows.length || c.missing.length || c.rows.some(r => r.inactive)) return null;
    return { ...k, full: c.full, price: c.price, saving: c.saving, maxKits: c.maxKits, available: k.showAvailable ? c.maxKits : null, soldOut: c.maxKits === 0, components: c.rows.map(r => ({ productId: r.p.id, sku: r.p.sku, name: r.p.name, image: r.p.image, qty: r.qty, price: r.p.price, promoPrice: r.promo })) };
  }).filter(Boolean).sort((a, b) => (Number(b.featured) - Number(a.featured)) || ((a.order || 0) - (b.order || 0)));
}
function kitPicture(k) {
  if (k.image) return `<img src="${esc(k.image)}" alt="${esc(k.name)}" loading="lazy">`;
  const imgs = k.components.filter(c => c.image);
  if (!imgs.length) return `<div class="kitMosaic" style="grid-template-columns:1fr"><div class="more" style="font-family:Georgia,serif;font-weight:500;font-size:22px;padding:18px;text-align:center;background:linear-gradient(135deg,#eef1e7,#f6efe2)">✦ ${esc(k.name)}</div></div>`;
  const show = imgs.slice(0, imgs.length > 4 ? 3 : 4);
  return `<div class="kitMosaic">${show.map(c => `<div><img src="${esc(c.image)}" alt="${esc(c.name)}" loading="lazy"></div>`).join('')}${imgs.length > 4 ? `<div class="more">+${k.components.length - 3} itens</div>` : ''}</div>`;
}
function renderKits() {
  const area = $('kitsArea'); if (!area) return;
  const kits = clientKits();
  area.classList.toggle('hidden', !kits.length);
  $('kitCards').innerHTML = kits.map(k => {
    const inCart = cart.find(x => x.key === 'k' + k.id);
    const items = k.components.slice(0, 4).map(c => `<li><b>${c.qty}x</b> ${esc(c.name)}</li>`).join('') + (k.components.length > 4 ? `<li class="muted">+ ${k.components.length - 4} outro(s) item(ns)</li>` : '');
    return `<article class="kitCard ${inCart ? 'inCart' : ''} ${k.soldOut ? 'soldOut' : ''}">${kitBadge(k) ? `<span class="kitBadge">${kitBadge(k)}</span>` : (k.featured ? '<span class="kitBadge gold">Destaque</span>' : '')}<div class="kitPic" onclick="viewKit(${k.id})" title="Ver composição">${kitPicture(k)}</div><div class="kitBody"><div class="kitKicker">Kit promocional${k.endDate ? ' • até ' + new Date(k.endDate + 'T12:00:00').toLocaleDateString('pt-BR') : ''}</div><h3>${esc(k.name)}</h3>${k.description ? `<div class="desc">${esc(k.description)}</div>` : ''}<ul class="kitItems">${items}</ul><div class="kitPrices">${k.saving > 0 ? `<span class="kitFull">${BRL(k.full)}</span>` : ''}<span class="kitPrice">${BRL(k.price)}</span>${k.saving > 0 ? `<span class="kitSave">economize ${BRL(k.saving)}</span>` : ''}</div><div class="kitMeta"><span>por kit</span><span>${k.soldOut ? '<b style="color:#a8452f">Esgotado</b>' : k.available != null ? `${k.available} kit(s) disponíveis` : ''}</span></div>${inCart ? `<div class="cartSignal"><span>✓ No carrinho</span><span>${inCart.qty} kit(s) • ${BRL(inCart.qty * inCart.price)}</span></div>` : ''}<div class="add"><input id="kq${k.id}" type="number" min="1" value="1" ${k.soldOut ? 'disabled' : ''}><button onclick="addKit(${k.id})" ${k.soldOut ? 'disabled style="background:#999"' : ''}>${k.soldOut ? 'Esgotado' : inCart ? 'Adicionar mais' : 'Adicionar kit'}</button></div><button class="link" style="margin-top:8px;text-align:left" onclick="viewKit(${k.id})">Ver composição completa →</button></div></article>`;
  }).join('');
}
function addKit(id) {
  const k = clientKits().find(x => x.id === id); if (!k || k.soldOut) return;
  const q = Math.max(1, parseInt($('kq' + id)?.value) || 1), e = cart.find(x => x.key === 'k' + id), total = (e?.qty || 0) + q;
  if (k.maxKits != null && total > k.maxKits) return toast(`Disponível no máximo ${k.maxKits} kit(s) deste kit.`);
  e ? e.qty = total : cart.push(kitCartLine(k, q));
  saveCart(); toast(`${q} kit(s) "${k.name}" adicionado(s) ao pedido`);
}
function viewKit(id) {
  const k = clientKits().find(x => x.id === id); if (!k) return;
  showModal('Kit ' + k.name, `${k.description ? `<p class="small muted">${esc(k.description)}</p>` : ''}<table class="orderItems"><thead><tr><th></th><th>Produto</th><th>Qtd. no kit</th><th>Unitário</th><th>No kit</th><th>Subtotal</th></tr></thead><tbody>${k.components.map(c => `<tr><td>${c.image ? `<img class="thumb" src="${esc(c.image)}">` : ''}</td><td><b>${esc(c.name)}</b><br><span class="muted">${esc(c.sku)}</span></td><td>${c.qty}</td><td><span class="kitFull">${BRL(c.price)}</span></td><td><b>${BRL(c.promoPrice ?? c.price)}</b></td><td>${BRL((c.promoPrice ?? c.price) * c.qty)}</td></tr>`).join('')}</tbody></table><div class="total" style="margin-top:10px"><span>Valor dos itens separados</span><b>${BRL(k.full)}</b></div>${k.saving > 0 ? `<div class="total"><span>Desconto do kit</span><b style="color:#a8452f">− ${BRL(k.saving)}</b></div>` : ''}<div class="total"><span>Preço do kit</span><b class="grand">${BRL(k.price)}</b></div>${k.soldOut ? '' : `<div class="btnRow"><button class="btn primary" onclick="closeModal();addKit(${k.id})">Adicionar 1 kit ao pedido</button></div>`}`);
}

/* ---------------------------------------------------------------- kits (admin) */
function renderAdminKits() {
  const body = $('adminKitsBody'); if (!body) return;
  const kits = (data.kits || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  body.innerHTML = kits.map(k => {
    const c = kitCalc(k), vis = isKitVisible(k), broken = c.missing.length || c.rows.some(r => r.inactive);
    const st = !k.active ? ['off', 'Inativo'] : broken ? ['red', 'Produto inativo'] : !vis ? ['warn', 'Fora do período'] : c.maxKits === 0 ? ['red', 'Sem estoque'] : ['on', 'Exibindo'];
    return `<tr><td>${k.image ? `<img class="listThumbWide" src="${esc(k.image)}">` : `<div class="listThumbWide" style="display:flex;align-items:center;justify-content:center;color:#a8452f">✦</div>`}</td><td><b>${esc(k.name)}</b><br><span class="muted">${esc((k.description || '').slice(0, 50))}</span></td><td>${c.rows.reduce((a, r) => a + r.qty, 0)} un. / ${c.rows.length} prod.</td><td>${BRL(c.full)}</td><td>${c.saving > 0 ? c.pct.toFixed(1).replace('.', ',') + '% (' + BRL(c.saving) + ')' : '—'}${k.banner ? '<br><span class="tag warn">★ Banner</span>' : ''}<br>${(k.groups || []).length ? (k.groups || []).map(g => `<span class="tag blue" style="margin-top:2px">🔒 ${esc(groupName(g) || '?')}</span>`).join(' ') : '<span class="tag off" style="margin-top:2px">Todos</span>'}</td><td><b>${BRL(c.price)}</b></td><td>${c.maxKits == null ? '<span class="muted">sem limite</span>' : `<b>${c.maxKits}</b><br><span class="muted">${esc(c.limiting || '')}</span>`}</td><td>${formatPeriod(k.startDate, k.endDate)}</td><td><span class="tag ${st[0]}">${st[1]}</span></td><td class="actionsCell"><button onclick="editKit(${k.id})">Editar / Simular</button><button onclick="duplicateKit(${k.id})">Duplicar</button><button onclick="toggleKit(${k.id})">${k.active ? 'Desativar' : 'Ativar'}</button><button class="red" onclick="deleteKit(${k.id})">Excluir</button></td></tr>`;
  }).join('') || '<tr><td colspan="10" class="muted" style="text-align:center;padding:24px">Nenhum kit cadastrado. Clique em "+ Novo kit" para montar o primeiro.</td></tr>';
}

let kitDraft = null;
const KIT_MODES = { percent: 'Desconto (%)', value: 'Desconto (R$)', target: 'Preço final do kit (R$)', manual: 'Preço manual por item' };
function kitEditorHtml(k) {
  const prodOpts = data.products.filter(p => p.active).sort((a, b) => (a.collection || '').localeCompare(b.collection || '') || a.name.localeCompare(b.name))
    .map(p => `<option value="${p.id}">${esc(p.sku)} — ${esc(p.name)} (${esc(p.collection)}) • ${BRL(p.price)}</option>`).join('');
  const mode = k.discountType || 'percent';
  return `<div class="kitEditor"><div>
    <div class="field"><label>Nome do kit</label><input id="kfName" value="${esc(k.name || '')}" placeholder="Ex.: Kit Mesa Posta" oninput="kitDraft.name=this.value"></div>
    <div class="field"><label>Descrição (aparece para o cliente)</label><textarea id="kfDesc" rows="2" oninput="kitDraft.description=this.value">${esc(k.description || '')}</textarea></div>
    <div class="grid2"><div class="field"><label>Condição especial</label><select id="kfDiscType" onchange="setKitMode(this.value)">${Object.entries(KIT_MODES).map(([v, l]) => `<option value="${v}" ${mode === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div><div class="field" id="kfDiscWrap"><label id="kfDiscLabel">${KIT_MODES[mode]}</label><input id="kfDisc" type="number" min="0" step="0.01" value="${k.discount ?? 0}" oninput="kitDraft.discount=this.value;updateKitSim()"></div></div>
    <p class="small muted" style="margin-top:-4px">O desconto é distribuído entre os itens: cada produto entra no pedido com seu <b>preço promocional</b>. Em "Preço manual por item" você digita o preço de cada um na tabela.</p>
    <div class="grid2"><div class="field"><label>Início da campanha</label><input id="kfStart" type="date" value="${k.startDate || ''}" onchange="kitDraft.startDate=this.value"></div><div class="field"><label>Fim da campanha</label><input id="kfEnd" type="date" value="${k.endDate || ''}" onchange="kitDraft.endDate=this.value"></div></div>
    <div class="grid2"><div class="field"><label>Limite de kits na campanha</label><input id="kfMax" type="number" min="0" step="1" value="${k.maxKits || ''}" placeholder="Sem limite" oninput="kitDraft.maxKits=this.value;updateKitSim()"></div><div class="field"><label>Ordem</label><input id="kfOrder" type="number" value="${k.order || 1}" oninput="kitDraft.order=Number(this.value)||1"></div></div>
    <label class="checkRow"><input type="checkbox" ${k.active !== false ? 'checked' : ''} onchange="kitDraft.active=this.checked"> Kit ativo (visível no catálogo)</label><br>
    <label class="checkRow"><input type="checkbox" ${k.featured ? 'checked' : ''} onchange="kitDraft.featured=this.checked"> Primeiro da lista de kits</label><br>
    <label class="checkRow"><input type="checkbox" ${k.showAvailable ? 'checked' : ''} onchange="kitDraft.showAvailable=this.checked"> Mostrar ao cliente quantos kits restam</label>
    <div class="audBox"><label>Disponível para</label>
     <label class="checkRow"><input type="radio" name="kfAud" ${(k.groups || []).length ? '' : 'checked'} onchange="kitDraft.groups=[];renderKitAudience()"> Todos os clientes</label>
     <label class="checkRow"><input type="radio" name="kfAud" ${(k.groups || []).length ? 'checked' : ''} onchange="kitDraft.groups=kitDraft.groups.length?kitDraft.groups:[];kitDraft._restrict=true;renderKitAudience()"> Somente grupos de clientes</label>
     <div id="kfAudGroups"></div></div>
    <div class="field" style="margin-top:12px"><label>URL da imagem do kit (opcional — sem imagem, usa as fotos dos produtos)</label><input id="kfImageUrl" value="${esc(k.image || '')}" placeholder="https://..." oninput="kitDraft.image=normImg(this.value);imgCheck('kfPreview',kitDraft.image)"></div>
    <div id="kfPreview" class="adminImagePreviewLarge" style="height:120px"></div>
    <div class="bannerCfg"><label class="checkRow" style="font-weight:800"><input id="kfBanner" type="checkbox" ${k.banner ? 'checked' : ''} onchange="kitDraft.banner=this.checked;$('kfBannerFields').classList.toggle('hidden',!this.checked);renderBannerPreview()"> ★ Destacar na tela principal (banner de campanha)</label>
     <div id="kfBannerFields" class="${k.banner ? '' : 'hidden'}">
      <div class="grid2"><div class="field"><label>Selo / campanha</label><input value="${esc(k.bannerTag || '')}" placeholder="Black Friday 2026" oninput="kitDraft.bannerTag=this.value;renderBannerPreview()"></div><div class="field"><label>Título</label><input value="${esc(k.bannerTitle || '')}" placeholder="Kit ${esc(k.name || '')}" oninput="kitDraft.bannerTitle=this.value;renderBannerPreview()"></div></div>
      <div class="field"><label>Subtítulo (em branco = composição do kit)</label><input value="${esc(k.bannerSubtitle || '')}" placeholder="12 pratos rasos + 12 pratos de sobremesa" oninput="kitDraft.bannerSubtitle=this.value;renderBannerPreview()"></div>
      <div class="grid2"><div class="field"><label>Texto do botão</label><input value="${esc(k.bannerButton || '')}" placeholder="Quero essa oportunidade" oninput="kitDraft.bannerButton=this.value;renderBannerPreview()"></div><div class="field"><label>URL da imagem do banner</label><input value="${esc(k.bannerImage || '')}" placeholder="https://... (em branco = imagem do kit)" oninput="kitDraft.bannerImage=normImg(this.value);renderBannerPreview()"></div></div>
      <div id="kfBannerPreview"></div>
     </div></div>
  </div><div>
    <h3 style="font-family:Georgia,serif;font-weight:500;margin:0 0 8px">Produtos do kit</h3>
    <div class="kitPicker2"><select id="kfCol" onchange="refreshKitPicker()"><option value="">Todas as coleções</option>${data.collections.slice().sort((a, b) => a.name.localeCompare(b.name)).map(c => `<option value="${esc(c.name)}">${esc(c.name)} (${data.products.filter(p => p.active && p.collection === c.name).length})</option>`).join('')}</select><input id="kfSearch" placeholder="Buscar produto ou código…" oninput="refreshKitPicker()"></div>
    <div class="kitPicker"><select id="kfProd"></select><input id="kfProdQty" type="number" min="1" value="1" title="Quantidade por kit"><button class="btn primary" onclick="addKitItem()">+ Incluir</button></div>
    <div id="kfPickInfo" class="small muted" style="margin:-4px 0 8px"></div>
    <div class="tableWrap"><table class="kitComp"><thead><tr><th>Produto</th><th>Preço un.</th><th>Promo un.</th><th>Qtd./kit</th><th>Subtotal promo</th><th>Margem líq.</th><th>Estoque</th><th>Rende</th><th></th></tr></thead><tbody id="kfItems"></tbody></table></div>
    <div id="kfSim"></div>
    <div id="kfFin"></div>
    <div class="simTarget"><div class="row"><b>Simular campanha:</b> quero montar <input id="kfSimQty" type="number" min="1" value="${k.simQty || 10}" oninput="updateKitSim()"> kits</div><div id="kfSimTarget"></div></div>
  </div></div>
  <div id="kfError" class="error hidden"></div>
  <div class="btnRow"><button class="btn" onclick="closeModal()">Cancelar</button><button class="btn primary" onclick="saveKit()">Salvar kit</button></div>`;
}
function renderKitAudience() {
  const el = $('kfAudGroups'); if (!el || !kitDraft) return;
  const restrict = document.querySelectorAll('input[name=kfAud]')[1]?.checked;
  if (!restrict) { el.innerHTML = '<span class="small muted">Todos os clientes com acesso ativo veem este kit.</span>'; return; }
  const gs = groups();
  el.innerHTML = gs.length ? gs.map(g => `<label class="checkRow audG"><input type="checkbox" ${kitDraft.groups.map(Number).includes(g.id) ? 'checked' : ''} onchange="toggleKitGroup(${g.id},this.checked)"> ${esc(g.name)} <span class="muted">(${clients.filter(c => Number(c.groupId) === g.id).length} cliente(s))</span></label>`).join('') + '<div class="small muted">Só os clientes desses grupos veem e podem pedir este kit.</div>'
    : '<span class="small" style="color:#a34b44">Nenhum grupo cadastrado. Crie em Clientes / Tokens → Grupos de clientes.</span>';
}
function toggleKitGroup(id, on) { const s = new Set(kitDraft.groups.map(Number)); on ? s.add(id) : s.delete(id); kitDraft.groups = [...s]; }
function openKitEditor(k, title) { kitDraft = JSON.parse(JSON.stringify(k)); kitDraft.items = kitDraft.items || []; kitDraft.groups = (kitDraft.groups || []).map(Number); showModal(title, kitEditorHtml(kitDraft), true); imgCheck('kfPreview', kitDraft.image); renderKitAudience(); updateKitSim(); }
function newKit() { openKitEditor({ active: true, featured: false, showAvailable: false, discountType: 'percent', discount: 10, order: (data.kits || []).length + 1, items: [], bannerButton: 'Quero essa oportunidade' }, 'Novo kit promocional'); }
function editKit(id) { openKitEditor(data.kits.find(x => x.id === id), 'Editar kit promocional'); }
function duplicateKit(id) { const k = JSON.parse(JSON.stringify(data.kits.find(x => x.id === id))); delete k.id; k.name = k.name + ' (cópia)'; k.active = false; k.banner = false; openKitEditor(k, 'Novo kit (cópia)'); }
function setKitMode(m) {
  const c = kitCalc(kitDraft);
  // ao trocar o modo, preserva o preço atual do kit
  if (m === 'manual') c.rows.forEach(r => { const it = kitDraft.items.find(i => Number(i.productId) === r.p.id); it.promoPrice = r.promo; });
  kitDraft.discount = m === 'percent' ? Math.round(c.pct * 100) / 100 : m === 'value' ? c.saving : m === 'target' ? c.price : 0;
  kitDraft.discountType = m;
  $('kfDiscLabel').textContent = KIT_MODES[m]; $('kfDisc').value = kitDraft.discount; $('kfDiscWrap').style.visibility = m === 'manual' ? 'hidden' : 'visible';
  updateKitSim();
}
function addKitItem() {
  const pid = Number($('kfProd').value), q = Math.max(1, parseInt($('kfProdQty').value) || 1);
  if (!pid) return toast('Selecione um produto');
  const e = kitDraft.items.find(i => Number(i.productId) === pid);
  e ? e.qty = Number(e.qty) + q : kitDraft.items.push({ productId: pid, qty: q, promoPrice: data.products.find(p => p.id === pid)?.price });
  $('kfProd').value = ''; $('kfProdQty').value = 1; updateKitSim();
}
function refreshKitPicker() {
  const sel = $('kfProd'); if (!sel || !kitDraft) return;
  const col = $('kfCol').value, q = ($('kfSearch').value || '').trim().toLowerCase(), keep = sel.value;
  const inKit = new Map(kitDraft.items.map(i => [Number(i.productId), i.qty]));
  const list = data.products.filter(p => p.active && (!col || p.collection === col) && (!q || p.name.toLowerCase().includes(q) || String(p.sku).includes(q)))
    .sort((a, b) => (a.collection || '').localeCompare(b.collection || '') || a.name.localeCompare(b.name));
  const nIn = list.filter(p => inKit.has(p.id)).length;
  sel.innerHTML = `<option value="">${list.length ? `Selecione um produto… (${list.length} disponíveis${nIn ? `, ${nIn} já no kit` : ''})` : 'Nenhum produto encontrado'}</option>` +
    list.map(p => `<option value="${p.id}" ${inKit.has(p.id) ? 'class="inKit"' : ''}>${inKit.has(p.id) ? '✓ ' : '\u2003 '}${esc(p.sku)} — ${esc(p.name)}${col ? '' : ` (${esc(p.collection)})`} • ${BRL(p.price)} • Est.: ${stockOf(p) == null ? 's/ controle' : stockOf(p).toLocaleString('pt-BR') + (stockOf(p) === 0 ? ' ⚠ sem estoque' : '')}${inKit.has(p.id) ? ` — já no kit: ${inKit.get(p.id)} un.` : ''}</option>`).join('');
  if ([...sel.options].some(o => o.value === keep)) sel.value = keep;
  $('kfPickInfo').innerHTML = kitDraft.items.length ? `✓ = produto já incluído no kit (incluir de novo soma a quantidade). Kit com <b>${kitDraft.items.length}</b> produto(s).` : '';
}
function setKitItemQty(pid, v) { const e = kitDraft.items.find(i => Number(i.productId) === pid); if (e) { e.qty = Math.max(1, parseInt(v) || 1); updateKitSim(); } }
function setKitItemPromo(pid, v) { const e = kitDraft.items.find(i => Number(i.productId) === pid); if (e) { e.promoPrice = Math.max(0, Number(v) || 0); updateKitSim(); } }
function removeKitItem(pid) { kitDraft.items = kitDraft.items.filter(i => Number(i.productId) !== pid); updateKitSim(); }
function updateKitSim() {
  if (!kitDraft) return;
  const c = kitCalc(kitDraft), manual = kitDraft.discountType === 'manual';
  refreshKitPicker();
  if ($('kfDiscWrap')) $('kfDiscWrap').style.visibility = manual ? 'hidden' : 'visible';
  $('kfItems').innerHTML = c.rows.length ? c.rows.map(r => `<tr><td><b>${esc(r.p.name)}</b><br><span class="muted">${esc(r.p.sku)}${r.inactive ? ' • <b style="color:#a8452f">INATIVO</b>' : ''}</span></td><td>${BRL(r.p.price)}</td><td>${manual ? `<input type="number" min="0" step="0.01" value="${r.promo}" style="width:78px" onchange="setKitItemPromo(${r.p.id},this.value)">` : `<b>${BRL(r.promo)}</b>`}</td><td><input type="number" min="1" value="${r.qty}" onchange="setKitItemQty(${r.p.id},this.value)"></td><td>${BRL(r.promo * r.qty)}</td><td>${(() => { const f = finOf(r.p); if (!f.hasCost) return '<span class="muted" title="Sem custo cadastrado">—</span>'; const m = marginAt(f, r.promo), st = finStatus(m, f.lucro, f.lucroMin); return dotF(st) + pctF(m); })()}</td><td>${r.stock == null ? '<span class="muted">—</span>' : r.stock.toLocaleString('pt-BR')}</td><td class="${r.perItem != null && r.p.name === c.limiting ? 'lim' : ''}">${r.perItem == null ? '<span class="muted">∞</span>' : r.perItem + ' kits'}</td><td><button class="link" style="color:#a34b44" onclick="removeKitItem(${r.p.id})">remover</button></td></tr>`).join('')
    : '<tr><td colspan="9" class="muted" style="text-align:center;padding:16px">Inclua os produtos que compõem o kit.</td></tr>';
  const n = c.maxKits;
  $('kfSim').innerHTML = `<div class="simBox"><h4>Simulação do kit</h4><div class="simGrid">
    <div class="simStat"><small>Preço cheio (itens)</small><strong>${BRL(c.full)}</strong></div>
    <div class="simStat"><small>Desconto</small><strong>${BRL(c.saving)} <span style="font-size:11px">(${c.pct.toFixed(1).replace('.', ',')}%)</span></strong></div>
    <div class="simStat hl"><small>Preço do kit</small><strong>${BRL(c.price)}</strong></div>
    <div class="simStat hl"><small>Kits possíveis</small><strong>${n == null ? 'Sem limite' : n.toLocaleString('pt-BR')}</strong></div>
    <div class="simStat"><small>Unidades por kit</small><strong>${c.rows.reduce((a, r) => a + r.qty, 0)}</strong></div>
    <div class="simStat"><small>Faturamento máximo</small><strong>${n == null ? '—' : BRL(n * c.price)}</strong></div>
    <div class="simStat"><small>Valor cheio desses kits</small><strong>${n == null ? '—' : BRL(n * c.full)}</strong></div>
    <div class="simStat"><small>Desconto total concedido</small><strong>${n == null ? '—' : BRL(n * c.saving)}</strong></div>
  </div><div class="simNote">${!c.rows.length ? 'Inclua produtos para simular.' : n == null ? 'Nenhum produto do kit tem estoque informado, então não há limite de kits. Informe o "Estoque (quantidade)" nos produtos para calcular.' : n === 0 ? `<b>Não é possível montar nenhum kit</b> — limitado por: ${esc(c.limiting)}.` : `Item que limita o kit: <b>${esc(c.limiting)}</b>. ${c.rows.filter(r => r.perItem != null).length < c.rows.length ? 'Produtos sem estoque informado não limitam o cálculo.' : ''}`}${kitDraft.discountType === 'target' && c.rows.length && Math.abs(c.price - Number(kitDraft.discount)) > 0.001 ? `<br>Arredondamento dos preços unitários: o kit fica em ${BRL(c.price)}.` : ''}</div></div>`;
  const want = Math.max(1, parseInt($('kfSimQty')?.value) || 1);
  $('kfSimTarget').innerHTML = c.rows.length ? `<table class="kitComp" style="margin-top:8px"><thead><tr><th>Produto</th><th>Necessário</th><th>Estoque</th><th>Situação</th></tr></thead><tbody>${c.rows.map(r => { const need = r.qty * want, falta = r.stock == null ? 0 : need - r.stock; return `<tr><td>${esc(r.p.name)}</td><td>${need.toLocaleString('pt-BR')}</td><td>${r.stock == null ? '—' : r.stock.toLocaleString('pt-BR')}</td><td>${r.stock == null ? '<span class="muted">sem controle</span>' : falta > 0 ? `<span class="short">faltam ${falta.toLocaleString('pt-BR')}</span>` : `<span class="ok">ok (sobram ${(-falta).toLocaleString('pt-BR')})</span>`}</td></tr>`; }).join('')}</tbody></table>
    <div class="total" style="margin-top:8px;font-size:12px"><span>${want} kits × ${BRL(c.price)}</span><b class="grand">${BRL(want * c.price)}</b></div><div class="small muted">Valor cheio: ${BRL(want * c.full)} • desconto total: ${BRL(want * c.saving)}${n != null && want > n ? ` • <span class="short">acima do possível (${n})</span>` : ''}</div>` : '';
  $('kfFin').innerHTML = kitFinHtml(c, n ?? Math.max(1, parseInt($('kfSimQty')?.value) || 1), n == null);
  renderBannerPreview();
}
function kitDeal(c, nKits) { return { items: c.rows.map(r => ({ productId: r.p.id, price: r.price, qty: r.qty * (nKits || 1), disc: r.price ? (1 - r.promo / r.price) * 100 : 0 })), gd: 0, bp: 0, bonus: {} }; }
function kitFinHtml(c, nCampaign, isTarget) {
  if (!c.rows.length) return '';
  const d = dealCalc(kitDeal(c, 1));
  if (d.missingCost === c.rows.length) return `<div class="kfinBox"><div class="kfinHead"><b>💼 Resumo financeiro do kit</b><span class="lockTag">🔒 só administrador</span></div><p class="small muted">Cadastre o custo líquido dos produtos (no produto ou pelo CSV com Preco.Com.Liq) para ver custo, margem, preço mínimo e desconto máximo do kit.</p></div>`;
  const pMin = d.C / (1 - d.avgDed - d.min / 100), dMax = c.full ? 1 - pMin / c.full : NaN, st = finStatus(d.mLiq, d.alvo, d.min);
  const msg = st === 'g' ? `o kit está saudável. Dá para baixar o preço até <b>${BRL(pMin)}</b> (${pctF(Math.max(0, 1 - pMin / c.price))} abaixo do atual) mantendo o lucro mínimo de ${String(+d.min.toFixed(1)).replace('.', ',')}%.`
    : st === 'y' ? `margem abaixo do lucro alvo (${String(+d.alvo.toFixed(1)).replace('.', ',')}%), mas acima do mínimo. Preço mínimo do kit: <b>${BRL(pMin)}</b>.`
    : `<b>margem abaixo do lucro mínimo</b>. Para atingir ${String(+d.min.toFixed(1)).replace('.', ',')}%, o kit precisa custar ao menos <b>${BRL(pMin)}</b> (desconto máximo de ${pctF(dMax)} sobre o preço cheio).`;
  return `<div class="kfinBox"><div class="kfinHead"><b>💼 Resumo financeiro do kit</b><span class="lockTag">🔒 só administrador</span></div>
  <div class="kfinGrid">
   <div><small>Custo do kit</small><b>${BRL(d.C)}</b></div>
   <div><small>Impostos + comissão + custo op.</small><b>${BRL(d.ded)}</b></div>
   <div><small>Lucro líquido por kit</small><b>${BRL(d.lucro)}</b></div>
   <div><small>Margem líquida</small><b class="${st}">${dotF(st)}${pctF(d.mLiq)}</b></div>
   <div><small>Margem líquida sem desconto</small><b>${pctF(d.mLiqGross)}</b></div>
   <div><small>Margem bruta (preço − custo)</small><b>${pctF(d.mBruta)}</b></div>
   <div><small>Lucro ${isTarget ? 'da meta' : 'da campanha'} (${nCampaign} kits)</small><b>${BRL(d.lucro * nCampaign)}</b></div>
   <div><small>Preço mínimo do kit</small><b class="y">${BRL(pMin)}</b></div>
   <div><small>Desconto máximo s/ preço cheio</small><b class="y">${pctF(dMax)}</b></div>
  </div>${thermoHtml(d.mLiq, d.alvo, d.min)}
  <div class="kfinTip">◈ <b>Inteligência comercial:</b> ${msg}${d.missingCost ? ` <br><span style="color:#f3d79a">⚠ ${d.missingCost} produto(s) do kit sem custo cadastrado — o resultado está incompleto.</span>` : ''}</div></div>`;
}
function renderBannerPreview() {
  const el = $('kfBannerPreview'); if (!el || !kitDraft) return;
  if (!kitDraft.banner) { el.innerHTML = ''; return; }
  const c = kitCalc(kitDraft);
  const k = { ...kitDraft, full: c.full, price: c.price, saving: c.saving, components: c.rows.map(r => ({ name: r.p.name, qty: r.qty, image: r.p.image })) };
  el.innerHTML = `<div class="small muted" style="margin:6px 0">Pré-visualização do banner:</div>${kitBannerHtml(k, true)}`;
}
function saveKit() {
  const k = kitDraft, err = $('kfError');
  k.name = $('kfName').value.trim(); k.description = $('kfDesc').value.trim(); k.discount = Number($('kfDisc').value) || 0; k.discountType = $('kfDiscType').value;
  k.startDate = $('kfStart').value; k.endDate = $('kfEnd').value; k.maxKits = $('kfMax').value ? Math.max(0, parseInt($('kfMax').value) || 0) : ''; k.order = Number($('kfOrder').value) || 1; k.image = normImg($('kfImageUrl').value);
  k.simQty = Math.max(1, parseInt($('kfSimQty').value) || 1);
  const c = kitCalc(k);
  c.rows.forEach(r => { const it = k.items.find(i => Number(i.productId) === r.p.id); if (it) it.promoPrice = r.promo; });
  const restrictAud = document.querySelectorAll('input[name=kfAud]')[1]?.checked; if (!restrictAud) k.groups = []; delete k._restrict;
  const msg = !k.name ? 'Informe o nome do kit.' : !k.items.length ? 'Inclua ao menos um produto no kit.' : (restrictAud && !k.groups.length) ? 'Marque ao menos um grupo de clientes (ou escolha "Todos os clientes").' : (k.discountType === 'percent' && k.discount > 100) ? 'O desconto percentual não pode passar de 100%.' : (k.discountType === 'value' && k.discount > c.full) ? 'O desconto não pode ser maior que o valor cheio do kit.' : (k.discountType === 'target' && k.discount > c.full) ? 'O preço final não pode ser maior que o valor cheio (' + BRL(c.full) + ').' : (k.startDate && k.endDate && k.endDate < k.startDate) ? 'A data final é anterior à inicial.' : '';
  if (msg) { err.textContent = msg; err.classList.remove('hidden'); return; }
  data.kits = data.kits || [];
  if (k.id) Object.assign(data.kits.find(x => x.id === k.id), k); else { k.id = nextId(data.kits); data.kits.push(k); }
  kitDraft = null; closeModal(); saveData('Kit salvo e publicado');
}
function toggleKit(id) { const k = data.kits.find(x => x.id === id); k.active = !k.active; saveData(k.active ? 'Kit ativado' : 'Kit desativado'); }
function deleteKit(id) { if (!confirm('Excluir este kit? Pedidos já feitos com ele continuam no histórico.')) return; data.kits = data.kits.filter(x => x.id !== id); saveData('Kit excluído'); }

/* ---------------------------------------------------------------- banner de kit na Home */
function kitBannerImage(k) { return k.bannerImage || k.image || (k.components || []).find(c => c.image)?.image || ''; }
function kitBannerSubtitle(k) { return k.bannerSubtitle || (k.components || []).map(c => `${c.qty}× ${c.name}`).join(' + '); }
function kitBannerHtml(k, preview) {
  const img = kitBannerImage(k);
  return `<article class="kitBanner ${img ? '' : 'noImg'}"><div class="kbText">${k.bannerTag ? `<div class="kbTag">${esc(k.bannerTag)}</div>` : ''}<div class="kbTitle">${esc(k.bannerTitle || ('Kit ' + (k.name || '')))}</div><div class="kbSub">${esc(kitBannerSubtitle(k))}</div><div class="kbPrice">${k.saving > 0 ? `<s>${BRL(k.full)}</s>` : ''}<b>${BRL(k.price)}</b></div><button class="kbBtn" ${k.soldOut ? 'disabled' : ''} onclick="${preview ? 'void 0' : `quickKit(${k.id})`}">${k.soldOut ? 'Esgotado' : esc(k.bannerButton || 'Quero essa oportunidade')}</button><button class="kbLink" onclick="${preview ? 'void 0' : `viewKit(${k.id})`}">Ver o que vem no kit →</button></div><div class="kbPic">${img ? `<img src="${esc(img)}" alt="${esc(k.name)}" loading="lazy">` : ''}${kitBadge(k) ? `<span class="kitBadge">${kitBadge(k)}</span>` : ''}</div></article>`;
}
function renderKitBanners() {
  const el = $('kitBanners'); if (!el) return;
  const list = clientKits().filter(k => k.banner);
  el.classList.toggle('hidden', !list.length);
  el.classList.toggle('single', list.length === 1);
  el.innerHTML = list.map(k => kitBannerHtml(k)).join('');
}
function quickKit(id) {
  const k = clientKits().find(x => x.id === id); if (!k || k.soldOut) return;
  const e = cart.find(x => x.key === 'k' + id);
  if (k.maxKits != null && (e?.qty || 0) + 1 > k.maxKits) return toast(`Disponível no máximo ${k.maxKits} kit(s).`);
  e ? e.qty += 1 : cart.push(kitCartLine(k, 1));
  saveCart(); openCart(); toast(`Kit "${k.name}" adicionado com os preços promocionais`);
}

/* ---------------------------------------------------------------- imagens por URL */
/* converte links de compartilhamento (Google Drive, Dropbox, OneDrive) em link direto da imagem */
function normImg(u) {
  u = (u || '').trim(); if (!u) return '';
  let m = u.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]{20,})/);
  if (m) return `https://lh3.googleusercontent.com/d/${m[1]}`;
  if (/dropbox\.com\//.test(u)) { try { const x = new URL(u); x.searchParams.delete('dl'); x.searchParams.set('raw', '1'); return x.toString(); } catch { return u; } }
  if (/(1drv\.ms|onedrive\.live\.com)\//.test(u) && !/api\.onedrive\.com/.test(u)) {
    const b64 = btoa(unescape(encodeURIComponent(u))).replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
    return `https://api.onedrive.com/v1.0/shares/u!${b64}/root/content`;
  }
  return u;
}
/* mostra a imagem e confirma se carregou */
function imgCheck(boxId, url) {
  const box = $(boxId); if (!box) return;
  if (!url) { box.innerHTML = '<span class="muted small">Sem imagem</span>'; return; }
  box.innerHTML = '<span class="muted small">Carregando imagem…</span>';
  const im = new Image();
  im.onload = () => { box.innerHTML = `<img src="${esc(url)}" style="cursor:zoom-in" onclick="zoomUrl('${esc(url)}')"><span class="imgOk">✓ ${im.naturalWidth}×${im.naturalHeight}px</span>`; };
  im.onerror = () => { box.innerHTML = '<span class="imgErr">⚠ Não foi possível carregar esta URL.<br>Confira se o link é público e aponta para a imagem.</span>'; };
  im.src = url;
}
function zoomUrl(url) { if (!url) return; $('imageZoomTarget').src = url; $('imageZoomModal').classList.add('on'); document.body.style.overflow = 'hidden'; }

/* ---------------------------------------------------------------- produtos: CSV */
const CSV_COLS = ['codigo', 'produto', 'colecao', 'preco', 'estoque', 'min', 'emb', 'url_imagem'];
const CSV_HEAD = ['Código', 'Produto', 'Coleção', 'Preço', 'Estoque', 'Mín', 'Emb', 'URL da imagem', 'Preco.Com.Liq', 'Perc.Icms.Ven', 'Perc.Pis.Ven', 'Perc.Cofins.Ven', 'Perc.Irpj.Ven', 'Perc.Cs.Ven', 'Perc.Comis.Ven', 'Perc.Custo.Op.Ven', 'Perc.Lucro.Ven', 'Perc.Lucro.Min'];
function csvCell(v) { v = String(v ?? ''); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
function downloadText(name, text) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
function brNum(v, dec = 2) { return v === '' || v == null ? '' : Number(v).toFixed(dec).replace('.', ','); }
function csvModel() {
  const ex = [['0000133', 'BULE COM INFUSOR', 'HORTICOOL BLUE', '308,90', '12', '1', '1', 'https://seusite.com.br/fotos/0000133.jpg', '115,22', '0', '0', '0', '10,7', '0', '0', '8', '44', '30'], ['0000135', 'ACUCAREIRO', 'HORTICOOL BLUE', '153,97', '', '1', '1', '', '', '', '', '', '', '', '', '', '', '']];
  downloadText('modelo_produtos_zionne.csv', [CSV_HEAD.join(';'), ...ex.map(r => r.map(csvCell).join(';'))].join('\r\n'));
}
function exportProductsCsv() {
  const rows = data.products.map(p => [p.sku, p.name, p.collection, brNum(p.price), p.stockQty ?? '', p.minQty || 1, p.packQty || 1, p.image && !p.image.startsWith('/img/') ? p.image : '', p.cost === '' || p.cost == null ? '' : brNum(p.cost), ...FIN_CSV.slice(1).map(([k]) => p.fin && p.fin[k] != null ? String(p.fin[k]).replace('.', ',') : '')]);
  downloadText('produtos_zionne_' + todayYMD() + '.csv', [CSV_HEAD.join(';'), ...rows.map(r => r.map(csvCell).join(';'))].join('\r\n'));
}
function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/)[0] || '', delim = [';', '\t', ','].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}
const FIN_CSV = [['cost', 'Preco.Com.Liq'], ['icms', 'Perc.Icms.Ven'], ['pis', 'Perc.Pis.Ven'], ['cofins', 'Perc.Cofins.Ven'], ['irpj', 'Perc.Irpj.Ven'], ['cs', 'Perc.Cs.Ven'], ['comis', 'Perc.Comis.Ven'], ['custoOp', 'Perc.Custo.Op.Ven'], ['lucro', 'Perc.Lucro.Ven'], ['lucroMin', 'Perc.Lucro.Min']];
function headKey(h) {
  h = h.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
  const fin = { precocomliq: 'f_cost', custo: 'f_cost', custoliquido: 'f_cost', custoaquisicao: 'f_cost', percicmsven: 'f_icms', icms: 'f_icms', percpisven: 'f_pis', pis: 'f_pis', perccofinsven: 'f_cofins', cofins: 'f_cofins', percirpjven: 'f_irpj', irpj: 'f_irpj', perccsven: 'f_cs', cs: 'f_cs', perccomisven: 'f_comis', comissao: 'f_comis', perccustoopven: 'f_custoOp', custoop: 'f_custoOp', perclucroven: 'f_lucro', lucro: 'f_lucro', perclucrominven: 'f_lucroMin', perclucromin: 'f_lucroMin', lucromin: 'f_lucroMin', lucrominimo: 'f_lucroMin', precoideal: '_ignore' };
  if (fin[h]) return fin[h] === '_ignore' ? null : fin[h];
  if (/^(codigo|cod|sku|referencia|ref)$/.test(h)) return 'codigo';
  if (/^(produto|nome|nomedoproduto|descricaodoproduto)$/.test(h)) return 'produto';
  if (/^colecao/.test(h)) return 'colecao';
  if (/^(preco|valor|precounitario|precoun)/.test(h)) return 'preco';
  if (/^(estoque|saldo|qtdestoque|quantidade)/.test(h)) return 'estoque';
  if (/^(min|minimo|qtdmin|quantidademinima)/.test(h)) return 'min';
  if (/^(emb|embalagem|multiplo)/.test(h)) return 'emb';
  if (/(url|imagem|foto|image)/.test(h)) return 'url_imagem';
  if (/^descricao/.test(h)) return 'descricao';
  return null;
}
function parseMoney(v) { v = String(v || '').replace(/[R$\s]/g, ''); if (!v) return null; if (v.includes(',')) v = v.replace(/\./g, '').replace(',', '.'); const n = Number(v); return isNaN(n) ? NaN : n; }
function parseIntBR(v) { v = String(v || '').trim().replace(/\./g, '').replace(',', '.'); if (!v) return null; const n = Math.floor(Number(v)); return isNaN(n) ? NaN : n; }
let csvPlan = null;
function importProductsCsv(e) {
  const f = e.target.files?.[0]; if (!f) return; e.target.value = '';
  const r = new FileReader();
  r.onload = () => {
    let text = r.result;
    if (text.includes('�')) { const r2 = new FileReader(); r2.onload = () => buildCsvPlan(r2.result); r2.readAsText(f, 'windows-1252'); return; }
    buildCsvPlan(text);
  };
  r.readAsText(f, 'utf-8');
}
function buildCsvPlan(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return toast('CSV vazio ou sem linhas de produto.');
  const keys = rows[0].map(headKey);
  if (!keys.includes('codigo')) return alert('Não encontrei a coluna "Código" no cabeçalho.\nUse o botão "Baixar modelo" para ver o formato esperado.');
  const bySku = new Map(data.products.map(p => [String(p.sku).trim(), p]));
  const colNames = new Set(data.collections.map(c => c.name.toLowerCase()));
  const plan = [], seen = new Set(), newCols = new Set();
  rows.slice(1).forEach((r, i) => {
    const o = {}; keys.forEach((k, j) => { if (k) o[k] = (r[j] ?? '').trim(); });
    const sku = o.codigo, line = i + 2, cur = bySku.get(sku), errs = [];
    if (!sku) return;
    if (seen.has(sku)) errs.push('código repetido no arquivo'); seen.add(sku);
    const price = parseMoney(o.preco), stock = parseIntBR(o.estoque), min = parseIntBR(o.min), emb = parseIntBR(o.emb);
    const fin = { ...(cur?.fin || {}) }; let cost = cur?.cost ?? '';
    FIN_CSV.forEach(([k]) => { const raw = o['f_' + k]; if (raw === undefined || raw === '') return; const v = parseMoney(raw); if (Number.isNaN(v)) { errs.push(k === 'cost' ? 'custo inválido' : `% ${k} inválido`); return; } if (k === 'cost') cost = v; else fin[k] = v; });
    if (Number.isNaN(price)) errs.push('preço inválido'); if (Number.isNaN(stock)) errs.push('estoque inválido'); if (Number.isNaN(min)) errs.push('mín. inválido'); if (Number.isNaN(emb)) errs.push('emb. inválida');
    if (!cur && !o.produto) errs.push('produto novo sem nome'); if (!cur && price == null) errs.push('produto novo sem preço'); if (!cur && !o.colecao) errs.push('produto novo sem coleção');
    const next = {
      sku, name: o.produto || cur?.name, collection: o.colecao || cur?.collection, price: price ?? cur?.price,
      stockQty: 'estoque' in o ? (stock == null ? (o.estoque === '' && cur ? cur.stockQty ?? '' : '') : stock) : (cur?.stockQty ?? ''),
      minQty: min ?? cur?.minQty ?? 1, packQty: emb ?? cur?.packQty ?? 1,
      image: o.url_imagem ? normImg(o.url_imagem) : (cur?.image || ''), cost, fin, description: o.descricao || cur?.description || 'Porcelana de alto padrão, acabamento refinado e design exclusivo.'
    };
    const exCol = data.collections.find(c => c.name.toLowerCase() === String(next.collection || '').toLowerCase()) || [...newCols].map(n => ({ name: n })).find(c => c.name.toLowerCase() === String(next.collection || '').toLowerCase());
    if (exCol) next.collection = exCol.name; else if (next.collection) newCols.add(next.collection);
    const changes = cur ? ['name', 'collection', 'price', 'stockQty', 'minQty', 'packQty', 'image', 'description', 'cost'].filter(k => String(cur[k] ?? '') !== String(next[k] ?? '')).concat(JSON.stringify(cur.fin || {}) !== JSON.stringify(next.fin || {}) ? ['fin'] : []) : [];
    plan.push({ line, cur, next, errs, status: errs.length ? 'erro' : !cur ? 'novo' : changes.length ? 'alterado' : 'igual', changes });
  });
  csvPlan = { plan, newCols: [...newCols], missing: data.products.filter(p => !seen.has(String(p.sku).trim()) && p.active) };
  showCsvPreview();
}
function showCsvPreview() {
  const { plan, newCols, missing } = csvPlan, cnt = s => plan.filter(x => x.status === s).length;
  const fmtChg = (x, k, f = v => v) => x.cur && x.changes.includes(k) ? `<span class="chg">${esc(f(x.cur[k]) ?? '—')} → <b>${esc(f(x.next[k]) ?? '—')}</b></span>` : esc(f(x.next[k]) ?? '');
  showModal('Importar produtos — conferência', `<div class="csvSummary"><span class="tag on">${cnt('novo')} novos</span><span class="tag blue">${cnt('alterado')} alterados</span><span class="tag off">${cnt('igual')} sem alteração</span>${cnt('erro') ? `<span class="tag red">${cnt('erro')} com erro (serão ignorados)</span>` : ''}${newCols.length ? `<span class="tag warn">Coleções novas: ${esc(newCols.join(', '))}</span>` : ''}</div>
  <p class="small muted">Confira as miniaturas: elas são carregadas direto da URL informada. ⚠ indica imagem que não abriu. Campos em branco no CSV mantêm o valor atual do produto.</p>
  <div class="tableWrap" style="max-height:48vh;overflow:auto"><table class="adminTable csvTable"><thead><tr><th>Linha</th><th>Imagem</th><th>Código</th><th>Produto</th><th>Coleção</th><th>Preço</th><th>Estoque</th><th>Mín</th><th>Emb</th><th>Custo</th><th>Margem</th><th>Situação</th></tr></thead><tbody>${plan.map(x => `<tr class="${x.status}"><td>${x.line}</td><td>${x.next.image ? `<div class="csvThumb"><img src="${esc(x.next.image)}" loading="lazy" onclick="zoomUrl(this.src)" onerror="this.parentNode.innerHTML='<span class=imgErr title=&quot;Imagem não carregou&quot;>⚠</span>'"></div>` : '<span class="muted">—</span>'}</td><td>${esc(x.next.sku)}</td><td>${fmtChg(x, 'name')}</td><td>${fmtChg(x, 'collection')}</td><td>${fmtChg(x, 'price', v => v == null ? null : BRL(v))}</td><td>${fmtChg(x, 'stockQty', v => v === '' ? '—' : v)}</td><td>${fmtChg(x, 'minQty')}</td><td>${fmtChg(x, 'packQty')}</td><td>${fmtChg(x, 'cost', v => v === '' || v == null ? '—' : BRL(v))}</td><td>${prodMarginCell(x.next)}</td><td>${x.status === 'erro' ? `<span class="tag red">${esc(x.errs.join('; '))}</span>` : x.status === 'novo' ? '<span class="tag on">Novo</span>' : x.status === 'alterado' ? `<span class="tag blue">Alterado</span>${x.changes.includes('image') ? ' <span class="small muted">(imagem)</span>' : ''}${x.changes.includes('fin') ? ' <span class="small muted">(percentuais)</span>' : ''}` : '<span class="tag off">Igual</span>'}</td></tr>`).join('')}</tbody></table></div>
  ${missing.length ? `<label class="checkRow" style="margin-top:10px"><input id="csvInactivate" type="checkbox"> Marcar como <b>Fora de linha</b> os ${missing.length} produto(s) ativos que não estão no arquivo</label>` : ''}
  <div class="btnRow"><button class="btn" onclick="closeModal()">Cancelar</button><button class="btn primary" onclick="applyCsvPlan()" ${cnt('novo') + cnt('alterado') + (missing.length ? 1 : 0) ? '' : 'disabled'}>Importar ${cnt('novo') + cnt('alterado')} produto(s)</button></div>`, true);
}
function applyCsvPlan() {
  const { plan, newCols, missing } = csvPlan;
  newCols.forEach(name => data.collections.push({ id: nextId(data.collections), name, description: '', featured: false, active: true, order: data.collections.length + 1, color1: '#e8e3d9', color2: '#8d806f', image: '' }));
  let nNew = 0, nUpd = 0;
  plan.forEach(x => {
    if (x.status === 'novo') { data.products.push({ id: nextId(data.products), active: true, stock: 'Disponível', ...x.next }); nNew++; }
    else if (x.status === 'alterado') { Object.assign(x.cur, x.next); nUpd++; }
  });
  if ($('csvInactivate')?.checked) missing.forEach(p => p.active = false);
  csvPlan = null; closeModal();
  saveData(`Importação concluída: ${nNew} novo(s), ${nUpd} alterado(s)${newCols.length ? `, ${newCols.length} coleção(ões) criada(s)` : ''}`);
}

/* ---------------------------------------------------------------- kits: CSV (uma linha por item do kit) */
const KIT_CSV_HEAD = ['Kit', 'Grupos', 'Descrição', 'Condição', 'Valor', 'Código produto', 'Qtd por kit', 'Preço promo item', 'Início', 'Fim', 'Limite kits', 'Ativo', 'Banner', 'Selo banner', 'Título banner', 'Subtítulo banner', 'Botão banner', 'URL imagem kit', 'URL imagem banner'];
const KIT_MODE_CSV = { percent: '%', value: 'R$', target: 'Preço final', manual: 'Manual' };
function brDate(ymd) { return ymd ? ymd.split('-').reverse().join('/') : ''; }
function kitCsvModel() {
  const r = (a) => a.map(csvCell).join(';');
  const lines = [KIT_CSV_HEAD.join(';'),
    r(['Mesa Posta', 'Todos', 'Kit completo para mesa posta', 'Preço final', '360,00', '0000195', '12', '', '01/11/2026', '30/11/2026', '50', 'Sim', 'Sim', 'Black Friday 2026', 'Kit Mesa Posta', '12 pratos rasos + 12 pratos de sobremesa', 'Quero essa oportunidade', '', 'https://seusite.com.br/banner-mesa-posta.jpg']),
    r(['Mesa Posta', '', '', '', '', '0000196', '12', '', '', '', '', '', '', '', '', '', '', '', '']),
    r(['Café da Manhã Ribbon', 'Grupo A', 'Xícaras e pratos Blue Ribbon', '%', '15', '0000199', '2', '', '', '', '', 'Sim', 'Não', '', '', '', '', '', '']),
    r(['Café da Manhã Ribbon', '', '', '', '', '0000201', '1', '', '', '', '', '', '', '', '', '', '', '', ''])];
  downloadText('modelo_kits_zionne.csv', lines.join('\r\n'));
}
function exportKitsCsv() {
  const byId = new Map(data.products.map(p => [p.id, p])), out = [KIT_CSV_HEAD.join(';')];
  (data.kits || []).forEach(k => (k.items || []).forEach((it, i) => {
    const p = byId.get(Number(it.productId)), first = i === 0;
    out.push([k.name, first ? ((k.groups || []).length ? k.groups.map(groupName).filter(Boolean).join(', ') : 'Todos') : '', first ? k.description || '' : '', first ? KIT_MODE_CSV[k.discountType || 'percent'] : '', first && k.discountType !== 'manual' ? brNum(k.discount) : '', p?.sku || '', it.qty, k.discountType === 'manual' ? brNum(it.promoPrice) : '',
      first ? brDate(k.startDate) : '', first ? brDate(k.endDate) : '', first ? k.maxKits || '' : '', first ? (k.active ? 'Sim' : 'Não') : '', first ? (k.banner ? 'Sim' : 'Não') : '',
      first ? k.bannerTag || '' : '', first ? k.bannerTitle || '' : '', first ? k.bannerSubtitle || '' : '', first ? k.bannerButton || '' : '', first && k.image && !k.image.startsWith('/img/') ? k.image : '', first ? k.bannerImage || '' : ''].map(csvCell).join(';'));
  }));
  downloadText('kits_zionne_' + todayYMD() + '.csv', out.join('\r\n'));
}
function kitHeadKey(h) {
  h = h.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
  const map = { kit: 'kit', nomedokit: 'kit', grupos: 'groups', grupo: 'groups', disponivelpara: 'groups', descricao: 'desc', condicao: 'mode', condicaoespecial: 'mode', tipodedesconto: 'mode', valor: 'value', desconto: 'value',
    codigoproduto: 'sku', codigo: 'sku', produto: 'sku', sku: 'sku', qtdporkit: 'qty', qtd: 'qty', quantidade: 'qty', qtdkit: 'qty', precopromoitem: 'promo', precopromo: 'promo', precopromocional: 'promo',
    inicio: 'start', iniciodacampanha: 'start', fim: 'end', fimdacampanha: 'end', limitekits: 'max', limite: 'max', ativo: 'active', banner: 'banner', destaque: 'banner',
    selobanner: 'tag', selo: 'tag', titulobanner: 'btitle', subtitulobanner: 'bsub', botaobanner: 'bbtn', botao: 'bbtn', urlimagemkit: 'image', imagemkit: 'image', urlimagembanner: 'bimage', imagembanner: 'bimage' };
  return map[h] || null;
}
function parseMode(v) {
  v = (v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  if (!v) return null;
  if (v === '%' || v.startsWith('percent') || v === 'desconto %' || v === 'desconto (%)') return 'percent';
  if (v === 'r$' || v.startsWith('valor') || v.startsWith('desconto r$') || v === 'desconto (r$)') return 'value';
  if (v.includes('final') || v === 'preco' || v === 'target') return 'target';
  if (v.startsWith('manual')) return 'manual';
  return 'invalid';
}
function parseDateBR(v) { v = (v || '').trim(); if (!v) return ''; let m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; m = v.match(/^\d{4}-\d{2}-\d{2}$/); return m ? v : 'invalid'; }
function parseYes(v) { v = (v || '').trim().toLowerCase(); if (!v) return null; return ['sim', 's', 'yes', 'y', '1', 'x', 'true', 'verdadeiro'].includes(v); }
let kitCsvPlan = null;
function importKitsCsv(e) {
  const f = e.target.files?.[0]; if (!f) return; e.target.value = '';
  const r = new FileReader();
  r.onload = () => { if (r.result.includes('�')) { const r2 = new FileReader(); r2.onload = () => buildKitCsvPlan(r2.result); r2.readAsText(f, 'windows-1252'); } else buildKitCsvPlan(r.result); };
  r.readAsText(f, 'utf-8');
}
function buildKitCsvPlan(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return toast('CSV vazio ou sem linhas de kit.');
  const keys = rows[0].map(kitHeadKey);
  if (!keys.includes('kit') || !keys.includes('sku')) return alert('O cabeçalho precisa ter as colunas "Kit" e "Código produto".\nUse "Baixar modelo CSV" para ver o formato.');
  const bySku = new Map(data.products.map(p => [String(p.sku).trim(), p])), groups = new Map();
  rows.slice(1).forEach((r, i) => {
    const o = { line: i + 2 }; keys.forEach((k, j) => { if (k) o[k] = (r[j] ?? '').trim(); });
    if (!o.kit) return;
    const key = o.kit.toLowerCase();
    if (!groups.has(key)) groups.set(key, { name: o.kit, rows: [] });
    groups.get(key).rows.push(o);
  });
  const plan = [];
  groups.forEach(g => {
    const errs = [], first = f => g.rows.map(r => r[f]).find(v => v !== undefined && v !== '') ?? '';
    const cur = (data.kits || []).find(k => k.name.trim().toLowerCase() === g.name.toLowerCase());
    const items = [];
    g.rows.forEach(r => {
      const p = bySku.get(String(r.sku || '').trim()), q = parseIntBR(r.qty);
      if (!r.sku) return errs.push(`linha ${r.line}: sem código do produto`);
      if (!p) return errs.push(`linha ${r.line}: produto ${r.sku} não cadastrado`);
      if (!p.active) errs.push(`linha ${r.line}: produto ${r.sku} está fora de linha`);
      if (Number.isNaN(q) || q === 0) return errs.push(`linha ${r.line}: quantidade inválida`);
      const promo = parseMoney(r.promo);
      if (Number.isNaN(promo)) errs.push(`linha ${r.line}: preço promo inválido`);
      const ex = items.find(x => x.productId === p.id);
      ex ? ex.qty += (q ?? 1) : items.push({ productId: p.id, qty: q ?? 1, promoPrice: promo ?? p.price });
    });
    const modeRaw = first('mode'), mode = parseMode(modeRaw) ?? cur?.discountType ?? (g.rows.some(r => r.promo) ? 'manual' : 'percent');
    if (mode === 'invalid') errs.push(`condição "${modeRaw}" inválida (use %, R$, Preço final ou Manual)`);
    const valRaw = first('value'), val = valRaw === '' ? (cur?.discount ?? 0) : parseMoney(valRaw);
    if (Number.isNaN(val)) errs.push('valor inválido');
    const start = first('start') ? parseDateBR(first('start')) : (cur?.startDate || ''), end = first('end') ? parseDateBR(first('end')) : (cur?.endDate || '');
    if (start === 'invalid' || end === 'invalid') errs.push('data inválida (use dd/mm/aaaa)');
    const maxRaw = first('max'), max = maxRaw === '' ? (cur?.maxKits ?? '') : parseIntBR(maxRaw);
    if (Number.isNaN(max)) errs.push('limite inválido');
    const act = parseYes(first('active')), ban = parseYes(first('banner'));
    let kgroups = cur?.groups || []; const gRaw = first('groups');
    if (gRaw) { if (/^tod[oa]s?$/i.test(gRaw.trim())) kgroups = []; else { kgroups = []; gRaw.split(/[,;|]/).map(x => x.trim()).filter(Boolean).forEach(n => { const g = (data.groups || []).find(x => x.name.toLowerCase() === n.toLowerCase()); g ? kgroups.push(g.id) : errs.push(`grupo "${n}" não cadastrado`); }); } }
    const next = {
      ...(cur ? JSON.parse(JSON.stringify(cur)) : { featured: false, showAvailable: false, order: (data.kits || []).length + plan.filter(x => !x.cur).length + 1 }),
      name: g.name, description: first('desc') || cur?.description || '', discountType: mode, discount: mode === 'manual' ? 0 : val,
      items, groups: kgroups, startDate: start, endDate: end, maxKits: max ?? '', active: act ?? cur?.active ?? true, banner: ban ?? cur?.banner ?? false,
      bannerTag: first('tag') || cur?.bannerTag || '', bannerTitle: first('btitle') || cur?.bannerTitle || '', bannerSubtitle: first('bsub') || cur?.bannerSubtitle || '',
      bannerButton: first('bbtn') || cur?.bannerButton || 'Quero essa oportunidade', image: first('image') ? normImg(first('image')) : (cur?.image || ''), bannerImage: first('bimage') ? normImg(first('bimage')) : (cur?.bannerImage || '')
    };
    if (!items.length) errs.push('nenhum produto válido');
    const calc = items.length ? kitCalc(next) : null;
    if (calc && mode === 'percent' && val > 100) errs.push('desconto acima de 100%');
    if (calc && (mode === 'value' || mode === 'target') && val > calc.full) errs.push(`valor maior que o preço cheio (${BRL(calc.full)})`);
    if (start && end && start !== 'invalid' && end !== 'invalid' && end < start) errs.push('fim antes do início');
    if (calc) calc.rows.forEach(r => { const it = next.items.find(i => i.productId === r.p.id); if (it) it.promoPrice = r.promo; });
    plan.push({ cur, next, calc, errs, status: errs.length ? 'erro' : cur ? 'alterado' : 'novo' });
  });
  kitCsvPlan = plan; showKitCsvPreview();
}
function showKitCsvPreview() {
  const plan = kitCsvPlan, cnt = s => plan.filter(x => x.status === s).length, ok = cnt('novo') + cnt('alterado');
  showModal('Importar kits — conferência', `<div class="csvSummary"><span class="tag on">${cnt('novo')} novos</span><span class="tag blue">${cnt('alterado')} atualizados</span>${cnt('erro') ? `<span class="tag red">${cnt('erro')} com erro (serão ignorados)</span>` : ''}</div>
  <p class="small muted">Os kits são identificados pelo nome: se já existe, a composição é substituída pela do arquivo. Campos em branco mantêm o valor atual. Os preços promocionais por item são calculados pela condição informada.</p>
  <div class="tableWrap" style="max-height:52vh;overflow:auto"><table class="adminTable csvTable"><thead><tr><th>Kit</th><th>Composição (preço promocional)</th><th>Condição</th><th>Preço cheio</th><th>Preço do kit</th><th>Kits possíveis</th><th>Período</th><th>Situação</th></tr></thead><tbody>${plan.map(x => { const c = x.calc, n = x.next; return `<tr class="${x.status}"><td><b>${esc(n.name)}</b><br>${(n.groups || []).length ? n.groups.map(g => `<span class="tag blue">🔒 ${esc(groupName(g) || '?')}</span>`).join(' ') : '<span class="tag off">Todos</span>'}${n.banner ? '<br><span class="tag warn">★ Banner</span>' : ''}${n.active ? '' : '<br><span class="tag off">Inativo</span>'}</td><td style="min-width:260px">${c ? c.rows.map(r => `<div class="kitCsvItem">${r.p.image ? `<img src="${esc(r.p.image)}" onerror="this.style.visibility='hidden'">` : '<span></span>'}<span><b>${r.qty}×</b> ${esc(r.p.sku)} ${esc(r.p.name)}</span><span>${BRL(r.promo)} <s>${BRL(r.price)}</s></span></div>`).join('') : '—'}</td><td>${n.discountType === 'manual' ? 'Manual por item' : n.discountType === 'target' ? 'Preço final ' + BRL(n.discount) : n.discountType === 'value' ? '− ' + BRL(n.discount) : '− ' + String(n.discount).replace('.', ',') + '%'}</td><td>${c ? BRL(c.full) : '—'}</td><td><b>${c ? BRL(c.price) : '—'}</b>${c && c.saving > 0 ? `<br><span class="small muted">− ${c.pct.toFixed(1).replace('.', ',')}%</span>` : ''}</td><td>${!c ? '—' : c.maxKits == null ? '<span class="muted">sem limite</span>' : c.maxKits}</td><td>${formatPeriod(n.startDate, n.endDate)}</td><td>${x.status === 'erro' ? `<span class="tag red" style="white-space:normal">${esc(x.errs.join('; '))}</span>` : x.status === 'novo' ? '<span class="tag on">Novo</span>' : '<span class="tag blue">Atualizar</span>'}</td></tr>`; }).join('')}</tbody></table></div>
  <div class="btnRow"><button class="btn" onclick="closeModal()">Cancelar</button><button class="btn primary" onclick="applyKitCsvPlan()" ${ok ? '' : 'disabled'}>Importar ${ok} kit(s)</button></div>`, true);
}
function applyKitCsvPlan() {
  data.kits = data.kits || []; let nNew = 0, nUpd = 0;
  kitCsvPlan.forEach(x => {
    if (x.status === 'novo') { x.next.id = nextId(data.kits); data.kits.push(x.next); nNew++; }
    else if (x.status === 'alterado') { Object.assign(x.cur, x.next); nUpd++; }
  });
  kitCsvPlan = null; closeModal(); saveData(`Kits importados: ${nNew} novo(s), ${nUpd} atualizado(s)`);
}

/* ================================================================ INTELIGÊNCIA COMERCIAL — núcleo financeiro (somente admin) */
/* Preço ideal = Custo ÷ (1 − (ICMS+PIS+COFINS+IRPJ+CS+Comissão+Custo Op.+Lucro)/100)
   Lucro líquido = Preço × (1 − (impostos+comissão+custo op.)/100) − Custo
   Custo da bonificação = Custo ÷ (1 − (ICMS+PIS+COFINS)/100) */
const FIN_PCT = [['icms', 'ICMS'], ['pis', 'PIS'], ['cofins', 'COFINS'], ['irpj', 'IRPJ'], ['cs', 'CS'], ['comis', 'Comissão'], ['custoOp', 'Custo Op.'], ['lucro', 'Lucro alvo'], ['lucroMin', 'Lucro mínimo']];
const FIN_DEF = { icms: 0, pis: 0, cofins: 0, irpj: 10.7, cs: 0, comis: 0, custoOp: 8, lucro: 44, lucroMin: 30, bonusPct: 5, generalDisc: 0 };
function finDefaults() { return { ...FIN_DEF, ...((data.settings || {}).fin || {}) }; }
function numOr(v, d) { return v === '' || v == null || isNaN(Number(v)) ? d : Number(v); }
function finOf(p) {
  const d = finDefaults(), o = (p && p.fin) || {}, f = {};
  FIN_PCT.forEach(([k]) => f[k] = numOr(o[k], d[k]));
  f.cost = numOr(p?.cost, 0); f.hasCost = p?.cost !== '' && p?.cost != null && Number(p.cost) > 0;
  f.ded = f.icms + f.pis + f.cofins + f.irpj + f.cs + f.comis + f.custoOp;   // % sobre o preço, exceto lucro
  f.remessa = f.icms + f.pis + f.cofins;                                      // impostos sobre a remessa bonificada
  const den = 1 - (f.ded + f.lucro) / 100, denMin = 1 - (f.ded + f.lucroMin) / 100;
  f.ideal = f.hasCost && den > 0 ? f.cost / den : null;
  f.minPrice = f.hasCost && denMin > 0 ? f.cost / denMin : null;
  return f;
}
function marginAt(f, price) { if (!price) return NaN; return (price * (1 - f.ded / 100) - f.cost) / price; }
function finStatus(m, alvo, min) { return !Number.isFinite(m) ? '' : m * 100 >= alvo - 0.005 ? 'g' : m * 100 >= min - 0.005 ? 'y' : 'r'; }
function pctF(v, dec = 1) { return Number.isFinite(v) ? (v * 100).toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + '%' : '—'; }
function dotF(st) { return st ? `<span class="fdot ${st}"></span>` : ''; }

/* cálculo de um negócio: itens vendidos (com desconto por item), desconto geral e bonificação */
function dealCalc(deal) {
  const byId = new Map(data.products.map(p => [p.id, p])), gd = numOr(deal.gd, 0) / 100, bp = numOr(deal.bp, 0) / 100;
  let gross = 0, idr = 0, R = 0, ded = 0, C = 0, qty = 0, alvoW = 0, minW = 0, grossDed = 0;
  const rows = (deal.items || []).map(it => {
    const p = byId.get(Number(it.productId)), f = finOf(p || { cost: it.cost });
    const cost = numOr(it.cost, f.cost), q = Math.max(0, numOr(it.qty, 0)), price = numOr(it.price, p?.price || 0), disc = Math.min(100, Math.max(0, numOr(it.disc, 0))) / 100;
    const unit = price * (1 - disc) * (1 - gd), rev = unit * q, d = rev * f.ded / 100, ct = cost * q, luc = rev - d - ct;
    gross += price * q; idr += price * (1 - disc) * q; R += rev; ded += d; C += ct; qty += q; grossDed += price * q * f.ded / 100;
    alvoW += f.lucro * rev; minW += f.lucroMin * rev;
    const fx = { ...f, cost };
    return { it, p, f: fx, price, q, disc, unit, rev, ded: d, cost: ct, lucro: luc, m: rev ? luc / rev : NaN, mb: rev ? (rev - ct) / rev : NaN, st: finStatus(rev ? luc / rev : NaN, f.lucro, f.lucroMin), ideal: fx.hasCost || cost ? cost / (1 - (f.ded + f.lucro) / 100) : null };
  });
  const def = finDefaults(), alvo = R ? alvoW / R : def.lucro, min = R ? minW / R : def.lucroMin;
  let bReal = 0, bCost = 0;
  const bonus = Object.entries(deal.bonus || {}).filter(([, q]) => Number(q) > 0).map(([pid, q]) => {
    const p = byId.get(Number(pid)), f = finOf(p), it = (deal.items || []).find(i => Number(i.productId) === Number(pid)), cost = numOr(it?.cost, f.cost);
    const real = (p?.price || 0) * q, bc = cost * q / (1 - f.remessa / 100); bReal += real; bCost += bc;
    return { p, q: Number(q), real, cost: bc };
  });
  const lucro = R - ded - C, avgDed = R ? ded / R : finDefaults().ded / 100;
  const bT = idr * bp, lucroBonus = lucro - bCost, Rp = R - bT, lucroPay = Rp * (1 - avgDed) - C;
  const need = (m) => { const den = 1 - avgDed - m / 100; return den > 0 ? (C + bCost) / den : Infinity; };
  const maxGd = idr ? 1 - need(min) / idr : NaN, maxGdAlvo = idr ? 1 - need(alvo) / idr : NaN;
  return {
    rows, bonus, gross, idr, R, ded, C, qty, lucro, avgDed, alvo, min,
    mLiq: R ? lucro / R : NaN, mBruta: R ? (R - C) / R : NaN, mLiqGross: gross ? (gross - grossDed - C) / gross : NaN, mBrutaGross: gross ? (gross - C) / gross : NaN,
    bT, bReal, bDiff: bReal - bT, bCost, bCostPct: idr ? bCost / idr : NaN, offer: gd + bp, lucroBonus, mBonus: R ? lucroBonus / R : NaN,
    lucroPay, mPay: Rp ? lucroPay / Rp : NaN, finDiff: lucroBonus - lucroPay, maxGd, maxGdAlvo, gd, bp,
    st: finStatus(R ? lucroBonus / R : NaN, alvo, min), missingCost: rows.filter(r => !r.f.cost).length
  };
}
function thermoHtml(m, alvo, min) {
  const pos = Number.isFinite(m) ? Math.max(1, Math.min(99, m * 100)) : 0;
  return `<div class="fbar" style="background:linear-gradient(90deg,#d9534f 0 ${min}%,#e8b04a ${min}% ${alvo}%,#5aa364 ${alvo}% 100%)">${Number.isFinite(m) ? `<div class="fpin" style="left:${pos}%">${pctF(m)}</div>` : ''}</div><div class="fbarLeg"><span>0%</span><span>🔴 &lt; ${String(+min.toFixed(1)).replace('.', ',')}%</span><span>🟡 até ${String(+alvo.toFixed(1)).replace('.', ',')}%</span><span>🟢 alvo</span><span>100%</span></div>`;
}

/* ---------------------------------------------------------------- aba Inteligência Comercial */
let intel = null, intelSaved = {};
async function intelInit() {
  try { intelSaved = await api('/api/admin/analyses', { admin: true }) || {}; } catch { intelSaved = {}; }
  if (!adminOrders.length) await loadAdminOrders();
  if (!intel) intelNewSim(true);
  renderIntel();
}
function openIntelTab() { const b = [...document.querySelectorAll('.adminSide button')].find(x => x.textContent.includes('Inteligência')); adminTab('intelAdmin', b); }
function intelBase(source, key, label) { const d = finDefaults(); return { source, key, label, items: [], bonus: {}, gd: d.generalDisc, bp: d.bonusPct }; }
function intelNewSim(silent) { intel = intelBase('sim', 'sim:' + Date.now(), 'Simulação de venda'); if (!silent) renderIntel(); }
function intelFromOrder(id) {
  const o = adminOrders.find(x => x.id === Number(id)); if (!o) return toast('Selecione um pedido');
  const saved = intelSaved['order:' + o.id]; if (saved) { intel = JSON.parse(JSON.stringify(saved)); toast('Análise salva deste pedido carregada'); return renderIntel(); }
  intel = intelBase('order', 'order:' + o.id, `Pedido ${o.number} — ${o.client_name}`);
  intel.gd = 0; intel.bp = finDefaults().bonusPct;
  o.items.forEach(it => {
    if (it.type === 'kit') (it.components || []).forEach(c => intel.items.push({ productId: c.productId, sku: c.sku, name: c.name, price: c.price, qty: c.qty * it.qty, disc: c.price ? +((1 - (c.promoPrice ?? c.price) / c.price) * 100).toFixed(4) : 0, kit: `${it.name} ×${it.qty}` }));
    else intel.items.push({ productId: it.id, sku: it.sku, name: it.name, price: it.price, qty: it.qty, disc: 0 });
  });
  renderIntel();
}
function intelFromKit(id, n) {
  const k = (data.kits || []).find(x => x.id === Number(id)); if (!k) return toast('Selecione um kit');
  const c = kitCalc(k), nk = Math.max(1, parseInt(n) || 1);
  intel = intelBase('kit', 'kit:' + k.id, `Kit ${k.name} × ${nk}`); intel.gd = 0;
  c.rows.forEach(r => intel.items.push({ productId: r.p.id, sku: r.p.sku, name: r.p.name, price: r.price, qty: r.qty * nk, disc: r.price ? +((1 - r.promo / r.price) * 100).toFixed(4) : 0, kit: `Kit ${k.name} ×${nk}` }));
  renderIntel();
}
function intelLoadSaved(key) { const a = intelSaved[key]; if (!a) return; intel = JSON.parse(JSON.stringify(a)); renderIntel(); }
async function intelSave() {
  if (!intel) return;
  if (intel.source === 'sim') { const n = prompt('Nome desta simulação:', intel.label === 'Simulação de venda' ? '' : intel.label); if (!n) return; intel.label = n; }
  try { await api('/api/admin/analyses/' + encodeURIComponent(intel.key), { method: 'PUT', admin: true, body: intel }); intelSaved[intel.key] = JSON.parse(JSON.stringify({ ...intel, savedAt: new Date().toISOString() })); toast('Análise salva'); renderIntel(); }
  catch (e) { toast(e.message); }
}
async function intelDeleteSaved() {
  const key = $('icSaved')?.value; if (!key || !intelSaved[key]) return toast('Selecione uma análise salva');
  if (!confirm('Excluir a análise salva "' + intelSaved[key].label + '"?')) return;
  await api('/api/admin/analyses/' + encodeURIComponent(key), { method: 'PUT', admin: true, body: {} }); delete intelSaved[key]; renderIntel(); toast('Análise excluída');
}
function intelSet(k, v) { intel[k] = numOr(v, 0); renderIntel(); }
function intelItem(i, k, v) { const it = intel.items[i]; if (!it) return; it[k] = v === '' ? (k === 'cost' ? '' : 0) : Number(v); renderIntel(); }
function intelBonus(pid, v) { const q = Math.max(0, parseInt(v) || 0); if (q) intel.bonus[pid] = q; else delete intel.bonus[pid]; renderIntel(); }
function intelRemove(i) { intel.items.splice(i, 1); renderIntel(); }
function intelAdd(asBonus) {
  const pid = Number($('icProd').value), q = Math.max(1, parseInt($('icQty').value) || 1), p = data.products.find(x => x.id === pid);
  if (!p) return toast('Selecione um produto');
  if (asBonus) { intel.bonus[pid] = (intel.bonus[pid] || 0) + q; }
  else { const qq = normalizeOrderQty(p, q); if (qq !== q) toast(`Quantidade ajustada para ${qq} (mínimo ${p.minQty || 1}, múltiplo ${p.packQty || 1})`); const e = intel.items.find(i => Number(i.productId) === pid && !i.kit); e ? e.qty += qq : intel.items.push({ productId: pid, sku: p.sku, name: p.name, price: p.price, qty: qq, disc: 0 }); }
  renderIntel();
}
function bonusCandidates(target) {
  if (!(target > 0)) return [];
  const inDeal = new Set(intel.items.map(i => Number(i.productId)));
  return data.products.filter(p => p.active && finOf(p).hasCost && p.price > 0).map(p => {
    const f = finOf(p), unitCost = f.cost / (1 - f.remessa / 100), pack = Math.max(1, Number(p.packQty) || 1), min = Math.max(1, Number(p.minQty) || 1);
    let q = Math.max(min, Math.ceil(Math.ceil(target / p.price) / pack) * pack);
    return { p, q, value: p.price * q, cost: unitCost * q, ratio: p.price / unitCost, inDeal: inDeal.has(p.id) };
  }).sort((a, b) => (b.ratio - a.ratio) || (Number(b.inDeal) - Number(a.inDeal))).slice(0, 3);
}
function intelApplyBonus(pid, q) { intel.bonus = { [pid]: q }; renderIntel(); toast('Bonificação sugerida aplicada'); }
function renderIntel() {
  const host = $('intelBody'); if (!host || !intel) return;
  const d = dealCalc(intel), num = v => String(+Number(v).toFixed(2)).replace('.', ','), inp = v => String(+Number(v || 0).toFixed(4));
  // controles de origem
  const ordOpts = adminOrders.map(o => `<option value="${o.id}">${esc(o.number)} — ${esc(o.client_name)} — ${BRL(o.total)}${intelSaved['order:' + o.id] ? ' ✓' : ''}</option>`).join('');
  const kitOpts = (data.kits || []).map(k => `<option value="${k.id}">${esc(k.name)}</option>`).join('');
  const savedOpts = Object.entries(intelSaved).sort((a, b) => (b[1].savedAt || '').localeCompare(a[1].savedAt || '')).map(([k, a]) => `<option value="${esc(k)}">${esc(a.label)}${a.savedAt ? ' — ' + new Date(a.savedAt).toLocaleDateString('pt-BR') : ''}</option>`).join('');
  $('intelSources').innerHTML = `<div class="icSrc"><label>Pedido recebido</label><div><select id="icOrder"><option value="">Selecione…</option>${ordOpts}</select><button class="btn" onclick="intelFromOrder($('icOrder').value)">Analisar</button></div></div>
   <div class="icSrc"><label>Kit promocional</label><div><select id="icKit"><option value="">Selecione…</option>${kitOpts}</select><input id="icKitN" type="number" min="1" value="10" title="Quantidade de kits"><button class="btn" onclick="intelFromKit($('icKit').value,$('icKitN').value)">Analisar</button></div></div>
   <div class="icSrc"><label>Simulação de venda</label><div><button class="btn" onclick="intelNewSim()">+ Nova simulação</button></div></div>
   <div class="icSrc"><label>Análises salvas</label><div><select id="icSaved"><option value="">${savedOpts ? 'Selecione…' : 'Nenhuma ainda'}</option>${savedOpts}</select><button class="btn" onclick="intelLoadSaved($('icSaved').value)">Abrir</button><button class="btn" title="Excluir análise salva" onclick="intelDeleteSaved()">🗑</button></div></div>`;
  const prodOpts = data.products.filter(p => p.active).sort((a, b) => a.name.localeCompare(b.name)).map(p => `<option value="${p.id}">${esc(p.sku)} — ${esc(p.name)} • ${BRL(p.price)}</option>`).join('');
  const lowest = d.rows.filter(r => r.rev > 0 && r.f.cost).sort((a, b) => a.m - b.m)[0];
  const below = d.rows.filter(r => r.f.cost && r.p && r.p.price < finOf(r.p).ideal - 0.005);
  const cands = bonusCandidates(d.bT), best = cands[0];
  const recs = [];
  if (!d.rows.length) recs.push(['🧮', 'Inclua produtos na venda (abaixo) ou escolha um pedido/kit para analisar.', '']);
  else {
    if (d.missingCost) recs.push(['⚠️', `<b>${d.missingCost} item(ns) sem custo cadastrado</b> — margem calculada de forma incompleta. Cadastre o custo no produto ou pelo CSV (Preco.Com.Liq).`, '']);
    recs.push([d.st === 'g' ? '✅' : d.st === 'y' ? '🟡' : '⛔', `Margem líquida final (desconto + bonificação): <b>${pctF(d.mBonus)}</b> — ${d.st === 'g' ? 'atinge o lucro alvo. Negócio aprovado.' : d.st === 'y' ? `abaixo do alvo de ${num(d.alvo)}%, mas acima do mínimo de ${num(d.min)}%. Aprovar com atenção.` : `<b>abaixo do lucro mínimo de ${num(d.min)}%</b>. Reveja desconto ou bonificação.`}`, '']);
    if (Number.isFinite(d.maxGd)) recs.push(['📐', d.maxGd > d.gd ? `Desconto geral máximo para manter ${num(d.min)}% de lucro: <b>${pctF(d.maxGd)}</b> (hoje ${pctF(d.gd)}). Para o lucro alvo: ${pctF(Math.max(0, d.maxGdAlvo))}.` : `O desconto geral atual (${pctF(d.gd)}) já passa do máximo permitido (${pctF(Math.max(0, d.maxGd))}).`, `<button onclick="intelSet('gd',${Math.max(0, Math.floor(d.maxGd * 1000) / 10)})">Aplicar máximo</button>`]);
    if (best) recs.push(['🎁', `Para bonificar ${BRL(d.bT)} (${pctF(d.bp)} da receita), a melhor opção é <b>${best.q}× ${esc(best.p.name)}</b>: entrega ${BRL(best.value)} em valor percebido com custo de ${BRL(best.cost)}.${cands.length > 1 ? `<br><span class="small" style="opacity:.8">Alternativas: ${cands.slice(1).map(c => `${c.q}× ${esc(c.p.name)} (custo ${BRL(c.cost)})`).join(' • ')}</span>` : ''}`, `<button onclick="intelApplyBonus(${best.p.id},${best.q})">Aplicar</button>`]);
    if (d.bCost > 0) recs.push(['⚖️', d.finDiff >= 0 ? `Bonificar rende <b>${BRL(d.finDiff)}</b> a mais que dar o mesmo valor (${BRL(d.bT)}) em desconto.` : `Dar ${BRL(d.bT)} em desconto rende ${BRL(-d.finDiff)} a mais que a bonificação atual.`, '']);
    if (lowest) recs.push(['🔎', `Menor margem do negócio: <b>${esc(lowest.it.name || lowest.p?.name)}</b>${lowest.it.kit ? ' (kit)' : ''} com ${pctF(lowest.m)}.`, '']);
    if (below.length) recs.push(['🏷', `${below.length} produto(s) com preço de catálogo abaixo do preço ideal: ${below.slice(0, 3).map(r => `${esc(r.p.name)} (ideal ${BRL(finOf(r.p).ideal)})`).join(', ')}${below.length > 3 ? '…' : ''}.`, '']);
  }
  const bonusOnly = Object.keys(intel.bonus).map(Number).filter(pid => !intel.items.some(i => Number(i.productId) === pid));
  host.innerHTML = `
  <div class="icHead"><div><div class="icLabel">${intel.source === 'order' ? '▧' : intel.source === 'kit' ? '✦' : '🧮'} ${esc(intel.label)}</div><div class="small muted">${d.rows.length} item(ns) • ${d.qty.toLocaleString('pt-BR')} un.${intelSaved[intel.key] ? ' • análise salva em ' + new Date(intelSaved[intel.key].savedAt).toLocaleString('pt-BR') : ''}</div></div>
   <div class="icParams2"><div class="field"><label>Desconto geral (%)</label><input type="number" step="0.1" min="0" max="100" value="${inp(intel.gd)}" onchange="intelSet('gd',this.value)"></div><div class="field"><label>Bonificação s/ receita (%)</label><input type="number" step="0.1" min="0" max="100" value="${inp(intel.bp)}" onchange="intelSet('bp',this.value)"></div><div class="field ro"><label>Deduções médias</label><input readonly value="${pctF(d.avgDed, 2)}"></div><div class="field ro"><label>Lucro alvo / mínimo</label><input readonly value="${num(d.alvo)}% / ${num(d.min)}%"></div></div></div>
  <div class="icGrid">
   <section class="icPanel"><div class="icPanelT">▣ RESUMO FINANCEIRO <span>${d.qty.toLocaleString('pt-BR')} un.</span></div><div class="icMet">
    <div class="icM"><span>💵 Custo total</span><b>${BRL(d.C)}</b></div>
    <div class="icM"><span>🧾 Receita sem descontos</span><b>${BRL(d.gross)}</b></div>
    <div class="icM"><span>🧾 Receita c/ desconto por item</span><b>${BRL(d.idr)}</b></div>
    <div class="icM"><span>💰 Receita final (todos os descontos)</span><b>${BRL(d.R)}</b></div>
    <div class="icM"><span>🏛 Impostos + comissão + custo op.</span><b>${BRL(d.ded)}</b></div>
    <div class="icM"><span>💸 Lucro líquido</span><b>${BRL(d.lucro)}</b></div>
    <div class="icM"><span>📈 Margem líquida SEM descontos</span><b>${pctF(d.mLiqGross)}</b></div>
    <div class="icM ${finStatus(d.mLiq, d.alvo, d.min)}"><span>📉 Margem líquida COM descontos</span><b>${dotF(finStatus(d.mLiq, d.alvo, d.min))}${pctF(d.mLiq)}</b></div>
    <div class="icM"><span>Margem bruta (receita − custo)</span><b>${pctF(d.mBruta)}</b></div>
    <div class="icM"><span>📦 Quantidade vendida</span><b>${d.qty.toLocaleString('pt-BR')}</b></div>
   </div></section>
   <section class="icPanel"><div class="icPanelT gold">🎁 SIMULAÇÃO DE BONIFICAÇÃO <span>alvo ${pctF(d.bp)} da receita</span></div><div class="icMet">
    <div class="icM"><span>🎯 Valor alvo da bonificação</span><b>${BRL(d.bT)}</b></div>
    <div class="icM"><span>🛍 Valor real bonificado (preço venda)</span><b>${BRL(d.bReal)}</b></div>
    <div class="icM"><span>⚖ Diferença (real − alvo)</span><b>${BRL(d.bDiff)}</b></div>
    <div class="icM"><span>📦 Custo da bonificação (c/ impostos remessa)</span><b>${BRL(d.bCost)}</b></div>
    <div class="icM"><span>🧮 Custo bonif. sobre a receita</span><b>${pctF(d.bCostPct)}</b></div>
    <div class="icM"><span>🏷 Desconto total ofertado</span><b>${pctF(d.offer)}</b></div>
    <div class="icM ${d.st}" style="grid-column:1/-1"><span>📉 Margem líquida final (desconto + bonificação)</span><b>${dotF(d.st)}${pctF(d.mBonus)}</b></div>
   </div>
   <div class="icCmp"><div><small>Pagar a mercadoria (desconto)</small><b>${BRL(d.lucroPay)}</b><small>margem ${pctF(d.mPay)}</small></div><div class="hl"><small>Bonificar</small><b>${BRL(d.lucroBonus)}</b><small>margem ${pctF(d.mBonus)}</small></div><div><small>Diferença financeira</small><b>${BRL(d.finDiff)}</b><small>${pctF(d.R ? d.finDiff / d.R : NaN)} da receita</small></div></div>
   </section>
  </div>
  <div class="icLow">
   <div class="icInsight"><h3>◈ Recomendações da inteligência comercial</h3><ul>${recs.map(([i, t, b]) => `<li><i>${i}</i><span>${t}</span>${b || '<span></span>'}</li>`).join('')}</ul></div>
   <div class="icGauge"><h4>Termômetro de margem</h4>${thermoHtml(d.mBonus, d.alvo, d.min)}
    <div class="icRows"><div class="icRow"><span>Receita final</span><b>${BRL(d.R)}</b></div><div class="icRow"><span>(−) Impostos, comissão, custo op.</span><b>${BRL(d.ded)}</b></div><div class="icRow"><span>(−) Custo das mercadorias</span><b>${BRL(d.C)}</b></div><div class="icRow"><span>(−) Custo da bonificação</span><b>${BRL(d.bCost)}</b></div><div class="icRow tot"><span>(=) Resultado do negócio</span><b>${BRL(d.lucroBonus)}</b></div></div></div>
  </div>
  <div class="panel"><div class="panelTitle"><h3>Itens do negócio</h3><span class="small muted">Custo vem do cadastro do produto • alterações aqui valem só para esta análise</span></div>
   <div class="kitPicker" style="grid-template-columns:1fr 80px auto auto"><select id="icProd"><option value="">Incluir produto…</option>${prodOpts}</select><input id="icQty" type="number" min="1" value="1"><button class="btn primary" onclick="intelAdd(false)">+ Venda</button><button class="btn" onclick="intelAdd(true)">🎁 Bonificar</button></div>
   <div class="tableWrap"><table class="icTable"><thead><tr><th>Código</th><th>Produto</th><th>Preço</th><th>Qtd</th><th>Custo un.</th><th>Desc. item %</th><th>Preço final</th><th>Subtotal</th><th>Deduções</th><th>Lucro líq.</th><th>Margem líq.</th><th>Preço ideal</th><th>Qtd bonif.</th><th>Custo bonif.</th><th></th></tr></thead><tbody>
   ${d.rows.map((r, i) => { const bq = intel.bonus[r.it.productId] || 0, bc = bq ? (r.f.cost * bq) / (1 - r.f.remessa / 100) : 0; return `<tr class="${r.it.kit ? 'kit' : ''}"><td>${esc(r.it.sku || r.p?.sku || '')}</td><td><b>${esc(r.it.name || r.p?.name || '')}</b>${r.it.kit ? `<span class="kitTag">${esc(r.it.kit)}</span>` : ''}${!r.p ? ' <span class="tag red">produto removido</span>' : ''}</td><td>${BRL(r.price)}</td><td><input value="${r.q}" type="number" min="0" onchange="intelItem(${i},'qty',this.value)"></td><td><input value="${r.f.cost ? inp(r.f.cost) : ''}" placeholder="—" type="number" step="0.01" onchange="intelItem(${i},'cost',this.value)"></td><td><input value="${inp(r.disc * 100)}" type="number" step="0.01" min="0" max="100" onchange="intelItem(${i},'disc',this.value)"></td><td>${BRL(r.unit)}</td><td>${BRL(r.rev)}</td><td>${BRL(r.ded)}</td><td>${r.f.cost ? BRL(r.lucro) : '—'}</td><td>${r.f.cost ? dotF(r.st) + pctF(r.m) : '<span class="muted">sem custo</span>'}</td><td>${r.f.cost ? BRL(r.ideal) : '—'}</td><td><input class="bon" value="${bq}" type="number" min="0" onchange="intelBonus(${Number(r.it.productId)},this.value)"></td><td>${bq ? BRL(bc) : '—'}</td><td><button class="link" style="color:#a34b44" onclick="intelRemove(${i})">×</button></td></tr>`; }).join('')}
   ${bonusOnly.map(pid => { const p = data.products.find(x => x.id === pid), f = finOf(p), bq = intel.bonus[pid]; return `<tr class="bonusRow"><td>${esc(p?.sku || '')}</td><td><b>${esc(p?.name || 'Produto removido')}</b><span class="kitTag" style="background:#f3e7c9;color:#7a5a1a">só bonificação</span></td><td>${BRL(p?.price)}</td><td>—</td><td>${f.cost ? num(f.cost) : '—'}</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td><input class="bon" value="${bq}" type="number" min="0" onchange="intelBonus(${pid},this.value)"></td><td>${BRL(f.cost * bq / (1 - f.remessa / 100))}</td><td><button class="link" style="color:#a34b44" onclick="intelBonus(${pid},0)">×</button></td></tr>`; }).join('')}
   ${!d.rows.length && !bonusOnly.length ? '<tr><td colspan="15" class="muted" style="text-align:center;padding:22px">Nenhum item. Use "Incluir produto" acima ou escolha um pedido/kit.</td></tr>' : ''}
   </tbody></table></div></div>`;
}
function intelExportCsv() {
  if (!intel) return; const d = dealCalc(intel), n = v => Number(v || 0).toFixed(2).replace('.', ',');
  const head = ['Código', 'Produto', 'Kit', 'Preço', 'Qtd', 'Custo un.', 'Desc. item %', 'Preço final', 'Subtotal', 'Deduções', 'Lucro líquido', 'Margem líquida %', 'Preço ideal', 'Qtd bonificação', 'Custo bonificação'];
  const rows = d.rows.map(r => { const bq = intel.bonus[r.it.productId] || 0; return [r.it.sku, r.it.name, r.it.kit || '', n(r.price), r.q, n(r.f.cost), n(r.disc * 100), n(r.unit), n(r.rev), n(r.ded), n(r.lucro), n(r.m * 100), n(r.ideal), bq, n(bq ? r.f.cost * bq / (1 - r.f.remessa / 100) : 0)]; });
  d.bonus.filter(b => !intel.items.some(i => Number(i.productId) === b.p?.id)).forEach(b => rows.push([b.p?.sku, b.p?.name, 'só bonificação', n(b.p?.price), 0, '', '', '', '', '', '', '', '', b.q, n(b.cost)]));
  const sum = [['Análise', intel.label], ['Desconto geral %', n(d.gd * 100)], ['Bonificação %', n(d.bp * 100)], ['Receita sem descontos', n(d.gross)], ['Receita final', n(d.R)], ['Impostos+comissão+custo op.', n(d.ded)], ['Custo das mercadorias', n(d.C)], ['Custo da bonificação', n(d.bCost)], ['Resultado do negócio', n(d.lucroBonus)], ['Margem líquida final %', n(d.mBonus * 100)], ['Desconto geral máximo %', n(d.maxGd * 100)]];
  downloadText('analise_' + intel.label.replace(/[^\w]+/g, '_').slice(0, 40) + '_' + todayYMD() + '.csv', [head.join(';'), ...rows.map(r => r.map(csvCell).join(';')), '', ...sum.map(r => r.map(csvCell).join(';'))].join('\r\n'));
}
function intelPrint() {
  if (!intel) return; const d = dealCalc(intel);
  $('printOrder').innerHTML = `<div class="print"><div class="printHead"><img src="${LOGO}"><div style="text-align:right"><b>ANÁLISE COMERCIAL — USO INTERNO</b><br><small>${esc(intel.label)}</small><br><small>${new Date().toLocaleString('pt-BR')}</small></div></div>
  <table><tbody>${[['Receita sem descontos', BRL(d.gross)], ['Receita final', BRL(d.R)], ['Impostos + comissão + custo op.', BRL(d.ded)], ['Custo das mercadorias', BRL(d.C)], ['Custo da bonificação', BRL(d.bCost)], ['Resultado do negócio', BRL(d.lucroBonus)], ['Margem líquida (com desconto)', pctF(d.mLiq)], ['Margem líquida final (desconto + bonificação)', pctF(d.mBonus)], ['Lucro alvo / mínimo', `${pctF(d.alvo / 100)} / ${pctF(d.min / 100)}`], ['Desconto geral aplicado / máximo', `${pctF(d.gd)} / ${pctF(d.maxGd)}`]].map(([a, b]) => `<tr><td>${a}</td><td style="text-align:right"><b>${b}</b></td></tr>`).join('')}</tbody></table>
  <table style="margin-top:12px"><thead><tr><th>Código</th><th>Produto</th><th>Qtd</th><th>Preço final</th><th>Subtotal</th><th>Custo</th><th>Lucro líq.</th><th>Margem</th><th>Bonif.</th></tr></thead><tbody>${d.rows.map(r => `<tr><td>${esc(r.it.sku)}</td><td>${esc(r.it.name)}${r.it.kit ? ' (kit)' : ''}</td><td>${r.q}</td><td>${BRL(r.unit)}</td><td>${BRL(r.rev)}</td><td>${BRL(r.cost)}</td><td>${BRL(r.lucro)}</td><td>${pctF(r.m)}</td><td>${intel.bonus[r.it.productId] || ''}</td></tr>`).join('')}</tbody></table></div>`;
  setTimeout(() => window.print(), 150);
}

/* ---------------------------------------------------------------- util */
function showModal(title, body, wide) { $('modalTitle').textContent = title; $('modalBody').innerHTML = body; document.querySelector('#modal .modalCard').classList.toggle('wide', !!wide); $('modal').classList.add('on'); }
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
