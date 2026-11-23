#!/usr/bin/env node
// Métricas do lote do orquestrador. Sem dependências.
//
//   node metricas.mjs gravar --frentes=N --sessoes=X --reaproveitadas=Y --subagentes=W --prs=P
//        --pico=M [--bastao=ENTREGA:INICIO:PASSOS ...]
//     A sessão principal roda pelo Bash a cada atualização do estado. Grava
//     <config>/orquestrador/sessoes/<CLAUDE_CODE_SESSION_ID>.json e imprime a linha de métricas
//     que vai no fim do quadro. Valores em mil tokens (k).
//   node metricas.mjs faixa --session=<id>
//     Usado pela faixa acima do prompt (hooks/faixa.tsx): imprime {"text","detail"} da sessão,
//     ou nada quando ela não é uma principal com lote ativo.
//   node metricas.mjs fim
//     Apaga o arquivo da sessão (fim do lote): a faixa some.
//
// Economia estimada (em k):
//   piso evitado  = (reaproveitadas + subagentes) × 85
//   bastão        = Σ max(0, entrega − inicio) × passos   (contexto que deixou de ser relido por passo)
// É estimativa, não medição.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PISO = 85;
const VALIDADE_MS = 7 * 24 * 3600 * 1000;
const here = fileURLToPath(import.meta.url);
const lang = /[\\/]orchestrator[\\/]/.test(here) ? 'en' : 'pt';

const TXT = {
  pt: {
    line: (m) => `métricas · frentes ${m.frentes} (sessões ${m.sessoes} · reaproveitadas ${m.reaproveitadas} · subagentes ${m.subagentes} · bastões ${m.bastoes.length}) · PRs mesclados ${m.prs} · contexto máx. da principal ~${m.pico}k · economia estimada ~${fmt(m.economia.total)}k`,
    band: (m) => `🎼 orquestrador · frentes ${m.frentes} · sessões ${m.sessoes} · bastões ${m.bastoes.length} · PRs ${m.prs} · contexto máx. ~${m.pico}k · economia estimada ~${fmt(m.economia.total)}k`,
    detail: (m) => `   piso evitado ~${fmt(m.economia.piso)}k (${m.reaproveitadas} reaproveitadas + ${m.subagentes} subagentes) · bastão ~${fmt(m.economia.bastao)}k (${m.bastoes.length} ${m.bastoes.length === 1 ? 'passagem' : 'passagens'})`,
    noSession: 'CLAUDE_CODE_SESSION_ID ausente: rode pelo Bash da sessão principal.',
    bad: (k, v) => `valor inválido em --${k}: ${v}`,
    badBaton: (v) => `--bastao espera ENTREGA:INICIO:PASSOS (números), veio: ${v}`,
    usage: 'uso: metricas.mjs gravar|faixa|fim [opções]',
  },
  en: {
    line: (m) => `metrics · fronts ${m.frentes} (sessions ${m.sessoes} · reused ${m.reaproveitadas} · subagents ${m.subagentes} · batons ${m.bastoes.length}) · PRs merged ${m.prs} · main peak ~${m.pico}k · estimated savings ~${fmt(m.economia.total)}k`,
    band: (m) => `🎼 orchestrator · fronts ${m.frentes} · sessions ${m.sessoes} · batons ${m.bastoes.length} · PRs ${m.prs} · peak ~${m.pico}k · estimated savings ~${fmt(m.economia.total)}k`,
    detail: (m) => `   floor avoided ~${fmt(m.economia.piso)}k (${m.reaproveitadas} reused + ${m.subagentes} subagents) · baton ~${fmt(m.economia.bastao)}k (${m.bastoes.length} ${m.bastoes.length === 1 ? 'handoff' : 'handoffs'})`,
    noSession: 'CLAUDE_CODE_SESSION_ID missing: run it from the main session\'s Bash.',
    bad: (k, v) => `invalid value for --${k}: ${v}`,
    badBaton: (v) => `--bastao expects HANDOFF:START:STEPS (numbers), got: ${v}`,
    usage: 'usage: metricas.mjs gravar|faixa|fim [options]',
  },
}[lang];

function fmt(n) {
  return n.toLocaleString(lang === 'pt' ? 'pt-BR' : 'en-US');
}

function dir() {
  const base = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(base, 'orquestrador', 'sessoes');
}

function arquivo(id) {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id || '')) return null;
  return path.join(dir(), `${id}.json`);
}

function args(argv) {
  const out = { bastao: [] };
  for (const a of argv) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
    if (!m) continue;
    if (m[1] === 'bastao') out.bastao.push(m[2] ?? '');
    else out[m[1]] = m[2] ?? '';
  }
  return out;
}

function inteiro(o, k) {
  const v = o[k] ?? '0';
  if (!/^\d{1,7}$/.test(String(v))) throw new Error(TXT.bad(k, v));
  return Number(v);
}

export function calcular(o) {
  const m = {
    frentes: inteiro(o, 'frentes'),
    sessoes: inteiro(o, 'sessoes'),
    reaproveitadas: inteiro(o, 'reaproveitadas'),
    subagentes: inteiro(o, 'subagentes'),
    prs: inteiro(o, 'prs'),
    pico: inteiro(o, 'pico'),
    bastoes: o.bastao.map((b) => {
      const p = /^(\d{1,4}):(\d{1,4}):(\d{1,4})$/.exec(b);
      if (!p) throw new Error(TXT.badBaton(b));
      return { entrega: Number(p[1]), inicio: Number(p[2]), passos: Number(p[3]) };
    }),
  };
  const piso = (m.reaproveitadas + m.subagentes) * PISO;
  const bastao = m.bastoes.reduce((s, b) => s + Math.max(0, b.entrega - b.inicio) * b.passos, 0);
  m.economia = { piso, bastao, total: piso + bastao };
  return m;
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const o = args(rest);
  if (cmd === 'gravar') {
    const id = process.env.CLAUDE_CODE_SESSION_ID;
    const f = arquivo(id);
    if (!f) throw new Error(TXT.noSession);
    const m = calcular(o);
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(f, JSON.stringify({ v: 1, lang, at: Date.now(), ...m }, null, 2));
    console.log(TXT.line(m));
    return;
  }
  if (cmd === 'faixa') {
    const f = arquivo(o.session);
    if (!f || !fs.existsSync(f)) return;
    const m = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!(Date.now() - m.at < VALIDADE_MS)) return;
    process.stdout.write(JSON.stringify({ text: TXT.band(m), detail: TXT.detail(m) }));
    return;
  }
  if (cmd === 'fim') {
    const f = arquivo(process.env.CLAUDE_CODE_SESSION_ID);
    if (f && fs.existsSync(f)) fs.unlinkSync(f);
    return;
  }
  throw new Error(TXT.usage);
}

if (process.argv[1] && path.resolve(process.argv[1]) === here) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
