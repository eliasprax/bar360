// Lê o cardapio.html e aplica por cima tudo o que o dono muda no painel (data/ajustes.json).
// O cardapio.html em si nunca é reescrito: o servidor entrega a página já com os ajustes aplicados.
//
// Formato do ajustes.json:
//   "secao:item"  -> { nome?, preco?, oculto? }         ajustes de itens com preço (chave sempre tem ":")
//   "_textos"     -> { id: "novo texto" }               qualquer texto da página
//   "_novos"      -> [ { uid, secao, lista, nome, preco?, descricao? } ]   itens criados pelo dono
//   "_secoes"     -> { secaoId: true }                  seções escondidas
//   "_imagens"    -> { "imagens/x.png": "uploads/abc.png" }   fotos trocadas
//   "_tema"       -> { cores, fontes, tamanho }         aparência
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = dirname(fileURLToPath(import.meta.url));
export const PASTA_DADOS = join(RAIZ, 'data');
export const PASTA_UPLOADS = join(PASTA_DADOS, 'uploads');
export const ARQ_PAGINA = join(RAIZ, 'cardapio.html');
const ARQ_AJUSTES = join(PASTA_DADOS, 'ajustes.json');

const ENTIDADES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
export const decodificar = (s) => s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTIDADES[m]);
export const escapar = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const TITULOS = {
  topo: 'Topo da página', menu: 'Menu de categorias', caldos: 'Caldos', espetinhos: 'Espetinhos', petiscos: 'Petiscos',
  hamburguer: 'Hambúrguer', cervejas: 'Cervejas', drinks: 'Drinks', semalcool: 'Sem álcool', eventos: 'Eventos',
  contato: 'Contato', rodape: 'Rodapé',
};

// ---------- ajustes (arquivo) ----------
export function carregarAjustes() {
  if (!existsSync(ARQ_AJUSTES)) return {};
  try { return JSON.parse(readFileSync(ARQ_AJUSTES, 'utf8')); } catch { return {}; }
}
export function salvarAjustes(a) {
  mkdirSync(PASTA_DADOS, { recursive: true });
  if (existsSync(ARQ_AJUSTES)) copyFileSync(ARQ_AJUSTES, ARQ_AJUSTES + '.anterior');
  const tmp = ARQ_AJUSTES + '.tmp';
  writeFileSync(tmp, JSON.stringify(a, null, 2));
  renameSync(tmp, ARQ_AJUSTES);
}

// ---------- itens com preço ----------
const RE_SECAO = /<section class="secao[^"]*" id="([^"]+)"[\s\S]*?<\/section>/g;
const RE_ITEM = /<li\b(?:(?!<\/li>)[\s\S])*?class="preco"(?:(?!<\/li>)[\s\S])*?<\/li>/g;
const RE_PRECO = /(<span class="preco">)R\$&nbsp;([\d.,]+)(<\/span>)/;

// Percorre as seções e chama fn(li, info) para cada item com preço; fn devolve o novo HTML do item ('' remove).
function percorrer(html, fn) {
  return html.replace(RE_SECAO, (bloco, secao) => {
    const vistos = new Map();
    return bloco.replace(RE_ITEM, (li) => {
      const pm = li.match(RE_PRECO);
      if (!pm) return li;
      const antesPreco = li.slice(0, li.indexOf('<span class="preco">'));
      const nos = [...antesPreco.matchAll(/>([^<>]+)</g)].map((x) => x[1]).filter((t) => t.trim());
      const nomeRaw = nos[0];
      if (!nomeRaw) return li;
      const nomeTxt = decodificar(nomeRaw).trim();
      const base = secao + ':' + slug(nomeTxt);
      const n = (vistos.get(base) || 0) + 1; vistos.set(base, n);
      const id = n === 1 ? base : base + '-' + n;
      const novo = li.match(/^<li\b[^>]*\bdata-novo="([a-z0-9]+)"/)?.[1] || null;
      const fotoOriginal = li.match(/<img\b[^>]*\bsrc="([^"]+)"/)?.[1] || null;
      return fn(li, { id, secao, nomeRaw, nomeTxt, preco: pm[2], novo, fotoOriginal });
    });
  });
}

export const lerPagina = () => readFileSync(ARQ_PAGINA, 'utf8');

// página original + itens que o dono criou (é a base de tudo: ids, textos e ajustes partem daqui)
export function baseHtml() { return inserirNovos(lerPagina(), carregarAjustes()._novos || []); }

export function listarItens(html = baseHtml()) {
  const itens = [];
  const main = html.match(/<main[\s\S]*?<\/main>/)?.[0] ?? html;
  percorrer(main, (li, i) => { itens.push({ id: i.id, secao: i.secao, titulo: TITULOS[i.secao] || i.secao, nome: i.nomeTxt, preco: i.preco, ...(i.novo ? { novo: i.novo } : {}), ...(i.fotoOriginal ? { fotoOriginal: i.fotoOriginal } : {}) }); return li; });
  return itens;
}

const FOTO_VALIDA = /^uploads\/[a-f0-9]{16}\.(jpg|png|webp)$/;
// põe (ou troca) a foto de um item, no mesmo desenho que o cardápio já usa nos itens com foto
function comFoto(li, url, nome) {
  const alt = escapar(nome);
  const addClasse = (attrs, cl) => (/class="/.test(attrs) ? attrs.replace(/class="([^"]*)"/, (_, c) => `class="${c} ${cl}"`) : ` class="${cl}"${attrs}`);
  if (/<img\b/.test(li)) return li.replace(/(<img\b[^>]*\bsrc=")[^"]*"/, (_, a) => `${a}${url}"`);
  if (/<span class="n">/.test(li)) {
    return li.replace(/^<li([^>]*)>/, (_, a) => `<li${addClasse(a, 'foto')}>`)
      .replace(/<span class="n">([\s\S]*?)<\/span>(?=<span class="pt")/, (_, dentro) => `<span class="n com-img"><img class="mini" src="${url}" alt="${alt}" width="56" height="56" loading="lazy"><span class="t">${dentro}</span></span>`);
  }
  return li.replace(/^<li([^>]*)><div>([\s\S]*?)<\/div>(<span class="preco">)/, (_, a, dentro, p) => `<li${addClasse(a, 'com-foto')}><div class="corpo"><img src="${url}" alt="${alt}" width="68" height="68" loading="lazy"><div>${dentro}</div></div>${p}`);
}

export function aplicarAjustes(html, ajustes = carregarAjustes()) {
  return percorrer(html, (li, i) => {
    const aj = ajustes[i.id];
    if (!aj) return li;
    if (aj.oculto) return '';
    let novo = li;
    if (aj.preco) novo = novo.replace(RE_PRECO, (_, a, __, c) => `${a}R$&nbsp;${aj.preco}${c}`);
    if (aj.nome) {
      const folga = /\s$/.test(i.nomeRaw) ? ' ' : '';
      novo = novo.replace('>' + i.nomeRaw + '<', () => '>' + escapar(aj.nome) + folga + '<');
    }
    if (typeof aj.foto === 'string' && FOTO_VALIDA.test(aj.foto)) novo = comFoto(novo, '/' + aj.foto, aj.nome || i.nomeTxt);
    return novo;
  });
}

// ---------- itens novos ----------
const RE_LISTA = /<ul class="(linhas|lista|chips)"[^>]*>[\s\S]*?<\/ul>/g;
function liNovo(classe, n) {
  const nome = escapar(n.nome), d = n.descricao ? escapar(n.descricao) : '', attr = ` data-novo="${n.uid}"`;
  const preco = n.preco ? `R$&nbsp;${n.preco}` : '';
  if (classe === 'chips') return `<li${attr}>${nome}</li>`;
  if (classe === 'lista') return `<li${attr}><div><h3>${nome}</h3>${d ? `<p>${d}</p>` : ''}</div><span class="preco">${preco}</span></li>`;
  return `<li${attr}><span class="n">${nome}${d ? `<small>${d}</small>` : ''}</span><span class="pt" aria-hidden="true"></span><span class="preco">${preco}</span></li>`;
}
export function inserirNovos(html, novos = []) {
  if (!novos.length) return html;
  return html.replace(RE_SECAO, (bloco, secao) => {
    const meus = novos.filter((n) => n.secao === secao);
    if (!meus.length) return bloco;
    let idx = -1;
    return bloco.replace(RE_LISTA, (ul, classe) => {
      idx++;
      const extra = meus.filter((n) => n.lista === idx).map((n) => liNovo(classe, n)).join('');
      return extra ? ul.replace(/<\/ul>$/, () => extra + '</ul>') : ul;
    });
  });
}
// onde dá pra colocar um item novo: { secaoId: [{ lista, titulo, tipo }] }
export function estruturaListas(html = lerPagina()) {
  const mapa = {};
  html.replace(RE_SECAO, (bloco, secao) => {
    const listas = []; let idx = -1;
    for (const m of bloco.matchAll(/(?:<h3 class="sub">([^<]*)<\/h3>\s*)?<ul class="(linhas|lista|chips)"/g)) {
      idx++;
      listas.push({ lista: idx, titulo: m[1] ? decodificar(m[1]) : (m[2] === 'chips' ? 'Sabores' : m[2] === 'lista' ? 'Lista principal' : '(lista sem título)'), tipo: m[2] });
    }
    if (listas.length) mapa[secao] = { titulo: TITULOS[secao] || secao, listas };
    return bloco;
  });
  return mapa;
}

// ---------- textos livres ----------
const RE_TOKEN = /<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>|<(\/?)([a-z][a-z0-9]*)\b([^>]*)>|([^<]+)/gi;
function percorrerTextos(html, fn) {
  const ini = html.indexOf('<body'), fim = html.indexOf('</footer>');
  if (ini < 0 || fim < 0) return html;
  const corpo = html.slice(ini, fim);
  const intervalos = [...corpo.matchAll(RE_ITEM)].map((m) => [m.index, m.index + m[0].length]);
  const primeiros = new Set(), vistos = new Map();
  let secao = 'topo';
  const saida = corpo.replace(RE_TOKEN, (m, fecha, tag, attrs, texto, offset) => {
    if (tag) {
      if (fecha) return m;
      const t = tag.toLowerCase();
      if (t === 'section') { const id = attrs.match(/\bid="([^"]+)"/)?.[1]; if (id) secao = id; }
      else if (t === 'header' && /class="[^"]*\btopo\b/.test(attrs)) secao = 'topo';
      else if (t === 'nav') secao = 'menu';
      else if (t === 'footer') secao = 'rodape';
      return m;
    }
    if (texto === undefined || !texto.trim()) return m;
    // nome e preço dos itens com preço têm o próprio ajuste; aqui ficam só as descrições
    const dentro = intervalos.find(([a, b]) => offset >= a && offset < b);
    if (dentro) {
      if (!primeiros.has(dentro[0])) { primeiros.add(dentro[0]); return m; }
      if (/^R\$&nbsp;/.test(texto.trim())) return m;
    }
    const raw = texto.trim();
    const base = secao + ':' + (slug(decodificar(raw)).slice(0, 40) || 'texto');
    const n = (vistos.get(base) || 0) + 1; vistos.set(base, n);
    const id = n === 1 ? base : base + '-' + n;
    const novo = fn({ id, secao, raw });
    if (novo === undefined) return m;
    return texto.match(/^\s*/)[0] + novo + texto.match(/\s*$/)[0];
  });
  return html.slice(0, ini) + saida + html.slice(fim);
}
export function listarTextos(html = baseHtml()) {
  const lista = [];
  percorrerTextos(html, ({ id, secao, raw }) => { lista.push({ id, secao, titulo: TITULOS[secao] || secao, texto: decodificar(raw) }); });
  return lista;
}
export const formatarTextoNovo = (t) => escapar(t).replace(/R\$ /g, () => 'R$&nbsp;');
export function aplicarTextos(html, mapa = {}) {
  if (!Object.keys(mapa).length) return html;
  return percorrerTextos(html, ({ id }) => (typeof mapa[id] === 'string' ? formatarTextoNovo(mapa[id]) : undefined));
}

// ---------- seções ----------
export function listarSecoes(html = lerPagina()) {
  const lista = [];
  for (const m of html.matchAll(/<section\b[^>]*\bid="([^"]+)"[^>]*>[\s\S]*?<h2[^>]*>([^<]*)<\/h2>/g)) lista.push({ id: m[1], titulo: decodificar(m[2]).trim() });
  return lista;
}
export function ocultarSecoes(html, ocultas = {}) {
  let out = html;
  for (const id of Object.keys(ocultas).filter((k) => ocultas[k] && /^[a-z0-9-]+$/.test(k))) {
    out = out.replace(new RegExp(`<section\\b[^>]*\\bid="${id}"[^>]*>[\\s\\S]*?</section>\\n?`), '');
    out = out.replace(new RegExp(`[ \\t]*<li><a href="#${id}">[^<]*</a></li>\\n?`), '');
  }
  return out;
}

// ---------- imagens ----------
export function listarImagens(html = lerPagina()) {
  const mapa = new Map();
  for (const m of html.matchAll(/<img\b[^>]*>/g)) {
    const src = m[0].match(/\bsrc="(imagens\/[^"]+)"/)?.[1];
    if (src && !mapa.has(src)) mapa.set(src, decodificar(m[0].match(/\balt="([^"]*)"/)?.[1] || ''));
  }
  for (const m of html.matchAll(/\b(?:src|href)="(imagens\/[^"]+)"/g)) if (!mapa.has(m[1])) mapa.set(m[1], '');
  return [...mapa].map(([src, alt]) => ({ src, alt }));
}
export function aplicarImagens(html, trocas = {}) {
  let out = html;
  for (const [de, para] of Object.entries(trocas)) {
    if (!/^imagens\/[\w.-]+$/.test(de) || !/^uploads\/[a-f0-9]{16}\.(jpg|png|webp)$/.test(para)) continue;
    out = out.split(`"${de}"`).join(`"/${para}"`);
  }
  return out;
}

// ---------- aparência ----------
export const CORES = {
  ouro: { var: '--ouro', padrao: '#e2a72e', rotulo: 'Cor de destaque (botões, títulos, bordas)' },
  ouroClaro: { var: '--ouro-claro', padrao: '#f4cf72', rotulo: 'Destaque claro (preços)' },
  noite: { var: '--noite', padrao: '#0e0b08', rotulo: 'Fundo da página' },
  brasa: { var: '--brasa', padrao: '#1a140e', rotulo: 'Fundo dos blocos' },
  creme: { var: '--creme', padrao: '#f6ead2', rotulo: 'Cor do texto' },
  fumaca: { var: '--fumaca', padrao: '#b9a98c', rotulo: 'Texto secundário' },
  pimenta: { var: '--pimenta', padrao: '#d4452a', rotulo: 'Cor de alerta' },
};
export const FONTES_TITULO = {
  Fraunces: { familia: 'Fraunces', url: null, pilha: "'Fraunces','Fraunces Reserva Kit',serif" },
  'Playfair Display': { familia: 'Playfair Display', url: 'Playfair+Display:wght@700;900', pilha: "'Playfair Display',Georgia,serif" },
  Lora: { familia: 'Lora', url: 'Lora:wght@700', pilha: "'Lora',Georgia,serif" },
  Oswald: { familia: 'Oswald', url: 'Oswald:wght@700', pilha: "'Oswald',Impact,sans-serif" },
  'Bebas Neue': { familia: 'Bebas Neue', url: 'Bebas+Neue', pilha: "'Bebas Neue',Impact,sans-serif" },
  Poppins: { familia: 'Poppins', url: 'Poppins:wght@700;900', pilha: "'Poppins',Arial,sans-serif" },
};
export const FONTES_TEXTO = {
  Manrope: { familia: 'Manrope', url: null, pilha: "'Manrope','Manrope Reserva Kit',sans-serif" },
  Inter: { familia: 'Inter', url: 'Inter:wght@400;500;700', pilha: "'Inter',Arial,sans-serif" },
  Nunito: { familia: 'Nunito', url: 'Nunito:wght@400;500;700', pilha: "'Nunito',Arial,sans-serif" },
  Poppins: { familia: 'Poppins', url: 'Poppins:wght@400;500;700', pilha: "'Poppins',Arial,sans-serif" },
  Lora: { familia: 'Lora', url: 'Lora:wght@400;500;700', pilha: "'Lora',Georgia,serif" },
};
export const TEMA_PADRAO = {
  cores: Object.fromEntries(Object.entries(CORES).map(([k, v]) => [k, v.padrao])),
  fonteTitulos: 'Fraunces', fonteTexto: 'Manrope', tamanho: 100,
};
export const temaAtual = (a = carregarAjustes()) => ({ ...TEMA_PADRAO, ...(a._tema || {}), cores: { ...TEMA_PADRAO.cores, ...(a._tema?.cores || {}) } });

// valida o que veio do painel; devolve o tema limpo ou { erro }
export function validarTema(t) {
  if (!t || typeof t !== 'object') return { erro: 'Tema inválido.' };
  const cores = {};
  for (const k of Object.keys(CORES)) {
    const v = t.cores?.[k] ?? TEMA_PADRAO.cores[k];
    if (typeof v !== 'string' || !/^#[0-9a-f]{6}$/i.test(v)) return { erro: `Cor inválida em "${CORES[k].rotulo}".` };
    cores[k] = v.toLowerCase();
  }
  const fonteTitulos = t.fonteTitulos ?? 'Fraunces', fonteTexto = t.fonteTexto ?? 'Manrope';
  if (!FONTES_TITULO[fonteTitulos]) return { erro: 'Fonte dos títulos inválida.' };
  if (!FONTES_TEXTO[fonteTexto]) return { erro: 'Fonte do texto inválida.' };
  const tamanho = Number(t.tamanho ?? 100);
  if (!Number.isFinite(tamanho) || tamanho < 85 || tamanho > 125) return { erro: 'O tamanho do texto vai de 85% a 125%.' };
  return { tema: { cores, fonteTitulos, fonteTexto, tamanho: Math.round(tamanho) } };
}

export function injetarTema(html, ajustes = carregarAjustes()) {
  if (!ajustes._tema) return html;
  const t = temaAtual(ajustes);
  const css = [];
  const mudou = Object.entries(CORES).filter(([k, c]) => t.cores[k] !== c.padrao);
  if (mudou.length) css.push(':root{' + mudou.map(([k, c]) => `${c.var}:${t.cores[k]}`).join(';') + '}');
  if (t.fonteTitulos !== 'Fraunces') css.push(`h1,h2,h3{font-family:${FONTES_TITULO[t.fonteTitulos].pilha}}`);
  if (t.fonteTexto !== 'Manrope') css.push(`body{font-family:${FONTES_TEXTO[t.fonteTexto].pilha}}`);
  if (t.tamanho !== 100) css.push(`html{font-size:${t.tamanho}%}`);
  if (!css.length) return html;
  const pedidas = [t.fonteTitulos !== 'Fraunces' && FONTES_TITULO[t.fonteTitulos].url, t.fonteTexto !== 'Manrope' && FONTES_TEXTO[t.fonteTexto].url].filter(Boolean);
  const link = pedidas.length ? `<link href="https://fonts.googleapis.com/css2?${pedidas.map((u) => 'family=' + u).join('&')}&display=swap" rel="stylesheet">\n` : '';
  const meta = t.cores.noite !== CORES.noite.padrao ? html.replace(/(<meta name="theme-color" content=")[^"]*"/, (_, a) => `${a}${t.cores.noite}"`) : html;
  return meta.replace('</head>', () => `${link}<style id="tema-dono">${css.join('\n')}</style>\n</head>`);
}

// ---------- eventos (sexta, sábado, shows especiais) ----------
const RE_EVENTOS = /<section class="secao eventos" id="eventos"[\s\S]*?<\/section>/;
const limpo = (s) => decodificar(String(s).replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

// lê da página original o que hoje está na seção Eventos
export function lerEventos(html = lerPagina()) {
  const bloco = html.match(RE_EVENTOS)?.[0];
  if (!bloco) return null;
  const cards = [...bloco.matchAll(/<article class="ingresso ([a-z]+)"([^>]*)>([\s\S]*?)<\/article>/g)].map((m) => {
    const dsem = m[2].match(/data-dia-semana="(\d)"/)?.[1];
    return {
      cor: m[1] === 'sabado' ? 'pimenta' : 'ouro',
      diaSemana: dsem === undefined ? null : Number(dsem),
      dia: limpo(m[3].match(/<p class="dia">([\s\S]*?)<\/p>/)?.[1] || ''),
      datas: [...(m[3].match(/<ul class="datas"[^>]*>([\s\S]*?)<\/ul>/)?.[1] || '').matchAll(/<li>([\s\S]*?)<\/li>/g)].map((x) => limpo(x[1])),
      campos: [...m[3].matchAll(/<div><dt>([\s\S]*?)<\/dt><dd>([\s\S]*?)<\/dd><\/div>/g)].map((x) => ({ rotulo: limpo(x[1]), valor: limpo(x[2]) })),
      oculto: false,
    };
  });
  const botao = bloco.match(/<a class="btn btn-eventos" href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/);
  const avisos = [...bloco.matchAll(/<p class="aviso-18">([\s\S]*?)<\/p>/g)];
  return {
    intro: limpo(bloco.match(/<p class="nota">([\s\S]*?)<\/p>/)?.[1] || ''),
    cards,
    botaoTexto: limpo(botao?.[2] || ''), botaoLink: decodificar(botao?.[1] || ''),
    aviso: limpo(avisos.length ? avisos[avisos.length - 1][1] : ''),
  };
}

const t = (v, max) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
// confere o que veio do painel; devolve { eventos } limpo ou { erro }
export function validarEventos(e) {
  if (!e || typeof e !== 'object') return { erro: 'Dados de eventos inválidos.' };
  const botaoTexto = t(e.botaoTexto, 80);
  const botaoLink = typeof e.botaoLink === 'string' ? e.botaoLink.trim() : '';
  if (!botaoTexto) return { erro: 'O botão precisa de um texto.' };
  if (!/^https?:\/\/[^\s"'<>]{3,300}$/i.test(botaoLink)) return { erro: 'O link do botão precisa começar com http:// ou https://.' };
  if (!Array.isArray(e.cards) || e.cards.length > 8) return { erro: 'Use no máximo 8 eventos.' };
  const cards = [];
  for (const c of e.cards) {
    const dia = t(c?.dia, 40);
    if (!dia) return { erro: 'Todo evento precisa de um nome (ex.: Sexta, Sábado, Show de forró).' };
    const diaSemana = c.diaSemana === null || c.diaSemana === undefined ? null : Number(c.diaSemana);
    if (diaSemana !== null && !(Number.isInteger(diaSemana) && diaSemana >= 0 && diaSemana <= 6)) return { erro: 'Dia da semana inválido.' };
    const datas = (Array.isArray(c.datas) ? c.datas : []).slice(0, 8).map((d) => t(d, 40)).filter(Boolean);
    const campos = [];
    for (const f of (Array.isArray(c.campos) ? c.campos : []).slice(0, 10)) {
      const rotulo = t(f?.rotulo, 40), valor = t(f?.valor, 300);
      if (!rotulo && !valor) continue;
      if (!rotulo) return { erro: 'Um campo está com texto mas sem título (ex.: Horário).' };
      campos.push({ rotulo, valor });
    }
    cards.push({ cor: c.cor === 'pimenta' ? 'pimenta' : 'ouro', diaSemana, dia, datas, campos, oculto: c.oculto === true });
  }
  return { eventos: { intro: t(e.intro, 400), cards, botaoTexto, botaoLink, aviso: t(e.aviso, 400) } };
}

function htmlCard(c) {
  const semanal = Number.isInteger(c.diaSemana);
  const lis = c.datas.map((d) => '<li>' + escapar(d) + '</li>').join('');
  const linhas = c.campos.map((f) => '<div><dt>' + escapar(f.rotulo) + '</dt><dd>' + escapar(f.valor) + '</dd></div>').join('\n            ');
  return '<article class="ingresso ' + (c.cor === 'pimenta' ? 'sabado' : 'sexta') + '"' + (semanal ? ' data-dia-semana="' + c.diaSemana + '"' : '') + '>\n' +
    '          <header class="cabeca">\n            <p class="dia">' + escapar(c.dia) + '</p>\n' +
    '            <ul class="datas" aria-label="' + (semanal ? 'Próximas datas' : 'Datas') + '">' + lis + '</ul>\n          </header>\n' +
    '          <dl class="detalhes">\n            ' + linhas + '\n          </dl>\n        </article>';
}

// reescreve a seção Eventos com o que o dono montou no painel
export function aplicarEventos(html, ev) {
  if (!ev || !Array.isArray(ev.cards)) return html;
  return html.replace(RE_EVENTOS, (bloco) => {
    let b = bloco;
    b = b.replace(/<p class="nota">[\s\S]*?<\/p>/, () => '<p class="nota">' + escapar(ev.intro) + '</p>');
    const ini = b.indexOf('<div class="ingressos"'), fim = b.indexOf('<a class="btn btn-eventos"');
    if (ini >= 0 && fim > ini) {
      const cartoes = ev.cards.filter((c) => !c.oculto).map(htmlCard).join('\n        ');
      b = b.slice(0, ini) + '<div class="ingressos" data-mk="grupo">\n        ' + cartoes + '\n      </div>\n      ' + b.slice(fim);
    }
    b = b.replace(/<a class="btn btn-eventos" href="[^"]*"([^>]*)>[\s\S]*?<\/a>/, (_, resto) => '<a class="btn btn-eventos" href="' + escapar(ev.botaoLink) + '"' + resto + '>' + escapar(ev.botaoTexto) + '</a>');
    const k = b.lastIndexOf('<p class="aviso-18">');
    if (k >= 0) { const f = b.indexOf('</p>', k); b = b.slice(0, k) + '<p class="aviso-18">' + escapar(ev.aviso) + b.slice(f); }
    return b;
  });
}

// ---------- Wi-Fi para os clientes ----------
export const WIFI_PADRAO = { ativo: false, rede: '', senha: '', mensagem: 'Cortesia da casa. É só conectar.' };
export const wifiAtual = (a = carregarAjustes()) => ({ ...WIFI_PADRAO, ...(a._wifi || {}) });

// confere o que veio do painel; devolve { wifi } limpo ou { erro }
export function validarWifi(w) {
  if (!w || typeof w !== 'object') return { erro: 'Dados do Wi-Fi inválidos.' };
  const limpa = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '');
  const rede = limpa(w.rede, 40), senha = limpa(w.senha, 63), mensagem = limpa(w.mensagem, 120);
  const ativo = w.ativo === true;
  if (ativo && !rede) return { erro: 'Escreva o nome da rede Wi-Fi.' };
  if (ativo && senha.length < 1) return { erro: 'Escreva a senha do Wi-Fi.' };
  if (typeof w.senha === 'string' && w.senha.trim().length > 63) return { erro: 'A senha de Wi-Fi tem no máximo 63 caracteres.' };
  return { wifi: { ativo, rede, senha, mensagem } };
}

const CSS_WIFI = '.wifi-card{display:grid;gap:12px;max-width:520px;margin-top:18px;padding:18px;background:var(--brasa);border:1px solid #3a2e1e;border-radius:16px}' +
  '.wifi-linha{display:flex;align-items:center;gap:12px;flex-wrap:wrap}' +
  '.wifi-rot{flex:0 0 56px;font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;color:var(--fumaca)}' +
  '.wifi-val{flex:1 1 140px;min-width:0;font-size:1.25rem;color:var(--creme);overflow-wrap:anywhere;user-select:all}' +
  '.wifi-copiar{flex:none;min-height:40px;padding:8px 16px;border-radius:999px;border:1.5px solid var(--ouro);background:transparent;color:var(--ouro-claro);font-weight:700;font-size:.85rem;font-family:inherit;cursor:pointer}' +
  '.wifi-copiar:hover,.wifi-copiar:focus-visible{background:var(--ouro);color:var(--noite);outline:none}' +
  '.wifi-atalho{display:inline-flex;align-items:center;gap:8px;margin-top:18px;padding:9px 18px;border:1.5px solid var(--ouro);border-radius:999px;color:var(--ouro-claro);font-weight:700;font-size:.92rem;text-decoration:none}' +
  '.wifi-atalho:hover,.wifi-atalho:focus-visible{background:var(--ouro);color:var(--noite);outline:none}';
const ICONE_WIFI = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 8.8a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16.2a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1" fill="currentColor"/></svg>';

// mostra o Wi-Fi no cardápio (seção própria, com atalho no menu), só quando o dono ativou
export function aplicarWifi(html, w) {
  if (!w || !w.ativo || !w.rede || !w.senha) return html;
  const secao = '<section class="secao" id="wifi">\n    <div class="wrap">\n      <h2>Wi-Fi do bar</h2>\n' +
    (w.mensagem ? '      <p class="nota">' + escapar(w.mensagem) + '</p>\n' : '') +
    '      <div class="wifi-card">\n' +
    '        <div class="wifi-linha"><span class="wifi-rot">Rede</span><strong class="wifi-val" id="wifi-rede">' + escapar(w.rede) + '</strong></div>\n' +
    '        <div class="wifi-linha"><span class="wifi-rot">Senha</span><strong class="wifi-val" id="wifi-senha">' + escapar(w.senha) + '</strong><button type="button" class="wifi-copiar" id="wifi-copiar">Copiar senha</button></div>\n' +
    '      </div>\n    </div>\n  </section>\n  <script>\n  (function () {\n' +
    "    var b = document.getElementById('wifi-copiar'), s = document.getElementById('wifi-senha'); if (!b || !s) return;\n" +
    "    function pronto() { b.textContent = 'Copiado!'; setTimeout(function () { b.textContent = 'Copiar senha'; }, 2000); }\n" +
    '    b.addEventListener(\'click\', function () {\n' +
    '      var t = s.textContent;\n' +
    '      if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(t).then(pronto, function () { sel(); }); return; }\n' +
    '      sel();\n' +
    '      function sel() { var r = document.createRange(); r.selectNodeContents(s); var g = getSelection(); g.removeAllRanges(); g.addRange(r); try { if (document.execCommand(\'copy\')) pronto(); } catch (e) {} }\n' +
    '    });\n  })();\n  </script>\n\n  ';
  let out = html.replace('</head>', () => '<style id="wifi-css">' + CSS_WIFI + '</style>\n</head>');
  const marca = '<section class="local" id="contato"';
  out = out.includes(marca) ? out.replace(marca, () => secao + marca) : out.replace('</main>', () => secao + '</main>');
  out = out.replace(/(<li><a href="#eventos">[^<]*<\/a><\/li>)/, (m) => m + '\n      <li><a href="#wifi">Wi-Fi</a></li>');
  // atalho no topo: a seção fica lá embaixo, e o cliente não deve precisar procurar
  out = out.replace(/(<p class="horario">[\s\S]*?<\/p>)/, (m) => m + '\n    <a class="wifi-atalho" href="#wifi">' + ICONE_WIFI + 'Senha do Wi-Fi</a>');
  return out;
}

// ---------- a página inteira, como o cliente vê ----------
export function renderizar(ajustes = carregarAjustes()) {
  let html = inserirNovos(lerPagina(), ajustes._novos || []);
  html = aplicarTextos(html, ajustes._textos);
  html = aplicarAjustes(html, ajustes);
  html = aplicarEventos(html, ajustes._eventos);
  html = aplicarWifi(html, ajustes._wifi);
  html = ocultarSecoes(html, ajustes._secoes);
  html = aplicarImagens(html, ajustes._imagens);
  return injetarTema(html, ajustes);
}
