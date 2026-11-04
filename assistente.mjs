// Assistente do painel: entende comandos em português (digitados ou falados) e devolve um PLANO de alterações.
// Nada aqui grava no cardápio: interpretar() só propõe; aplicar() só roda depois que o dono confirma.
// Sem IA externa nem internet: regras determinísticas, então o mesmo comando dá sempre o mesmo plano.

export const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/r\$/g, ' rs ').replace(/[^a-z0-9,.%\s]/g, ' ').replace(/\s+/g, ' ').trim();

export const texto = (v, max) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');

// "24,90" no formato do cardápio, ou null se o valor não servir
export function formatarPreco(v) {
  let s = String(v ?? '').replace(/[^\d,.]/g, '');
  if (!/\d/.test(s)) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0 || n > 100000) return null;
  return n.toFixed(2).replace('.', ',');
}
const centavos = (preco) => Math.round(Number(preco.replace(/\./g, '').replace(',', '.')) * 100);
const emReais = (c) => (c / 100).toFixed(2).replace('.', ',');

// ---------- números por extenso (a voz às vezes devolve "vinte e cinco" em vez de 25) ----------
const EXT = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13, catorze: 14, quatorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90, cem: 100, cento: 100, duzentos: 200, trezentos: 300, quatrocentos: 400, quinhentos: 500, seiscentos: 600, setecentos: 700, oitocentos: 800, novecentos: 900 };
function porExtenso(t) {
  const p = t.split(' '), saida = [];
  const comeca = (j) => p[j] in EXT && (!['um', 'uma'].includes(p[j]) || /^(real|reais|centavo|centavos|%)$/.test(p[j + 1] || ''));
  for (let i = 0; i < p.length;) {
    if (!comeca(i)) { saida.push(p[i++]); continue; }
    let soma = EXT[p[i]], ultimo = soma, j = i + 1;
    while (p[j] === 'e' && p[j + 1] in EXT && ultimo >= 20 && EXT[p[j + 1]] < ultimo) { ultimo = EXT[p[j + 1]]; soma += ultimo; j += 2; }
    saida.push(String(soma)); i = j;
  }
  return saida.join(' ');
}
function preparar(bruto) {
  let t = norm(bruto).replace(/\bpor cento\b/g, ' % ');
  t = porExtenso(t.replace(/\s+/g, ' '));
  t = t.replace(/(\d+) reais? e (\d+) centavos?/g, (_, a, b) => `${a},${b.padStart(2, '0')}`);
  return t.replace(/\s+/g, ' ').trim();
}

// ---------- vocabulário ----------
const palavras = (s) => new Set(s.split(' '));
const VERBOS = palavras('muda mude mudar altera altere alterar troca troque trocar coloca coloque colocar poe ponha ajusta ajuste ajustar define defina definir passa passe passar deixa deixe deixar atualiza atualize atualizar aumenta aumente aumentar sobe suba subir acrescenta acrescente acrescentar reduz reduza reduzir diminui diminua diminuir baixa baixe baixar desconta desconte descontar abate abata esconde esconda esconder oculta oculte ocultar tira tire tirar remove remova remover retira retire retirar some suma sumir acabou acabaram esgotou esgotaram esgotado esgotada desativa desative desativar mostra mostre mostrar exibe exiba exibir volta volte voltar reativa reative reativar recoloca recoloque restaura restaure restaurar renomeia renomeie renomear chama chame custa custam vale valem quanto qual quais desfaz desfaca desfazer fica ficar fique sai saia vai');
const PARADAS = palavras('a o as os de do da dos das no na nos nas num numa um uma uns umas para pra pro por em ao aos que e ou com se favor pfv cardapio preco precos valor valores item itens produto produtos prato agora la ai aqui jarvis assistente voce vc meu minha meus minhas seu sua tambem so apenas ja nome novo nova mesmo mesma ser seja esta estao esse essa isso isto rs reais real centavo centavos cento % todo toda todos todas tudo ate cada');
const SECOES = [
  [/\bcaldos\b/, 'caldos'], [/\bpetiscos\b/, 'petiscos'], [/\b(hamburgueres|lanches)\b/, 'hamburguer'],
  [/\bcervejas\b/, 'cervejas'], [/\bdrinks\b/, 'drinks'], [/\bsem alcool\b|\bnao alcoolicas?\b/, 'semalcool'],
];
const TODO_CARDAPIO = /\b(todo o cardapio|cardapio (todo|inteiro)|todos os (itens|precos|produtos)|tudo)\b/;

const lev = (a, b) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};
function casa(q, t) {
  if (q === t) return true;
  if (q.length >= 4 && t.startsWith(q)) return true;
  if (t.length >= 4 && q.startsWith(t)) return true;
  return /[a-z]/.test(q) && /[a-z]/.test(t) && q.length >= 5 && t.length >= 5 && lev(q, t) <= (q.length >= 8 ? 2 : 1);
}
const fichas = (s) => norm(s).split(' ').filter((x) => x && !PARADAS.has(x) && !VERBOS.has(x));

// o que o painel enxerga de cada item: original + ajuste do dono
function visao(i, aj = {}) {
  const nome = aj.nome || i.nome;
  return { id: i.id, secao: i.secao, titulo: i.titulo, nome, preco: aj.preco || i.preco, oculto: !!aj.oculto,
    ajustado: Object.keys(aj).length > 0, fichas: [...new Set([...fichas(nome), ...fichas(i.nome)])] };
}
const rot = (v) => `${v.nome} (${v.titulo})`;
const resposta = (texto) => ({ tipo: 'resposta', texto });

const AJUDA = 'Posso mudar preço, esconder, mostrar, renomear e desfazer. Exemplos:\n• muda a sopa de carne para 20 reais\n• aumenta a Heineken em 2 reais\n• aumenta as cervejas em 10%\n• esconde a ostra / acabou o sururu\n• mostra a ostra\n• renomeia caldo verde para caldo de couve\n• quanto custa o gin?\n• desfaz';

// escolhe o(s) item(ns) citados no comando; devolve { itens } | { escolha } | { erro }
function resolver(t, vis, { permitirTodos = true } = {}) {
  let resto = t, secao = null;
  for (const [re, id] of SECOES) if (re.test(resto)) { secao = id; resto = resto.replace(re, ' '); }
  const todo = TODO_CARDAPIO.test(resto);
  if (todo) resto = resto.replace(TODO_CARDAPIO, ' ');
  const consulta = resto.split(' ').filter((x) => x && !PARADAS.has(x) && !VERBOS.has(x));
  if (!consulta.length) {
    if (secao) return permitirTodos ? { itens: vis.filter((v) => v.secao === secao), lote: true } : { erro: 'Diga o nome de um item. Pra vários de uma vez, use aumento ou desconto, ex.: "aumenta as cervejas em 10%".' };
    if (todo) return permitirTodos ? { itens: vis, lote: true } : { erro: 'Diga o nome de um item. Pra vários de uma vez, use aumento ou desconto, ex.: "aumenta tudo em 5%".' };
    return { erro: 'Não entendi qual item. Diga o nome, como "sopa de carne" ou "heineken".' };
  }
  const base = secao ? vis.filter((v) => v.secao === secao) : vis;
  const pontos = base.map((v) => ({ v, m: consulta.filter((q) => v.fichas.some((x) => casa(q, x))).length }));
  const alfa = (q) => /[a-z]/.test(q);
  const validos = pontos.filter((p) => p.m > 0 && consulta.some((q) => alfa(q) && p.v.fichas.some((x) => casa(q, x))));
  if (!validos.length) return { erro: `Não achei nenhum item parecido com "${consulta.join(' ')}". Confira o nome no painel.` };
  const maxM = Math.max(...validos.map((p) => p.m));
  const topo = validos.filter((p) => p.m === maxM).map((p) => ({ ...p, cob: p.m / Math.max(p.v.fichas.length, 1) }));
  const maxC = Math.max(...topo.map((p) => p.cob));
  const grupo = topo.filter((p) => p.cob === maxC).map((p) => p.v);
  return grupo.length === 1 ? { itens: grupo } : { escolha: grupo };
}

// transforma o alvo resolvido em plano; gerar(v) devolve { acao } ou { pula: 'motivo' }
function plano(r, gerar, { permitirTodos = true } = {}) {
  if (r.erro) return resposta(r.erro);
  if (r.itens) {
    const acoes = [], pulados = [];
    for (const v of r.itens) { const g = gerar(v); if (g.acao) acoes.push(g.acao); else pulados.push(`${rot(v)}: ${g.pula}`); }
    if (!acoes.length) return resposta(r.itens.length === 1 ? `Nada a mudar. ${pulados[0]}.` : `Nada a mudar: todos os ${r.itens.length} itens já estão assim.`);
    return { tipo: 'acoes', acoes, avisos: r.lote && pulados.length ? [`${pulados.length} item(ns) já estavam assim e ficam de fora.`] : [] };
  }
  if (r.escolha.length > 8) return resposta(`Achei ${r.escolha.length} itens com esse nome. Seja mais específico, por exemplo dizendo a categoria.`);
  const opcoes = r.escolha.map((v) => ({ v, g: gerar(v) })).filter((x) => x.g.acao).map((x) => ({ rotulo: `${rot(x.v)} · R$ ${x.v.preco}${x.v.oculto ? ' · escondido' : ''}`, acoes: [x.g.acao] }));
  if (!opcoes.length) return resposta('Nada a mudar: os itens parecidos já estão assim.');
  if (permitirTodos && opcoes.length > 1) opcoes.push({ rotulo: `Todos os ${opcoes.length}`, acoes: opcoes.map((o) => o.acoes[0]) });
  return { tipo: 'escolha', pergunta: 'Achei mais de um item parecido. Qual deles?', opcoes };
}

export function interpretar(bruto, itens, ajustes = {}, podeDesfazer = false) {
  const original = String(bruto || '').trim().slice(0, 300);
  if (!original) return resposta('Diga ou escreva o que quer mudar. Ex.: "muda a sopa de carne para 20 reais".');
  const t = preparar(original);
  const w = new Set(t.split(' '));
  const tem = (...p) => p.some((x) => w.has(x));
  const vis = itens.map((i) => visao(i, ajustes[i.id]));

  if (/\b(ajuda|ajudar|comandos|exemplos)\b|o que (voce )?(faz|pode)/.test(t)) return resposta(AJUDA);

  if (tem('desfaz', 'desfaca', 'desfazer', 'anula', 'anular') || /\bvolta(r)? atras\b/.test(t)) {
    return podeDesfazer ? { tipo: 'acoes', acoes: [{ tipo: 'desfazer', rotulo: 'Desfazer a última alteração feita no painel' }], avisos: [] }
      : resposta('Não tenho nada pra desfazer nesta sessão.');
  }

  // dinheiro / porcentagem citados no comando
  const NUM = '(\\d+(?:[.,]\\d+)?)';
  const mPct = t.match(new RegExp(NUM + ' ?%'));
  const mRs = t.match(new RegExp(NUM + ' ?(?:reais|real|rs)\\b|\\brs ?' + NUM));
  const todosNums = [...t.matchAll(new RegExp('(?:\\brs ?)?' + NUM + '(?: ?(?:reais|real|%))?', 'g'))];
  const semValor = (re) => t.replace(re, ' ');

  // consulta: não muda nada
  if (/\bquanto (custa|esta|e|ta|sai|vale)\b|\bqual (e )?o (preco|valor)\b/.test(t)) {
    const r = resolver(t, vis, { permitirTodos: false });
    if (r.erro) return resposta(r.erro);
    const lista = r.itens || r.escolha;
    return resposta(lista.slice(0, 8).map((v) => `${rot(v)}: R$ ${v.preco}${v.oculto ? ' (escondido)' : ''}`).join('\n'));
  }

  // renomear
  if (/\b(renomei\w*|renomear)\b|\b(muda\w*|alter\w*|troc\w*) o nome\b/.test(t)) {
    const m = original.match(/(?:renomei\w*|renomear|(?:muda\w*|alter\w*|troc\w*)\s+o\s+nome)\s+(?:d[aeo]s?\s+|o\s+|a\s+)?(.+?)\s+(?:para|pra|por)\s+(.+)$/i);
    if (!m) return resposta('Diga assim: "renomeia caldo verde para caldo de couve".');
    const novo = texto(m[2].replace(/^["“']+|["”'.!?]+$/g, ''), 80);
    if (!novo) return resposta('Qual é o novo nome?');
    const nome = novo.charAt(0).toUpperCase() + novo.slice(1);
    const r = resolver(preparar(m[1]), vis, { permitirTodos: false });
    return plano(r, (v) => (v.nome === nome ? { pula: 'já tem esse nome' } : { acao: { tipo: 'renomear', id: v.id, para: nome, rotulo: `${v.nome} → ${nome} (${v.titulo})` } }), { permitirTodos: false });
  }

  // voltar ao original
  if (/\b(restaur\w*|original|padrao)\b/.test(t)) {
    const r = resolver(t.replace(/\b(restaur\w*|original|padrao)\b/g, ' '), vis);
    return plano(r, (v) => (v.ajustado ? { acao: { tipo: 'restaurar', id: v.id, rotulo: `Voltar ao original: ${rot(v)}` } } : { pula: 'já está no original' }));
  }

  // aumentar / reduzir (por % ou em reais)
  const sobe = tem('aumenta', 'aumente', 'aumentar', 'sobe', 'suba', 'subir', 'acrescenta', 'acrescente', 'acrescentar');
  const desce = tem('reduz', 'reduza', 'reduzir', 'diminui', 'diminua', 'diminuir', 'baixa', 'baixe', 'baixar', 'desconta', 'desconte', 'descontar', 'abate', 'abata')
    || (tem('tira', 'tire', 'tirar', 'retira', 'retire', 'retirar', 'remove', 'remova', 'remover') && (mPct || mRs));
  if (sobe || desce) {
    if (!todosNums.length) return resposta('Quanto? Ex.: "aumenta a heineken em 2 reais" ou "reduz os drinks em 10%".');
    const pct = mPct ? Number(mPct[1].replace(',', '.')) : null;
    const rs = pct === null ? Number((mRs ? (mRs[1] || mRs[2]) : todosNums[todosNums.length - 1][1]).replace(',', '.')) : null;
    if (!(pct ?? rs) || (pct ?? rs) <= 0) return resposta('O valor do ajuste precisa ser maior que zero.');
    const resto = pct !== null ? t.replace(new RegExp(NUM + ' ?%'), ' ') : t.replace(mRs ? mRs[0] : todosNums[todosNums.length - 1][0], ' ');
    const r = resolver(resto, vis);
    const sinal = sobe ? 1 : -1;
    const p = plano(r, (v) => {
      const c0 = centavos(v.preco);
      const c1 = pct !== null ? Math.round(c0 * (1 + (sinal * pct) / 100)) : c0 + sinal * Math.round(rs * 100);
      if (c1 <= 0) return { pula: 'o preço ficaria zerado ou negativo' };
      if (c1 === c0) return { pula: 'o preço não muda' };
      return { acao: { tipo: 'preco', id: v.id, para: emReais(c1), rotulo: `${rot(v)}: R$ ${v.preco} → R$ ${emReais(c1)}` } };
    });
    if (p.tipo === 'acoes' && pct !== null && pct > 30) p.avisos.push(`Ajuste de ${String(pct).replace('.', ',')}% é grande. Confira antes de confirmar.`);
    return p;
  }

  // esconder / mostrar
  if (tem('esconde', 'esconda', 'esconder', 'oculta', 'oculte', 'ocultar', 'tira', 'tire', 'tirar', 'retira', 'retire', 'retirar', 'remove', 'remova', 'remover', 'some', 'suma', 'sumir', 'acabou', 'acabaram', 'esgotou', 'esgotaram', 'esgotado', 'esgotada', 'desativa', 'desative', 'desativar')) {
    return plano(resolver(t, vis), (v) => (v.oculto ? { pula: 'já está escondido' } : { acao: { tipo: 'ocultar', id: v.id, rotulo: `Esconder ${rot(v)}` } }));
  }
  if (tem('mostra', 'mostre', 'mostrar', 'exibe', 'exiba', 'exibir', 'reativa', 'reative', 'reativar', 'recoloca', 'recoloque', 'volta', 'volte', 'voltar') || /\bde volta\b/.test(t)) {
    return plano(resolver(t.replace(/\bde volta\b/g, ' '), vis), (v) => (!v.oculto ? { pula: 'já está aparecendo' } : { acao: { tipo: 'mostrar', id: v.id, rotulo: `Mostrar ${rot(v)}` } }));
  }

  // definir preço: o último número do comando é o novo preço
  if (todosNums.length) {
    const ult = todosNums[todosNums.length - 1];
    const novo = formatarPreco(ult[1]);
    if (!novo) return resposta('Esse preço não parece válido. Use algo como 24,90.');
    const r = resolver(t.slice(0, ult.index) + ' ' + t.slice(ult.index + ult[0].length), vis, { permitirTodos: false });
    if (r.itens && r.lote) return resposta('Pra vários itens de uma vez, use aumento ou desconto. Ex.: "aumenta as cervejas em 10%".');
    return plano(r, (v) => (v.preco === novo ? { pula: `já custa R$ ${novo}` } : { acao: { tipo: 'preco', id: v.id, para: novo, rotulo: `${rot(v)}: R$ ${v.preco} → R$ ${novo}` } }), { permitirTodos: false });
  }

  return resposta('Não entendi o comando. ' + AJUDA);
}

// ---------- aplicação (só depois da confirmação do dono; revalida tudo no servidor) ----------
const TIPOS = new Set(['preco', 'ocultar', 'mostrar', 'restaurar', 'renomear']);
export function aplicar(acoes, itens, ajustes) {
  const novo = JSON.parse(JSON.stringify(ajustes));
  const porId = new Map(itens.map((i) => [i.id, i]));
  let feitas = 0; const erros = [];
  for (const a of Array.isArray(acoes) ? acoes.slice(0, 200) : []) {
    const it = a && TIPOS.has(a.tipo) && typeof a.id === 'string' ? porId.get(a.id) : null;
    if (!it) { erros.push('Item não encontrado.'); continue; }
    const cur = { ...(novo[a.id] || {}) };
    if (a.tipo === 'preco') {
      const p = formatarPreco(a.para);
      if (!p) { erros.push(`${it.nome}: preço inválido.`); continue; }
      if (p === it.preco) delete cur.preco; else cur.preco = p;
    } else if (a.tipo === 'renomear') {
      const n = texto(a.para, 80);
      if (!n) { erros.push(`${it.nome}: nome vazio.`); continue; }
      if (n === it.nome) delete cur.nome; else cur.nome = n;
    } else if (a.tipo === 'ocultar') cur.oculto = true;
    else if (a.tipo === 'mostrar') delete cur.oculto;
    else for (const k of Object.keys(cur)) delete cur[k];
    if (Object.keys(cur).length) novo[a.id] = cur; else delete novo[a.id];
    feitas++;
  }
  return { ajustes: novo, feitas, erros };
}
