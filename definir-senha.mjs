// Define (ou troca) a senha do dono do painel.
// Uso: node definir-senha.mjs "minha senha nova"     (sem argumento, gera uma senha aleatória e mostra uma vez)
import { randomBytes } from 'node:crypto';
import { gravarSenha } from './servidor.mjs';

let senha = process.argv[2];
let gerada = false;
if (!senha) { senha = randomBytes(9).toString('base64url'); gerada = true; }
if (senha.length < 8) { console.error('A senha precisa ter pelo menos 8 caracteres.'); process.exit(1); }
gravarSenha(senha);
console.log(gerada ? `Senha do dono definida: ${senha}\nGuarde agora: ela não fica salva em texto em lugar nenhum.` : 'Senha do dono atualizada.');
