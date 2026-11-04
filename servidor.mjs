// Servidor do cardápio do Bar 360 Graus: página pública + painel do dono (/painel) com login.
// Sem dependências externas. Uso: node servidor.mjs   (porta 3200, só neste computador)
// Senha do dono: node definir-senha.mjs "nova senha"
import http from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { join, extname } from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { RAIZ, PASTA_DADOS, PASTA_UPLOADS, listarItens, carregarAjustes, salvarAjustes, renderizar, listarTextos, lerEventos, validarEventos, wifiAtual, validarWifi, listarSecoes, listarImagens, estruturaListas, temaAtual, validarTema, CORES, FONTES_TITULO, FONTES_TEXTO, TEMA_PADRAO } from './cardapio.mjs';
import { interpretar, aplicar, formatarPreco, texto } from './assistente.mjs';

const PORTA = Number(process.env.PORTA || 3200);
const HOST = process.env.HOST || '127.0.0.1';
const ARQ_ADMIN = join(PASTA_DADOS, 'admin.json');
const SESSAO_MS = 8 * 60 * 60 * 1000;
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.pdf': 'application/pdf' };

// ---------- autenticação ----------
const sessoes = new Map();
let falhas = { n: 0, desde: 0 };

const hashSenha = (senha, salHex) => scryptSync(senha, Buffer.from(salHex, 'hex'), 64);
export function gravarSenha(senha) {
  const sal = randomBytes(16).toString('hex');
  mkdirSync(PASTA_DADOS, { recursive: true });
  writeFileSync(ARQ_ADMIN, JSON.stringify({ sal, hash: hashSenha(senha, sal).toString('hex') }));
}
function senhaCorreta(senha) {
  if (!existsSync(ARQ_ADMIN) || typeof senha !== 'string' || senha.length > 200) return false;
  const { sal, hash } = JSON.parse(readFileSync(ARQ_ADMIN, 'utf8'));
  const a = hashSenha(senha, sal), b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
function cookies(req) {
  const o = {};
  (req.headers.cookie || '').split(';').forEach((p) => { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = p.slice(i + 1).trim(); });
  return o;
}
function tokenAtivo(req) {
  const t = cookies(req).sessao;
  const exp = t && sessoes.get(t);
  if (!exp) return null;
  if (exp < Date.now()) { sessoes.delete(t); return null; }
  return t;
}

// ---------- utilidades ----------
function responder(res, status, corpo, tipo = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': tipo, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', ...extra });
  res.end(typeof corpo === 'string' || Buffer.isBuffer(corpo) ? corpo : JSON.stringify(corpo));
}
const erro = (res, status, msg) => responder(res, status, { erro: msg }, undefined, { 'Cache-Control': 'no-store' });

async function lerJson(req) {
  const partes = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > 64 * 1024) throw Object.assign(new Error('Pedido grande demais.'), { status: 413 }); partes.push(c); }
  try { return JSON.parse(Buffer.concat(partes).toString('utf8') || '{}'); } catch { throw Object.assign(new Error('JSON inválido.'), { status: 400 }); }
}

// A página inicial é o próprio cardápio (com o botão "Painel de controle" no topo), já com os ajustes do dono aplicados.
function paginaPublica() {
  return renderizar();
}

// corpo binário (upload de foto), com limite
async function lerBinario(req, limite) {
  const partes = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > limite) throw Object.assign(new Error('A foto passa de 5 MB.'), { status: 413 }); partes.push(c); }
  return Buffer.concat(partes);
}
function tipoImagem(b) {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length > 12 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}
const SECOES_VALIDAS = () => new Set(listarSecoes().map((x) => x.id));

// guarda o estado antes de cada alteração, pra o "desfazer" do painel e do assistente (só na memória, até 30 passos)
const historico = [];
function registrar() { historico.push(JSON.stringify(carregarAjustes())); if (historico.length > 30) historico.shift(); }

// ---------- rotas ----------
async function tratar(req, res) {
  const caminho = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const metodo = req.method;

  if (metodo === 'GET' && (caminho === '/' || caminho === '/cardapio.html')) {
    return responder(res, 200, paginaPublica(), 'text/html; charset=utf-8', { 'Cache-Control': 'no-cache' });
  }
  if (metodo === 'GET' && caminho === '/painel') {
    return responder(res, 200, readFileSync(join(RAIZ, 'painel.html')), 'text/html; charset=utf-8', {
      'Cache-Control': 'no-store',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
    });
  }
  const mUp = caminho.match(/^\/uploads\/([a-f0-9]{16}\.(jpg|png|webp))$/);
  if (metodo === 'GET' && mUp) {
    const arq = join(PASTA_UPLOADS, mUp[1]);
    if (!existsSync(arq)) return erro(res, 404, 'Foto não encontrada.');
    return responder(res, 200, readFileSync(arq), MIME['.' + mUp[2]], { 'Cache-Control': 'public, max-age=300' });
  }
  const mArq = caminho.match(/^\/(imagens\/[\w.-]+|cardapio-bar-360-graus\.pdf)$/);
  if (metodo === 'GET' && mArq) {
    const arq = join(RAIZ, mArq[1]);
    if (!existsSync(arq)) return erro(res, 404, 'Arquivo não encontrado.');
    return responder(res, 200, readFileSync(arq), MIME[extname(arq).toLowerCase()] || 'application/octet-stream', { 'Cache-Control': 'public, max-age=300' });
  }
  if (!caminho.startsWith('/api/')) return erro(res, 404, 'Não encontrado.');

  // login / sessão
  if (metodo === 'GET' && caminho === '/api/sessao') return responder(res, 200, { logado: !!tokenAtivo(req) }, undefined, { 'Cache-Control': 'no-store' });
  if (metodo === 'POST' && caminho === '/api/login') {
    if (req.headers['x-painel'] !== '1') return erro(res, 403, 'Requisição recusada.');
    const agora = Date.now();
    if (agora - falhas.desde > 10 * 60 * 1000) falhas = { n: 0, desde: agora };
    if (falhas.n >= 5) return erro(res, 429, 'Muitas tentativas. Espere alguns minutos.');
    const b = await lerJson(req);
    if (!existsSync(ARQ_ADMIN)) return erro(res, 503, 'A senha do dono ainda não foi definida. Rode: node definir-senha.mjs');
    if (!senhaCorreta(b.senha)) { falhas.n++; return erro(res, 401, 'Senha incorreta.'); }
    falhas = { n: 0, desde: agora };
    const t = randomBytes(32).toString('hex');
    sessoes.set(t, agora + SESSAO_MS);
    const seguro = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    return responder(res, 200, { ok: true }, undefined, { 'Set-Cookie': `sessao=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSAO_MS / 1000}${seguro}`, 'Cache-Control': 'no-store' });
  }

  // daqui em diante: só o dono logado (e, fora GET, com o cabeçalho do painel — barra pedidos de outros sites)
  const token = tokenAtivo(req);
  if (!token) return erro(res, 401, 'Entre com a senha do dono.');
  if (metodo !== 'GET' && req.headers['x-painel'] !== '1') return erro(res, 403, 'Requisição recusada.');

  if (metodo === 'POST' && caminho === '/api/logout') {
    sessoes.delete(token);
    return responder(res, 200, { ok: true }, undefined, { 'Set-Cookie': 'sessao=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }
  if (metodo === 'GET' && caminho === '/api/itens') {
    const aj = carregarAjustes();
    const itens = listarItens().map((i) => ({ ...i, ...(aj[i.id] ? { ajuste: aj[i.id] } : {}) }));
    return responder(res, 200, { itens }, undefined, { 'Cache-Control': 'no-store' });
  }
  if (metodo === 'POST' && caminho === '/api/senha') {
    const b = await lerJson(req);
    if (!senhaCorreta(b.atual)) return erro(res, 401, 'A senha atual não confere.');
    if (typeof b.nova !== 'string' || b.nova.length < 8 || b.nova.length > 200) return erro(res, 400, 'A nova senha precisa ter pelo menos 8 caracteres.');
    gravarSenha(b.nova);
    for (const t of [...sessoes.keys()]) if (t !== token) sessoes.delete(t);
    return responder(res, 200, { ok: true });
  }

  if (metodo === 'POST' && caminho === '/api/assistente') {
    const b = await lerJson(req);
    return responder(res, 200, interpretar(b.texto, listarItens(), carregarAjustes(), historico.length > 0), undefined, { 'Cache-Control': 'no-store' });
  }
  if (metodo === 'POST' && caminho === '/api/assistente/aplicar') {
    const b = await lerJson(req);
    const acoes = Array.isArray(b.acoes) ? b.acoes : [];
    if (!acoes.length) return erro(res, 400, 'Nada a aplicar.');
    if (acoes.length === 1 && acoes[0].tipo === 'desfazer') {
      const anterior = historico.pop();
      if (!anterior) return erro(res, 409, 'Não há nada para desfazer.');
      salvarAjustes(JSON.parse(anterior));
      return responder(res, 200, { feitas: 1, erros: [], desfeito: true });
    }
    const r = aplicar(acoes, listarItens(), carregarAjustes());
    if (r.feitas) { registrar(); salvarAjustes(r.ajustes); }
    return responder(res, 200, { feitas: r.feitas, erros: r.erros }, undefined, { 'Cache-Control': 'no-store' });
  }

  // ----- textos, aparência, seções, fotos e itens novos -----
  if (metodo === 'GET' && caminho === '/api/textos') {
    const aj = carregarAjustes()._textos || {};
    return responder(res, 200, { textos: listarTextos().filter((x) => x.secao !== 'eventos').map((t) => ({ ...t, ...(typeof aj[t.id] === 'string' ? { novo: aj[t.id] } : {}) })) }, undefined, { 'Cache-Control': 'no-store' });
  }
  const mTexto = caminho.match(/^\/api\/textos\/([a-z0-9:-]{1,120})$/);
  if (mTexto) {
    const id = mTexto[1];
    const original = listarTextos().find((t) => t.id === id);
    if (!original) return erro(res, 404, 'Texto não encontrado.');
    const aj = carregarAjustes(); const mapa = { ...(aj._textos || {}) };
    if (metodo === 'DELETE') { delete mapa[id]; registrar(); aj._textos = mapa; if (!Object.keys(mapa).length) delete aj._textos; salvarAjustes(aj); return responder(res, 200, { ok: true }); }
    if (metodo === 'PUT') {
      const b = await lerJson(req);
      const t = texto(b.texto, 300);
      if (!t) return erro(res, 400, 'O texto não pode ficar vazio. Use "Restaurar" pra voltar ao original.');
      if (t === original.texto) delete mapa[id]; else mapa[id] = t;
      registrar(); aj._textos = mapa; if (!Object.keys(mapa).length) delete aj._textos; salvarAjustes(aj);
      return responder(res, 200, { novo: mapa[id] ?? null });
    }
  }

  if (metodo === 'GET' && caminho === '/api/aparencia') {
    const aj = carregarAjustes();
    return responder(res, 200, {
      tema: temaAtual(aj), padrao: TEMA_PADRAO,
      cores: Object.fromEntries(Object.entries(CORES).map(([k, v]) => [k, v.rotulo])),
      fontesTitulo: Object.keys(FONTES_TITULO), fontesTexto: Object.keys(FONTES_TEXTO),
      secoes: listarSecoes().map((x) => ({ ...x, oculta: !!aj._secoes?.[x.id] })),
      imagens: listarImagens().map((i) => ({ ...i, atual: aj._imagens?.[i.src] ? '/' + aj._imagens[i.src] : '/' + i.src, trocada: !!aj._imagens?.[i.src] })),
    }, undefined, { 'Cache-Control': 'no-store' });
  }
  if (metodo === 'PUT' && caminho === '/api/aparencia') {
    const b = await lerJson(req);
    const aj = carregarAjustes();
    if (b.tema !== undefined) {
      if (b.tema === null) delete aj._tema;
      else { const v = validarTema(b.tema); if (v.erro) return erro(res, 400, v.erro); aj._tema = v.tema; }
    }
    if (b.secoes !== undefined) {
      const validas = SECOES_VALIDAS(); const ocultas = {};
      for (const [id, v] of Object.entries(b.secoes || {})) if (validas.has(id) && v === true) ocultas[id] = true;
      if (Object.keys(ocultas).length) aj._secoes = ocultas; else delete aj._secoes;
    }
    registrar(); salvarAjustes(aj);
    return responder(res, 200, { ok: true });
  }

  if (caminho === '/api/imagem') {
    const src = new URL(req.url, 'http://x').searchParams.get('src') || '';
    if (!listarImagens().some((i) => i.src === src)) return erro(res, 404, 'Imagem não encontrada no cardápio.');
    const aj = carregarAjustes(); const trocas = { ...(aj._imagens || {}) };
    if (metodo === 'DELETE') { delete trocas[src]; registrar(); if (Object.keys(trocas).length) aj._imagens = trocas; else delete aj._imagens; salvarAjustes(aj); return responder(res, 200, { ok: true }); }
    if (metodo === 'POST') {
      const bytes = await lerBinario(req, 5 * 1024 * 1024);
      const ext = tipoImagem(bytes);
      if (!ext) return erro(res, 415, 'Envie uma foto JPG, PNG ou WebP.');
      mkdirSync(PASTA_UPLOADS, { recursive: true });
      const nome = randomBytes(8).toString('hex') + '.' + ext;
      const tmp = join(PASTA_UPLOADS, nome + '.tmp');
      writeFileSync(tmp, bytes); renameSync(tmp, join(PASTA_UPLOADS, nome));
      trocas[src] = 'uploads/' + nome; registrar(); aj._imagens = trocas; salvarAjustes(aj);
      return responder(res, 200, { atual: '/uploads/' + nome });
    }
  }

  if (caminho === '/api/wifi') {
    const aj = carregarAjustes();
    if (metodo === 'GET') return responder(res, 200, { wifi: wifiAtual(aj) }, undefined, { 'Cache-Control': 'no-store' });
    if (metodo === 'PUT') {
      const v = validarWifi((await lerJson(req)).wifi);
      if (v.erro) return erro(res, 400, v.erro);
      registrar(); aj._wifi = v.wifi; salvarAjustes(aj);
      return responder(res, 200, { ok: true });
    }
    if (metodo === 'DELETE') { registrar(); delete aj._wifi; salvarAjustes(aj); return responder(res, 200, { ok: true }); }
  }

  if (caminho === '/api/eventos') {
    const aj = carregarAjustes();
    if (metodo === 'GET') {
      const padrao = lerEventos();
      return responder(res, 200, { eventos: aj._eventos || padrao, padrao, personalizado: !!aj._eventos }, undefined, { 'Cache-Control': 'no-store' });
    }
    if (metodo === 'PUT') {
      const v = validarEventos((await lerJson(req)).eventos);
      if (v.erro) return erro(res, 400, v.erro);
      registrar(); aj._eventos = v.eventos; salvarAjustes(aj);
      return responder(res, 200, { ok: true });
    }
    if (metodo === 'DELETE') { registrar(); delete aj._eventos; salvarAjustes(aj); return responder(res, 200, { ok: true }); }
  }

  if (metodo === 'GET' && caminho === '/api/estrutura') return responder(res, 200, { secoes: estruturaListas() }, undefined, { 'Cache-Control': 'no-store' });
  if (metodo === 'POST' && caminho === '/api/novos') {
    const b = await lerJson(req);
    const est = estruturaListas()[b.secao];
    if (!est) return erro(res, 400, 'Escolha uma categoria.');
    const lista = Number(b.lista);
    const alvo = est.listas.find((l) => l.lista === lista);
    if (!alvo) return erro(res, 400, 'Escolha em qual lista o item entra.');
    const nome = texto(b.nome, 80);
    if (!nome) return erro(res, 400, 'O nome é obrigatório.');
    const item = { uid: randomBytes(4).toString('hex'), secao: b.secao, lista, nome };
    if (alvo.tipo !== 'chips') {
      const preco = formatarPreco(b.preco);
      if (!preco) return erro(res, 400, 'Preço inválido. Use algo como 24,90.');
      item.preco = preco;
      const d = texto(b.descricao, 160); if (d) item.descricao = d;
    }
    const aj = carregarAjustes(); registrar();
    aj._novos = [...(aj._novos || []), item]; salvarAjustes(aj);
    return responder(res, 201, { uid: item.uid });
  }
  const mNovo = caminho.match(/^\/api\/novos\/([a-f0-9]{8})$/);
  if (metodo === 'DELETE' && mNovo) {
    const aj = carregarAjustes();
    const alvo = (aj._novos || []).find((n) => n.uid === mNovo[1]);
    if (!alvo) return erro(res, 404, 'Item novo não encontrado.');
    registrar();
    // some também qualquer ajuste de preço/nome/ocultar que o item tenha ganhado
    const antes = listarItens().find((i) => i.novo === alvo.uid);
    if (antes) delete aj[antes.id];
    aj._novos = aj._novos.filter((n) => n.uid !== alvo.uid); if (!aj._novos.length) delete aj._novos;
    salvarAjustes(aj);
    return responder(res, 200, { ok: true });
  }
  if (metodo === 'GET' && caminho === '/api/novos-chips') {
    return responder(res, 200, { chips: (carregarAjustes()._novos || []).filter((n) => !n.preco).map((n) => ({ uid: n.uid, secao: n.secao, nome: n.nome })) }, undefined, { 'Cache-Control': 'no-store' });
  }

  const mFotoItem = caminho.match(/^\/api\/itens\/([a-z0-9:-]{1,120})\/foto$/);
  if (mFotoItem) {
    const id = mFotoItem[1];
    if (!listarItens().some((i) => i.id === id)) return erro(res, 404, 'Item não encontrado.');
    const aj = carregarAjustes();
    if (metodo === 'DELETE') {
      registrar();
      if (aj[id]) { delete aj[id].foto; if (!Object.keys(aj[id]).length) delete aj[id]; }
      salvarAjustes(aj);
      return responder(res, 200, { ok: true });
    }
    if (metodo === 'POST') {
      const bytes = await lerBinario(req, 5 * 1024 * 1024);
      const ext = tipoImagem(bytes);
      if (!ext) return erro(res, 415, 'Envie uma foto JPG, PNG ou WebP.');
      mkdirSync(PASTA_UPLOADS, { recursive: true });
      const nome = randomBytes(8).toString('hex') + '.' + ext;
      const tmp = join(PASTA_UPLOADS, nome + '.tmp');
      writeFileSync(tmp, bytes); renameSync(tmp, join(PASTA_UPLOADS, nome));
      registrar();
      aj[id] = { ...(aj[id] || {}), foto: 'uploads/' + nome };
      salvarAjustes(aj);
      return responder(res, 200, { foto: 'uploads/' + nome });
    }
  }

  const mItem = caminho.match(/^\/api\/itens\/([a-z0-9:-]{1,120})$/);
  if (mItem) {
    const id = mItem[1];
    const original = listarItens().find((i) => i.id === id);
    if (!original) return erro(res, 404, 'Item não encontrado.');
    const aj = carregarAjustes();
    if (metodo === 'DELETE') { registrar(); delete aj[id]; salvarAjustes(aj); return responder(res, 200, { ok: true }); }
    if (metodo === 'PUT') {
      const b = await lerJson(req);
      const nome = texto(b.nome, 80);
      if (!nome) return erro(res, 400, 'O nome é obrigatório.');
      const preco = formatarPreco(b.preco);
      if (!preco) return erro(res, 400, 'Preço inválido. Use algo como 24,90.');
      const novo = {};
      if (nome !== original.nome) novo.nome = nome;
      if (preco !== original.preco) novo.preco = preco;
      if (b.oculto === true) novo.oculto = true;
      if (aj[id]?.foto) novo.foto = aj[id].foto;
      if (Object.keys(novo).length) aj[id] = novo; else delete aj[id];
      registrar(); salvarAjustes(aj);
      return responder(res, 200, { ajuste: aj[id] || null });
    }
  }
  return erro(res, 404, 'Rota não encontrada.');
}

const servidor = http.createServer((req, res) => {
  tratar(req, res).catch((e) => {
    if (res.headersSent) return res.end();
    erro(res, e.status || 500, e.status ? e.message : 'Erro interno.');
    if (!e.status) console.error(e);
  });
});

if (process.argv[1] && process.argv[1].endsWith('servidor.mjs')) {
  servidor.listen(PORTA, HOST, () => {
    console.log(`Cardápio no ar: http://${HOST}:${PORTA}/   ·   painel do dono: http://${HOST}:${PORTA}/painel`);
    if (!existsSync(ARQ_ADMIN)) console.log('ATENÇÃO: a senha do dono ainda não existe. Rode: node definir-senha.mjs');
  });
}
