// Comprobación de privacidad (el repositorio es público). Sin dependencias ni red.
//
//   node scripts/privacidad.mjs --mensaje <archivo>   un mensaje de commit (lo usa el hook commit-msg)
//   node scripts/privacidad.mjs --desde <rama>        mensajes y líneas añadidas de <rama>..HEAD (lo usa pruebas.yml)
//   node scripts/privacidad.mjs --staged              lo que está preparado para el commit
//
// Falla (salida 1) si encuentra un enlace de sesión, un correo que no sea @users.noreply.github.com
// o algo con forma de clave. No mira el historial anterior: solo lo nuevo.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const EN_MENSAJE = [
  [/claude\.ai\/(code|chat|share)\b/i, 'enlace a una conversación de Claude'],
  [/^\s*Claude-Session:/im, 'línea Claude-Session'],
  [/\bsession_[0-9A-Za-z]{10,}/, 'identificador de sesión'],
];
const EN_TODO = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'clave privada'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, 'token de GitHub'],
  [/\bgithub_pat_[A-Za-z0-9_]{30,}/, 'token de GitHub'],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/, 'clave de Anthropic'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'clave de AWS'],
  [/ntfy\.sh\/(?!<)[A-Za-z0-9_-]{12,}/, 'canal de ntfy'],
];
const CORREO = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const CORREO_OK = /@users\.noreply\.github\.com$|^noreply@anthropic\.com$|^git@github\.com$/i;

const revisa = (texto, reglas, donde, fallos) => {
  for (const [re, que] of reglas) if (re.test(texto)) fallos.push(`${donde}: ${que}`);
  for (const c of texto.match(CORREO) || []) if (!CORREO_OK.test(c)) fallos.push(`${donde}: correo (${c})`);
};

const [modo, valor] = process.argv.slice(2);
const fallos = [];

if (modo === '--mensaje') {
  revisa(readFileSync(valor, 'utf8'), [...EN_MENSAJE, ...EN_TODO], 'mensaje del commit', fallos);
} else if (modo === '--staged' || modo === '--desde') {
  const rango = modo === '--desde' ? [`${valor}..HEAD`] : [];
  if (modo === '--desde') {
    for (const c of git('log', '--format=%H', ...rango).split('\n').filter(Boolean)) {
      revisa(git('log', '-1', '--format=%B', c), [...EN_MENSAJE, ...EN_TODO], `mensaje de ${c.slice(0, 7)}`, fallos);
      const autor = git('log', '-1', '--format=%ae %ce', c).trim().split(' ');
      for (const a of autor) if (!CORREO_OK.test(a)) fallos.push(`autor de ${c.slice(0, 7)}: correo (${a})`);
    }
  }
  const diff = modo === '--desde'
    ? git('diff', '-U0', `${valor}...HEAD`, '--', '.', ':!scripts/privacidad.mjs')
    : git('diff', '--cached', '-U0', '--', '.', ':!scripts/privacidad.mjs');
  let archivo = '';
  for (const l of diff.split('\n')) {
    if (l.startsWith('+++ ')) archivo = l.slice(6);
    else if (l.startsWith('+') && !/^\+\+\+/.test(l)) revisa(l.slice(1), EN_TODO, `línea nueva en ${archivo}`, fallos);
  }
} else {
  console.error('Uso: privacidad.mjs --mensaje <archivo> | --desde <rama> | --staged');
  process.exit(2);
}

if (fallos.length) {
  console.error('✗ Privacidad (el repositorio es público):');
  for (const f of [...new Set(fallos)].slice(0, 20)) console.error('  - ' + f);
  process.exit(1);
}
console.log('· privacidad bien');
