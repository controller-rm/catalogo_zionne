# Catálogo Virtual Zionne — versão online

Programa web completo a partir do `Catalogo_Virtual_Zionne_V10_COLECOES_CARROSSEL_HORIZONTAL.html`.
Mesmo visual da V10, agora com servidor e banco de dados: tudo o que o admin cadastra aparece para
todos os clientes, e os pedidos chegam centralizados no painel.

## O que mudou em relação à V10

| V10 (arquivo HTML) | Versão online |
|---|---|
| Dados salvos só no navegador de quem editou | Dados no servidor (PostgreSQL), iguais para todos |
| Senha do admin e tokens visíveis no código | Senha criptografada no servidor; token gerado com chave secreta |
| Fotos embutidas em base64 / IndexedDB | Upload para o servidor, com redução e conversão automática (WebP) |
| "Finalizar pedido" só limpava o carrinho | Pedido gravado com número (ZN000001), preço recalculado no servidor |
| "Pedidos em aberto" com 3 linhas fixas | "Meus pedidos" real por cliente, com PDF, WhatsApp e "Repetir pedido" |
| — | Aba **Pedidos** no admin: status, PDF, exportação Excel (CSV) |
| — | Link de acesso por cliente (`/?doc=...&token=...`) + mensagem pronta para WhatsApp |
| — | Bloqueio/validade conferidos a cada acesso (cliente bloqueado sai na hora) |

## Produtos por planilha (CSV)

Admin → Produtos → **Baixar modelo CSV** → preencha no Excel → **Importar CSV**.
Colunas: `Código; Produto; Coleção; Preço; Estoque; Mín; Emb; URL da imagem` (separador `;`, decimal com vírgula).
- O código identifica o produto: existe → atualiza; não existe → cria. Coleções novas são criadas.
- Campo em branco mantém o valor atual. Antes de gravar aparece a conferência com as miniaturas das URLs.
- Imagens só por URL (nada é gravado no banco). Links do Google Drive, OneDrive e Dropbox são convertidos em link direto.

## Kits promocionais

Admin → **Kits promocionais** → "+ Novo kit":
- Escolha os produtos e a quantidade de cada um por kit.
- Desconto em **%** ou **R$**, ou digite direto o **preço final** do kit (o desconto é calculado).
- O **simulador** mostra preço cheio, desconto, preço do kit, **quantos kits o estoque permite**,
  qual produto limita, faturamento máximo e, para uma meta ("quero montar 50 kits"), quanto falta de cada item.
- Condição especial: desconto %, desconto R$, preço final do kit ou preço manual por item.
  O desconto é rateado entre os itens: cada produto vai para o pedido no seu preço promocional.
- Período da campanha, limite de kits e opção de mostrar ao cliente quantos kits restam.
- **★ Destacar na tela principal**: banner de campanha no topo da Home (selo, título, subtítulo, preço,
  imagem por URL e botão "Quero essa oportunidade", que coloca o kit no pedido e abre o carrinho).

Os kits possíveis usam o campo **Estoque (quantidade)** do produto (em branco = sem controle).
O estoque não é baixado automaticamente pelos pedidos: atualize a quantidade no produto.
No pedido, o kit sai como `KIT-n` com a composição detalhada (PDF, WhatsApp e CSV).

## Endereços

- Catálogo (clientes): `https://SEU-ENDERECO/`
- Painel administrativo: `https://SEU-ENDERECO/admin` (ou Ctrl+Alt+A, ou 5 cliques no logo)

Acesso inicial do painel: **admin / zionne2026** (ou o definido em `ADMIN_PASSWORD`).
Troque em **Configurações → Acesso administrativo** no primeiro uso.

Cliente de demonstração criado automaticamente: CNPJ `12.345.678/0001-90`, token `ZIONNE-DEMO-2026`.
Exclua ou bloqueie em **Clientes / Tokens** antes de divulgar.

## Rodar no computador (teste)

1. Ter o Python 3.11+ instalado.
2. Dar dois cliques em `iniciar_local.bat`.
3. Abre em `http://localhost:8000`. Os dados ficam em `data\zionne.db` (SQLite).

Para outros computadores da mesma rede acessarem: `http://IP-DESTE-PC:8000`.

## Publicar na internet (Render.com)

1. Suba esta pasta para um repositório no GitHub.
2. No Render: **New → Blueprint** → escolha o repositório. O `render.yaml` cria o site e o banco PostgreSQL.
3. Informe a `ADMIN_PASSWORD` quando o Render pedir.
4. Opcional: em **Settings → Custom Domains**, use um domínio como `catalogo.zionne.com.br`.

Variáveis de ambiente:

| Variável | Uso |
|---|---|
| `DATABASE_URL` | PostgreSQL. Sem ela, usa SQLite local em `data/` |
| `SECRET_KEY` | Assina sessões e gera tokens. **Não troque depois de publicado** (invalida sessões) |
| `ADMIN_USER` / `ADMIN_PASSWORD` | Acesso inicial do painel (só valem na primeira inicialização) |

> Importante: não use SQLite no Render — o disco do serviço é apagado a cada deploy. Use o PostgreSQL.

## Trazer os cadastros da V10

Se você já cadastrou produtos no arquivo V10:
1. Abra o V10 no mesmo navegador onde cadastrou → Administração → Configurações → **Exportar JSON**.
2. No painel novo → Configurações → **Importar JSON**.

Fotos de produtos, avisos, inspirações e banner são convertidas automaticamente.
Fotos de **coleções** carregadas por arquivo na V10 ficavam no IndexedDB e não vão no JSON: reenvie essas pelo painel.

## Estrutura

```
app/main.py            servidor FastAPI (API, banco, imagens, pedidos)
app/static/index.html  telas (layout da V10)
app/static/app.js      lógica do catálogo e do painel
app/static/img/        logo e imagens iniciais
requirements.txt       dependências Python
render.yaml            deploy no Render
iniciar_local.bat      roda no Windows
```
