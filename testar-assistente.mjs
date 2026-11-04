// Testes do assistente do painel. Uso: node testar-assistente.mjs
import { listarItens } from './cardapio.mjs';
import { interpretar, aplicar } from './assistente.mjs';

const itens = listarItens();
let falhas = 0, total = 0;
const resumo = (p) => p.tipo === 'acoes' ? p.acoes.map((a) => `${a.tipo}:${a.id}${a.para ? '=' + a.para : ''}`).join(' | ')
  : p.tipo === 'escolha' ? 'ESCOLHA(' + p.opcoes.length + ')' : 'RESP';
function t(frase, esperado, { aj = {}, desfazer = false } = {}) {
  total++;
  const p = interpretar(frase, itens, aj, desfazer);
  const r = resumo(p);
  const ok = typeof esperado === 'function' ? esperado(p, r) : r === esperado;
  if (!ok) { falhas++; console.log(`✗ "${frase}"\n   obteve: ${r}${p.texto ? ' → ' + p.texto.slice(0, 90) : ''}`); }
}
const resp = (re) => (p) => p.tipo === 'resposta' && re.test(p.texto);

// preço
t('muda a sopa de carne para 20 reais', 'preco:caldos:sopa-de-carne-500-ml=20,00');
t('Muda o preço da sopa de carne para 20,50', 'preco:caldos:sopa-de-carne-500-ml=20,50');
t('coloca o sururu por R$ 19,90', 'preco:caldos:sururu=19,90');
t('altera o preço do caldo verde pra 15', 'preco:caldos:caldo-verde=15,00');
t('muda a mariscada para vinte e cinco reais', 'preco:caldos:mariscada=25,00');
t('muda o gin para vinte e cinco reais e cinquenta centavos', 'preco:drinks:gin-360-graus=25,50');
t('a ostra agora custa 22', 'preco:caldos:ostra=22,00');
t('muda a sopa de carne de 18,90 para 21', 'preco:caldos:sopa-de-carne-500-ml=21,00');
t('muda o preço da hambúrguer 360 para 36,90', 'preco:hamburguer:hamburguer-360=36,90');
t('muda a brahma zero para 8', 'preco:cervejas:brahma-zero=8,00');
t('muda o preço da heineken zero para 13', 'preco:cervejas:heineken-zero-350-ml=13,00');
t('muda a sopa de carne para 18,90', resp(/Nada a mudar/));
// ambiguidade e escopo
t('muda o camarão para 20', (p) => p.tipo === 'escolha' && p.opcoes.length === 2);
t('muda o camarão dos petiscos para 20', 'preco:petiscos:camarao=20,00');
t('esconde o camarão nos caldos', 'ocultar:caldos:camarao');
t('muda a vodka absolut para 20', (p) => p.tipo === 'escolha' && p.opcoes.length === 2);
t('muda o caldo para 20', (p) => p.tipo === 'escolha');
// aumentar / reduzir
t('aumenta a heineken em 2 reais', 'preco:cervejas:heineken=20,90');
t('aumenta o amstel em 10%', 'preco:cervejas:amstel=14,19');
t('reduz a devassa em 1 real', 'preco:cervejas:devassa=10,90');
t('tira 2 reais da brahma', 'preco:cervejas:brahma=10,90');
t('aumenta a heineken em dez por cento', 'preco:cervejas:heineken=20,79');
t('aumenta as cervejas em 10%', (p) => p.tipo === 'acoes' && p.acoes.length === 14 && p.acoes.every((a) => a.tipo === 'preco'));
t('desconta 5% de todos os drinks', (p) => p.tipo === 'acoes' && p.acoes.length === 20);
t('aumenta tudo em 5%', (p) => p.tipo === 'acoes' && p.acoes.length === 95);
t('aumenta os petiscos em 50%', (p) => p.tipo === 'acoes' && p.avisos.some((a) => /grande/.test(a)));
t('aumenta a heineken', resp(/Quanto/));
// esconder / mostrar
t('esconde a ostra', 'ocultar:caldos:ostra');
t('acabou o sururu', 'ocultar:caldos:sururu');
t('tira o gin do cardápio', 'ocultar:drinks:gin-360-graus');
t('esconde os drinks', (p) => p.tipo === 'acoes' && p.acoes.length === 20);
t('mostra a ostra', resp(/já está aparecendo/));
t('mostra a ostra', 'mostrar:caldos:ostra', { aj: { 'caldos:ostra': { oculto: true } } });
t('coloca a ostra de volta no cardápio', 'mostrar:caldos:ostra', { aj: { 'caldos:ostra': { oculto: true } } });
t('esconde a ostra', resp(/já está escondido/), { aj: { 'caldos:ostra': { oculto: true } } });
// renomear
t('renomeia caldo verde para caldo de couve', 'renomear:caldos:caldo-verde=Caldo de couve');
t('muda o nome da sopa de carne para Sopa de boi', 'renomear:caldos:sopa-de-carne-500-ml=Sopa de boi');
t('renomeia heineken para Heineken Long Neck', 'renomear:cervejas:heineken=Heineken Long Neck');
// restaurar / consulta / desfazer / ajuda / erros
t('restaura o sururu', 'restaurar:caldos:sururu', { aj: { 'caldos:sururu': { preco: '19,90' } } });
t('volta o sururu ao original', resp(/já está no original/));
t('restaura tudo', (p) => p.tipo === 'acoes' && p.acoes.length === 1, { aj: { 'caldos:sururu': { preco: '19,90' } } });
t('quanto custa a heineken?', resp(/Heineken \(Cervejas\): R\$ 18,90/));
t('qual o preço do gin', resp(/R\$ 23,90/));
t('desfaz', resp(/nada pra desfazer/));
t('desfaz a última alteração', (p) => p.tipo === 'acoes' && p.acoes[0].tipo === 'desfazer', { desfazer: true });
t('ajuda', resp(/Exemplos/));
t('esconde o xablau', resp(/Não achei/));
t('muda a ostra', resp(/Não entendi/));
t('muda as cervejas para 10', resp(/vários de uma vez/));
t('blablabla', resp(/Não entendi/));
t('', resp(/Diga ou escreva/));
// voz: erro de transcrição leve
t('muda a haineken para 19', 'preco:cervejas:heineken=19,00');
t('esconde o caranguejo', 'ocultar:petiscos:caranguejo');

// aplicar: revalida e não aceita lixo
const base = {};
let r = aplicar([{ tipo: 'preco', id: 'caldos:sururu', para: '19,5' }, { tipo: 'ocultar', id: 'caldos:ostra' }, { tipo: 'renomear', id: 'caldos:caldo-verde', para: 'Caldo de couve' }], itens, base);
total++; if (r.feitas !== 3 || r.ajustes['caldos:sururu'].preco !== '19,50' || !r.ajustes['caldos:ostra'].oculto || r.ajustes['caldos:caldo-verde'].nome !== 'Caldo de couve') { falhas++; console.log('✗ aplicar básico', JSON.stringify(r)); }
r = aplicar([{ tipo: 'mostrar', id: 'caldos:ostra' }, { tipo: 'restaurar', id: 'caldos:sururu' }], itens, r.ajustes);
total++; if (r.feitas !== 2 || r.ajustes['caldos:ostra'] || r.ajustes['caldos:sururu']) { falhas++; console.log('✗ aplicar desfazer/restaurar', JSON.stringify(r)); }
r = aplicar([{ tipo: 'preco', id: 'caldos:sururu', para: 'abc' }, { tipo: 'preco', id: 'nao:existe', para: '10' }, { tipo: 'apagar', id: 'caldos:sururu' }, { tipo: 'preco', id: 'caldos:sururu', para: '17,90' }], itens, {});
total++; if (r.feitas !== 1 || r.erros.length !== 3 || Object.keys(r.ajustes).length !== 0) { falhas++; console.log('✗ aplicar inválidos', JSON.stringify(r)); }

console.log(falhas ? `\n${falhas} falha(s) em ${total}` : `${total}/${total} ok`);
process.exit(falhas ? 1 : 0);
