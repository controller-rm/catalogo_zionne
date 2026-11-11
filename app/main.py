"""
Catálogo Virtual Zionne — servidor
FastAPI + SQLAlchemy (SQLite local / PostgreSQL em produção)

Variáveis de ambiente (.env ou painel do Render):
  DATABASE_URL     postgres://... (sem ela usa SQLite em ./data/zionne.db)
  SECRET_KEY       chave para assinar sessões e gerar tokens (obrigatória em produção)
  ADMIN_USER       usuário inicial do painel (padrão: admin)
  ADMIN_PASSWORD   senha inicial do painel (padrão: zionne2026 — troque!)
"""
import base64, csv, hashlib, hmac, io, json, os, re, secrets, time, uuid
from datetime import date, datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import Depends, FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps
from sqlalchemy import (Column, DateTime, Float, Integer, LargeBinary, MetaData, String, Table,
                        Text, create_engine, insert, select, update, delete, func)

BR_TZ = ZoneInfo("America/Sao_Paulo")
BASE = Path(__file__).resolve().parent
STATIC = BASE / "static"

# ------------------------------------------------------------------ .env simples
env_file = BASE.parent / ".env"
if env_file.exists():
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

# ------------------------------------------------------------------ banco
db_url = os.environ.get("DATABASE_URL", "").strip()
if not db_url and os.environ.get("RENDER"):
    raise RuntimeError("DATABASE_URL não configurada: no Render use o PostgreSQL (o disco do serviço é apagado a cada deploy).")
if not db_url:
    (BASE.parent / "data").mkdir(exist_ok=True)
    db_url = f"sqlite:///{(BASE.parent / 'data' / 'zionne.db').as_posix()}"
if db_url.startswith("postgres://"):
    db_url = "postgresql+psycopg://" + db_url[len("postgres://"):]
elif db_url.startswith("postgresql://"):
    db_url = "postgresql+psycopg://" + db_url[len("postgresql://"):]

engine = create_engine(db_url, pool_pre_ping=True, future=True)
meta = MetaData()
kv = Table("kv", meta,
           Column("key", String(60), primary_key=True),
           Column("value", Text, nullable=False),
           Column("updated_at", DateTime(timezone=True)))
images = Table("images", meta,
               Column("id", String(40), primary_key=True),
               Column("mime", String(40), nullable=False),
               Column("data", LargeBinary, nullable=False),
               Column("created_at", DateTime(timezone=True)))
orders = Table("orders", meta,
               Column("id", Integer, primary_key=True, autoincrement=True),
               Column("number", String(20)),
               Column("client_id", Integer),
               Column("client_name", String(200)),
               Column("client_doc", String(30)),
               Column("price_table", String(100)),
               Column("payment", String(100)),
               Column("obs", Text),
               Column("items", Text),
               Column("total", Float),
               Column("status", String(40)),
               Column("created_at", DateTime(timezone=True)),
               Column("updated_at", DateTime(timezone=True)))
meta.create_all(engine)

def now():
    return datetime.now(timezone.utc)

def kv_get(key, default=None):
    with engine.connect() as c:
        r = c.execute(select(kv.c.value).where(kv.c.key == key)).first()
    return json.loads(r[0]) if r else default

def kv_set(key, value):
    payload = json.dumps(value, ensure_ascii=False)
    with engine.begin() as c:
        if c.execute(select(kv.c.key).where(kv.c.key == key)).first():
            c.execute(update(kv).where(kv.c.key == key).values(value=payload, updated_at=now()))
        else:
            c.execute(insert(kv).values(key=key, value=payload, updated_at=now()))

# ------------------------------------------------------------------ segredo / senha
SECRET = os.environ.get("SECRET_KEY") or kv_get("secret")
if not SECRET:
    SECRET = secrets.token_urlsafe(48)
    kv_set("secret", SECRET)
SECRET_B = SECRET.encode()

def hash_pw(pw, salt=None):
    salt = salt or secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), 200_000).hex()
    return f"{salt}${h}"

def check_pw(pw, stored):
    try:
        salt, _ = stored.split("$", 1)
    except ValueError:
        return False
    return hmac.compare_digest(hash_pw(pw, salt), stored)

def sign(payload: dict) -> str:
    body = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode().rstrip("=")
    sig = hmac.new(SECRET_B, body.encode(), hashlib.sha256).hexdigest()[:40]
    return f"{body}.{sig}"

def unsign(tok: str):
    try:
        body, sig = tok.split(".", 1)
        exp_sig = hmac.new(SECRET_B, body.encode(), hashlib.sha256).hexdigest()[:40]
        if not hmac.compare_digest(sig, exp_sig):
            return None
        data = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
        if data.get("exp", 0) < time.time():
            return None
        return data
    except Exception:
        return None

def make_client_token(doc, validity):
    raw = hmac.new(SECRET_B, f"{doc}|{validity}|ZIONNE".encode(), hashlib.sha256).hexdigest().upper()
    return f"ZN-{raw[0:4]}-{raw[4:8]}-{raw[8:12]}"

# ------------------------------------------------------------------ dados iniciais
def default_content():
    collections = [
        dict(id=1, name="Horticool Green", description="Coleção delicada com inspiração botânica e acabamento sofisticado.", featured=True, active=True, order=1, color1="#d8e5c9", color2="#75a064", image=""),
        dict(id=2, name="Horticool Pink", description="Tons rosados e florais para composições elegantes e acolhedoras.", featured=True, active=True, order=2, color1="#efd9d8", color2="#b97883", image=""),
        dict(id=3, name="Blue Ribbon", description="Clássicos tons de azul em uma coleção refinada e atemporal.", featured=True, active=True, order=3, color1="#e1e7ee", color2="#42678e", image=""),
        dict(id=4, name="Tea Delight", description="Momentos de prazer e delicadeza para o chá e a mesa posta.", featured=True, active=True, order=4, color1="#efe3dd", color2="#bf918d", image=""),
        dict(id=5, name="Peony", description="Uma coleção floral marcante, inspirada na delicadeza das peônias.", featured=True, active=True, order=5, color1="#e9e3da", color2="#9c8d76", image=""),
    ]
    names = ['Xícara Café Horticool','Xícara Chá Horticool','Prato Raso Horticool','Prato Sobremesa Horticool','Bowl Horticool','Caneca Horticool','Xícara Café Ribbon','Xícara Chá Ribbon','Prato Raso Ribbon','Prato Sobremesa Ribbon','Bowl Ribbon','Caneca Ribbon','Prato Peony 27cm','Prato Peony 21cm','Xícara Peony','Bowl Peony','Xícara Tea Delight','Prato Tea Delight','Bowl Tea Delight','Caneca Tea Delight']
    cols = ['Horticool Green']*4 + ['Horticool Pink']*2 + ['Blue Ribbon']*6 + ['Peony']*4 + ['Tea Delight']*4
    prices = [79.9,94.9,119.9,89.9,74.9,82.9,84.9,99.9,129.9,92.9,76.9,86.9,139.9,99.9,89.9,79.9,92.9,127.9,81.9,88.9]
    products = [dict(id=i+1, sku=str(193+i).zfill(7), name=n, collection=cols[i],
                     description="Porcelana de alto padrão, acabamento refinado e design exclusivo.",
                     price=prices[i], active=True, stock="Baixo estoque" if i % 7 == 0 else "Disponível",
                     image="", minQty=1, packQty=1) for i, n in enumerate(names)]
    return dict(
        products=products, collections=collections,
        home=dict(title="Coleções que transformam momentos.", subtitle="Sofisticação, inovação e excelência para sua mesa posta.",
                  button="Ver coleções", collectionsTitle="Coleções em destaque", bannerImage="",
                  benefits=[dict(icon="♧", title="Entrega para todo o Brasil", text="Consulte condições", active=True),
                            dict(icon="▰", title="Pagamento facilitado", text="Condições especiais", active=True),
                            dict(icon="◉", title="Atendimento Comercial", text="(41) 3043-0595", active=True),
                            dict(icon="♢", title="Segurança e confiança", text="Seu acesso é protegido", active=True)]),
        notices=[dict(id=1, title="Zionne na ABUP Show 2026", description="A Zionne marca presença na ABUP Show 2026. Confira datas, horários e local do evento.",
                      startDate="2026-08-01", endDate="2026-08-13", order=1, active=True, link="", image="/static/img/aviso-abup.jpg")],
        inspirations=[dict(id=1, title="Blue Ribbon & Tea Delight", description="Uma composição elegante para inspirar sua vitrine e sua mesa posta.",
                           collection="Blue Ribbon", linkType="collection", linkValue="Blue Ribbon", order=1, featured=True, active=True,
                           image="/static/img/inspiracao-blue-ribbon.jpg")],
        kits=[],
        settings=dict(whats="554130430595", email="comercial@zionne.com.br",
                      institutional="Zionne • Catálogo virtual B2B para parceiros e lojistas.\nCuritiba/PR",
                      payments=["28/56/84 dias", "28/42 dias", "30/60/90 dias", "À vista"]),
    )

if kv_get("content") is None:
    kv_set("content", default_content())
if kv_get("clients") is None:
    kv_set("clients", [dict(id=1, name="Casa das Louças Ltda. (DEMONSTRAÇÃO)", doc="12345678000190", docDisplay="12.345.678/0001-90",
                            token="ZIONNE-DEMO-2026", validity="2026-12-31", priceTable="Revenda Premium", active=True)])
if kv_get("admin") is None:
    kv_set("admin", dict(user=os.environ.get("ADMIN_USER", "admin"),
                         password=hash_pw(os.environ.get("ADMIN_PASSWORD", "zionne2026"))))

# ------------------------------------------------------------------ imagens
MAX_SIDE = 1800

def store_image(raw: bytes) -> str:
    try:
        im = Image.open(io.BytesIO(raw))
        im = ImageOps.exif_transpose(im)
    except Exception:
        raise HTTPException(400, "Arquivo de imagem inválido.")
    if max(im.size) > MAX_SIDE:
        im.thumbnail((MAX_SIDE, MAX_SIDE))
    if im.mode not in ("RGB", "RGBA"):
        im = im.convert("RGBA" if "A" in im.getbands() else "RGB")
    out = io.BytesIO()
    im.save(out, "WEBP", quality=86, method=4)
    iid = uuid.uuid4().hex
    with engine.begin() as c:
        c.execute(insert(images).values(id=iid, mime="image/webp", data=out.getvalue(), created_at=now()))
    return f"/img/{iid}"

DATA_URI = re.compile(r"^data:image/[a-zA-Z+.-]+;base64,(.+)$", re.S)

def externalize(obj):
    """Converte imagens embutidas (data:image/...;base64) em arquivos no banco; remove refs IndexedDB."""
    if isinstance(obj, dict):
        return {k: externalize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [externalize(v) for v in obj]
    if isinstance(obj, str):
        if obj.startswith("idb:"):
            return ""
        m = DATA_URI.match(obj)
        if m:
            try:
                return store_image(base64.b64decode(m.group(1)))
            except Exception:
                return ""
    return obj

# ------------------------------------------------------------------ helpers
def norm_doc(v):
    return re.sub(r"\D", "", v or "")

def client_valid(c):
    try:
        return c.get("active") and date.fromisoformat(c["validity"]) >= date.today()
    except Exception:
        return False

def public_client(c):
    return {k: c.get(k) for k in ("id", "name", "docDisplay", "validity", "priceTable")}

def visible_notice(n):
    t = date.today().isoformat()
    return n.get("active") and (not n.get("startDate") or t >= n["startDate"]) and (not n.get("endDate") or t <= n["endDate"])

def bearer(authorization: str | None):
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    return unsign(authorization[7:].strip())

def require_client(authorization: str | None = Header(None)):
    s = bearer(authorization)
    if not s or s.get("t") != "c":
        raise HTTPException(401, "Sessão expirada. Entre novamente.")
    c = next((x for x in kv_get("clients", []) if x.get("id") == s["cid"]), None)
    if not c or not client_valid(c):
        raise HTTPException(401, "Acesso bloqueado ou vencido. Fale com a Zionne.")
    return c

def require_admin(authorization: str | None = Header(None)):
    s = bearer(authorization)
    if not s or s.get("t") != "a":
        raise HTTPException(401, "Sessão administrativa expirada.")
    return s

def aware(dt):
    return dt.replace(tzinfo=timezone.utc) if dt and dt.tzinfo is None else dt

def order_row(r):
    d = dict(r._mapping)
    d["items"] = json.loads(d["items"] or "[]")
    for k in ("created_at", "updated_at"):
        if d.get(k):
            d[k] = aware(d[k]).isoformat()
    return d

ORDER_STATUS = ["Recebido", "Em análise", "Em separação", "Faturado", "Cancelado"]

# ------------------------------------------------------------------ app
app = FastAPI(title="Catálogo Virtual Zionne", docs_url=None, redoc_url=None)
app.mount("/static", StaticFiles(directory=STATIC), name="static")

@app.get("/")
@app.get("/admin")
def index():
    return FileResponse(STATIC / "index.html", headers={"Cache-Control": "no-cache"})

@app.get("/api/health")
def health():
    return {"ok": True}

@app.get("/img/{iid}")
def get_image(iid: str):
    with engine.connect() as c:
        r = c.execute(select(images.c.mime, images.c.data).where(images.c.id == iid)).first()
    if not r:
        raise HTTPException(404)
    return Response(r.data, media_type=r.mime, headers={"Cache-Control": "public, max-age=31536000, immutable"})

# ---------- cliente
@app.post("/api/login")
async def login(req: Request):
    b = await req.json()
    doc, tok = norm_doc(b.get("doc")), (b.get("token") or "").strip().upper()
    c = next((x for x in kv_get("clients", []) if x.get("doc") == doc and (x.get("token") or "").upper() == tok), None)
    if not c or not c.get("active"):
        raise HTTPException(401, "CNPJ/CPF ou token não encontrado/ativo.")
    if not client_valid(c):
        raise HTTPException(401, "Este token expirou. Entre em contato com a Zionne.")
    session = sign({"t": "c", "cid": c["id"], "exp": time.time() + 30 * 86400})
    return {"session": session, "client": public_client(c)}

@app.get("/api/catalog")
def catalog(c=Depends(require_client)):
    ct = kv_get("content")
    s = ct.get("settings", {})
    prods = {p["id"]: p for p in ct["products"]}
    kits = []
    for k in sorted(ct.get("kits", []), key=lambda x: (not x.get("featured"), x.get("order") or 0)):
        if not visible_kit(k):
            continue
        calc = kit_calc(k, prods)
        if not calc:
            continue
        kk = {x: k.get(x) for x in ("id", "name", "description", "image", "startDate", "endDate", "featured", "discountType", "discount",
                                     "banner", "bannerTag", "bannerTitle", "bannerSubtitle", "bannerButton", "bannerImage")}
        kk.update(full=calc["full"], price=calc["price"], saving=calc["saving"],
                  maxKits=calc["maxKits"], available=calc["maxKits"] if k.get("showAvailable") else None,
                  soldOut=calc["maxKits"] == 0, components=calc["components"])
        kits.append(kk)
    return {
        "client": public_client(c),
        "kits": kits,
        "products": [{k: v for k, v in p.items() if k != "stockQty"} for p in ct["products"] if p.get("active")],
        "collections": [x for x in ct["collections"] if x.get("active")],
        "home": ct["home"],
        "notices": [n for n in ct.get("notices", []) if visible_notice(n)],
        "inspirations": [x for x in ct.get("inspirations", []) if x.get("active")],
        "settings": {k: s.get(k) for k in ("whats", "email", "institutional", "payments")},
    }

def stock_of(p):
    v = p.get("stockQty")
    if v is None or v == "":
        return None
    try:
        return max(0, int(float(v)))
    except (TypeError, ValueError):
        return None

def visible_kit(k):
    t = date.today().isoformat()
    return k.get("active") and (not k.get("startDate") or t >= k["startDate"]) and (not k.get("endDate") or t <= k["endDate"])

def apportion(rows, target):
    """Distribui o preço do kit entre os itens (preço promocional unitário), acertando centavos."""
    full = sum(p * q for p, q in rows)
    factor = target / full if full else 1
    promos = [round(p * factor, 2) for p, q in rows]
    diff = round((target - sum(pr * q for pr, (p, q) in zip(promos, rows))) * 100)
    if diff:
        for i, (p, q) in enumerate(rows):
            if q == 1 or diff % q == 0:
                promos[i] = round(promos[i] + diff / q / 100, 2)
                break
    return [max(0.0, x) for x in promos]

def kit_calc(k, prods):
    """Preço cheio, preço promocional por item, preço do kit e quantos kits o estoque permite montar."""
    comps, rows, max_k, limiting = [], [], None, None
    for it in k.get("items", []):
        p = prods.get(int(it.get("productId") or 0))
        if not p or not p.get("active"):
            return None
        q = max(1, int(it.get("qty") or 1))
        rows.append((float(p["price"]), q))
        st = stock_of(p)
        if st is not None and (max_k is None or st // q < max_k):
            max_k, limiting = st // q, p["name"]
        comps.append(dict(productId=p["id"], sku=p["sku"], name=p["name"], image=p.get("image", ""), qty=q,
                          price=float(p["price"]), manual=it.get("promoPrice")))
    if not comps:
        return None
    full = round(sum(p * q for p, q in rows), 2)
    mode, d = k.get("discountType", "percent"), float(k.get("discount") or 0)
    if mode == "manual":
        promos = [round(float(c["manual"]), 2) if c["manual"] not in (None, "") else c["price"] for c in comps]
    else:
        target = full * (1 - d / 100) if mode == "percent" else (full - d if mode == "value" else d)
        promos = apportion(rows, round(min(max(target, 0), full), 2))
    for c, pr in zip(comps, promos):
        c.pop("manual", None)
        c["promoPrice"] = pr
    price = round(sum(c["promoPrice"] * c["qty"] for c in comps), 2)
    limit = int(k["maxKits"]) if str(k.get("maxKits") or "").strip().isdigit() and int(k["maxKits"]) > 0 else None
    if limit is not None and (max_k is None or limit < max_k):
        max_k, limiting = limit, "limite da campanha"
    return dict(full=full, saving=round(full - price, 2), price=price, maxKits=max_k, limiting=limiting, components=comps)

def normalize_qty(p, q):
    mn, pk = max(1, int(p.get("minQty") or 1)), max(1, int(p.get("packQty") or 1))
    q = max(mn, int(q or mn))
    if q % pk:
        q = -(-q // pk) * pk
    return q

@app.post("/api/orders")
async def create_order(req: Request, c=Depends(require_client)):
    b = await req.json()
    ct = kv_get("content")
    all_prods = {p["id"]: p for p in ct["products"]}
    prods = {k: p for k, p in all_prods.items() if p.get("active")}
    kits = {k["id"]: k for k in ct.get("kits", [])}
    items, total = [], 0.0
    for it in b.get("items", []):
        if it.get("kitId"):
            k = kits.get(int(it["kitId"]))
            calc = kit_calc(k, all_prods) if k and visible_kit(k) else None
            if not calc:
                raise HTTPException(400, "Um kit do seu pedido não está mais disponível. Remova-o do carrinho.")
            q = max(1, int(it.get("qty") or 1))
            if calc["maxKits"] is not None and q > calc["maxKits"]:
                raise HTTPException(400, f'Kit "{k["name"]}": disponível no máximo {calc["maxKits"]} kit(s).')
            line = round(q * calc["price"], 2)
            items.append(dict(type="kit", kitId=k["id"], sku=f'KIT-{k["id"]}', name=f'Kit {k["name"]}', collection="Kit promocional",
                              qty=q, price=calc["price"], fullPrice=calc["full"], total=line, components=calc["components"]))
            total += line
            continue
        p = prods.get(int(it.get("id", 0)))
        if not p:
            continue
        q = normalize_qty(p, it.get("qty"))
        line = round(q * float(p["price"]), 2)
        items.append(dict(id=p["id"], sku=p["sku"], name=p["name"], collection=p.get("collection"), qty=q, price=float(p["price"]), total=line))
        total += line
    if not items:
        raise HTTPException(400, "Pedido sem itens válidos.")
    with engine.begin() as cx:
        res = cx.execute(insert(orders).values(
            client_id=c["id"], client_name=c["name"], client_doc=c.get("docDisplay") or c.get("doc"),
            price_table=c.get("priceTable"), payment=(b.get("payment") or "")[:100], obs=(b.get("obs") or "")[:2000],
            items=json.dumps(items, ensure_ascii=False), total=round(total, 2), status="Recebido",
            created_at=now(), updated_at=now()))
        oid = res.inserted_primary_key[0]
        number = f"ZN{oid:06d}"
        cx.execute(update(orders).where(orders.c.id == oid).values(number=number))
        r = cx.execute(select(orders).where(orders.c.id == oid)).first()
    return order_row(r)

@app.get("/api/orders/mine")
def my_orders(c=Depends(require_client)):
    with engine.connect() as cx:
        rs = cx.execute(select(orders).where(orders.c.client_id == c["id"]).order_by(orders.c.id.desc()).limit(200)).all()
    return [order_row(r) for r in rs]

# ---------- admin
@app.post("/api/admin/login")
async def admin_login(req: Request):
    b = await req.json()
    a = kv_get("admin")
    if (b.get("user") or "").strip() != a["user"] or not check_pw(b.get("password") or "", a["password"]):
        time.sleep(0.6)
        raise HTTPException(401, "Usuário ou senha inválidos.")
    return {"session": sign({"t": "a", "exp": time.time() + 12 * 3600})}

@app.get("/api/admin/data")
def admin_data(_=Depends(require_admin)):
    with engine.connect() as cx:
        n_orders = cx.execute(select(func.count()).select_from(orders)).scalar()
        n_new = cx.execute(select(func.count()).select_from(orders).where(orders.c.status == "Recebido")).scalar()
    return {"content": kv_get("content"), "clients": kv_get("clients", []), "adminUser": kv_get("admin")["user"],
            "orderStatus": ORDER_STATUS, "ordersCount": n_orders, "ordersNew": n_new}

@app.put("/api/admin/content")
async def save_content(req: Request, _=Depends(require_admin)):
    b = await req.json()
    ct = b.get("content")
    if not isinstance(ct, dict) or not isinstance(ct.get("products"), list) or not isinstance(ct.get("collections"), list):
        raise HTTPException(400, "Conteúdo inválido.")
    ct = externalize(ct)
    kv_set("content", ct)
    return {"ok": True, "content": ct}

@app.put("/api/admin/clients")
async def save_clients(req: Request, _=Depends(require_admin)):
    b = await req.json()
    cl = b.get("clients")
    if not isinstance(cl, list):
        raise HTTPException(400, "Lista de clientes inválida.")
    for x in cl:
        x["doc"] = norm_doc(x.get("docDisplay") or x.get("doc"))
        x["token"] = (x.get("token") or "").strip().upper()
    tokens = [x["token"] for x in cl if x["token"]]
    if len(tokens) != len(set(tokens)):
        raise HTTPException(400, "Existem tokens repetidos entre clientes.")
    kv_set("clients", cl)
    return {"ok": True, "clients": cl}

@app.post("/api/admin/token")
async def gen_token(req: Request, _=Depends(require_admin)):
    b = await req.json()
    doc, val = norm_doc(b.get("doc")), (b.get("validity") or "").strip()
    if not doc or not val:
        raise HTTPException(400, "Informe CNPJ/CPF e validade.")
    return {"token": make_client_token(doc, val)}

@app.post("/api/admin/credentials")
async def set_credentials(req: Request, _=Depends(require_admin)):
    b = await req.json()
    user, pw = (b.get("user") or "").strip(), b.get("password") or ""
    a = kv_get("admin")
    if user:
        a["user"] = user
    if pw:
        if len(pw) < 6:
            raise HTTPException(400, "A senha deve ter ao menos 6 caracteres.")
        a["password"] = hash_pw(pw)
    kv_set("admin", a)
    return {"ok": True, "user": a["user"]}

@app.post("/api/admin/upload")
async def upload(file: UploadFile = File(...), _=Depends(require_admin)):
    raw = await file.read()
    if len(raw) > 15 * 1024 * 1024:
        raise HTTPException(413, "Imagem maior que 15 MB.")
    return {"url": store_image(raw)}

@app.post("/api/admin/import")
async def import_backup(req: Request, _=Depends(require_admin)):
    b = await req.json()
    clients = b.pop("clients", None)
    ct = kv_get("content")
    for k in ("products", "collections", "home", "notices", "inspirations", "kits"):
        if k in b:
            ct[k] = b[k]
    if isinstance(b.get("settings"), dict):
        for k in ("whats", "email", "institutional", "payments"):
            if k in b["settings"]:
                ct["settings"][k] = b["settings"][k]
    ct = externalize(ct)
    kv_set("content", ct)
    if isinstance(clients, list):
        for x in clients:
            x["doc"] = norm_doc(x.get("docDisplay") or x.get("doc"))
        kv_set("clients", clients)
    return {"ok": True}

@app.get("/api/admin/backup")
def backup(_=Depends(require_admin)):
    payload = dict(kv_get("content"))
    payload["clients"] = kv_get("clients", [])
    return JSONResponse(payload, headers={"Content-Disposition": 'attachment; filename="zionne_catalogo_backup.json"'})

@app.get("/api/admin/orders")
def admin_orders(_=Depends(require_admin)):
    with engine.connect() as cx:
        rs = cx.execute(select(orders).order_by(orders.c.id.desc()).limit(1000)).all()
    return [order_row(r) for r in rs]

@app.patch("/api/admin/orders/{oid}")
async def admin_order_status(oid: int, req: Request, _=Depends(require_admin)):
    b = await req.json()
    st = b.get("status")
    if st not in ORDER_STATUS:
        raise HTTPException(400, "Status inválido.")
    with engine.begin() as cx:
        cx.execute(update(orders).where(orders.c.id == oid).values(status=st, updated_at=now()))
    return {"ok": True}

@app.delete("/api/admin/orders/{oid}")
def admin_order_delete(oid: int, _=Depends(require_admin)):
    with engine.begin() as cx:
        cx.execute(delete(orders).where(orders.c.id == oid))
    return {"ok": True}

@app.get("/api/admin/orders.csv")
def admin_orders_csv(session: str = ""):
    s = unsign(session)
    if not s or s.get("t") != "a":
        raise HTTPException(401)
    with engine.connect() as cx:
        rs = cx.execute(select(orders).order_by(orders.c.id)).all()
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";")
    w.writerow(["Pedido", "Data", "Cliente", "CNPJ/CPF", "Tabela", "Condição", "Status", "Código", "Produto", "Coleção", "Qtd", "Unitário", "Total item", "Total pedido", "Observação", "Kit de origem"])
    br = lambda v: f"{v:.2f}".replace(".", ",")
    for r in rs:
        o = order_row(r)
        dt = aware(r.created_at).astimezone(BR_TZ).strftime("%d/%m/%Y %H:%M") if r.created_at else ""
        for it in o["items"]:
            if it.get("type") == "kit":
                for c in it.get("components", []):
                    pr = c.get("promoPrice", c["price"])
                    w.writerow([o["number"], dt, o["client_name"], o["client_doc"], o["price_table"], o["payment"], o["status"],
                                c["sku"], c["name"], "", c["qty"] * it["qty"], br(pr), br(pr * c["qty"] * it["qty"]), br(o["total"]), o["obs"] or "",
                                f'{it["sku"]} {it["name"]} ({it["qty"]} kit(s) • preço cheio un. {br(c["price"])})'])
                continue
            w.writerow([o["number"], dt, o["client_name"], o["client_doc"], o["price_table"], o["payment"], o["status"],
                        it["sku"], it["name"], it.get("collection", ""), it["qty"], br(it["price"]), br(it["total"]), br(o["total"]), o["obs"] or "", ""])
    data = "﻿" + buf.getvalue()
    return Response(data.encode("utf-8"), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": 'attachment; filename="pedidos_zionne.csv"'})
