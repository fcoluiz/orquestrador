#!/usr/bin/env node
// Métricas do lote do orquestrador. Sem dependências.
//
//   node metricas.mjs gravar --frentes=N --sessoes=X --reaproveitadas=Y --subagentes=W --prs=P
//        --pico=M [--bastao=ENTREGA:INICIO:PASSOS ...] [--estado=<caminho>] [--skill=<caminho>]
//        [--compactar-em=200]
//     A sessão principal roda pelo Bash a cada atualização do estado. Grava
//     <config>/orquestrador/sessoes/<CLAUDE_CODE_SESSION_ID>.json e imprime a linha de métricas
//     que vai no fim do quadro. Valores em mil tokens (k). `--estado`, `--skill` e
//     `--compactar-em` ficam gravados: basta passar uma vez, no início do lote.
//   node metricas.mjs decisao --frente=<nome> --pergunta=<texto> [--opcoes="sim|não"]
//        [--contexto=<até 3 linhas>] [--relatorio=<caminho>] [--id=D3]
//     Põe na fila uma decisão que um retorno de filha pede ao dono e imprime o id (D1, D2...).
//     O mesmo id substitui a decisão.
//   node metricas.mjs decidiu --id=D3
//     Tira a decisão da fila, depois que o dono respondeu.
//   node metricas.mjs decisoes
//     Lista a fila (vai no topo da resposta da principal).
//   node metricas.mjs faixa --session=<id>
//     Usado pela faixa acima do prompt (hooks/faixa.tsx): imprime o JSON da faixa e da
//     compactação automática, ou nada quando a sessão não é uma principal com lote ativo.
//   node metricas.mjs compactou --session=<id>
//     A faixa registra que compactou a principal.
//   node metricas.mjs instrucoes
//     Imprime o texto para `/compact` (sem o plugin, a principal o entrega ao dono).
//   node metricas.mjs fim
//     Apaga o arquivo da sessão (fim do lote): a faixa e a compactação automática param.
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
const COMPACTAR_EM = 200;
const VALIDADE_MS = 7 * 24 * 3600 * 1000;
const here = fileURLToPath(import.meta.url);
const lang = /[\\/]orchestrator[\\/]/.test(here) ? 'en' : 'pt';

const TXT = {
  pt: {
    line: (m) => `métricas · frentes ${m.frentes} (sessões ${m.sessoes} · reaproveitadas ${m.reaproveitadas} · subagentes ${m.subagentes} · bastões ${m.bastoes.length}) · PRs mesclados ${m.prs} · contexto máx. da principal ~${m.pico}k · economia estimada ~${fmt(m.economia.total)}k`,
    band: (m) => `🎼 orquestrador · frentes ${m.frentes} · sessões ${m.sessoes} · bastões ${m.bastoes.length} · PRs ${m.prs} · contexto máx. ~${m.pico}k · economia estimada ~${fmt(m.economia.total)}k`,
    detail: (m) => `   piso evitado ~${fmt(m.economia.piso)}k (${m.reaproveitadas} reaproveitadas + ${m.subagentes} subagentes) · bastão ~${fmt(m.economia.bastao)}k (${m.bastoes.length} ${m.bastoes.length === 1 ? 'passagem' : 'passagens'})` +
      (m.compactarEm ? ` · compacta em ${m.compactarEm}k` : '') +
      (m.compactacoes ? ` (${m.compactacoes}× até agora)` : ''),
    aviso: (k) => `orquestrador: compactando a sessão principal (~${k}k de contexto)`,
    instr: (m) => [
      'Esta é a sessão PRINCIPAL do orquestrador.',
      `Mantenha no resumo, literalmente: o caminho do estado do lote (${m.estado || 'veja o início da conversa'}) e o do SKILL.md (${m.skill || 'veja o início da conversa'}).`,
      'Mantenha também: cada frente aberta com dono atual (id), branch, PR e o que ela espera; oks do dono pendentes e as decisões dele com as palavras dele; bastões e cards pendentes com task_id; o que a principal estava fazendo no último turno.',
      'Primeira ação depois do resumo: reler o SKILL.md e o estado do lote pelos caminhos acima, antes de responder ou agir.',
    ].join(' '),
    noSession: 'CLAUDE_CODE_SESSION_ID ausente: rode pelo Bash da sessão principal.',
    bad: (k, v) => `valor inválido em --${k}: ${v}`,
    badBaton: (v) => `--bastao espera ENTREGA:INICIO:PASSOS (números), veio: ${v}`,
    usage: 'uso: metricas.mjs gravar|decisao|decidiu|decisoes|faixa|compactou|instrucoes|fim [opções]',
    semDecisao: (id) => `decisão ${id} não está na fila`,
    fila: (n) => (n ? `decisões pendentes (${n}):` : 'nenhuma decisão pendente'),
    rotulos: { decisao: 'decisão', de: 'de', frente: 'frente', anterior: '‹ anterior', proxima: 'próxima ›', responder: 'responder…', relatorio: 'relatório' },
  },
  en: {
    line: (m) => `metrics · fronts ${m.frentes} (sessions ${m.sessoes} · reused ${m.reaproveitadas} · subagents ${m.subagentes} · batons ${m.bastoes.length}) · PRs merged ${m.prs} · main peak ~${m.pico}k · estimated savings ~${fmt(m.economia.total)}k`,
    band: (m) => `🎼 orchestrator · fronts ${m.frentes} · sessions ${m.sessoes} · batons ${m.bastoes.length} · PRs ${m.prs} · peak ~${m.pico}k · estimated savings ~${fmt(m.economia.total)}k`,
    detail: (m) => `   floor avoided ~${fmt(m.economia.piso)}k (${m.reaproveitadas} reused + ${m.subagentes} subagents) · baton ~${fmt(m.economia.bastao)}k (${m.bastoes.length} ${m.bastoes.length === 1 ? 'handoff' : 'handoffs'})` +
      (m.compactarEm ? ` · compacts at ${m.compactarEm}k` : '') +
      (m.compactacoes ? ` (${m.compactacoes}× so far)` : ''),
    aviso: (k) => `orchestrator: compacting the main session (~${k}k of context)`,
    instr: (m) => [
      'This is the orchestrator MAIN session.',
      `Keep in the summary, verbatim: the path of the batch state (${m.estado || 'see the start of the conversation'}) and of SKILL.md (${m.skill || 'see the start of the conversation'}).`,
      'Also keep: each open front with its current owner (id), branch, PR and what it is waiting for; the owner\'s pending oks and decisions in their own words; pending batons and cards with task_id; what the main session was doing in the last turn.',
      'First action after the summary: re-read SKILL.md and the batch state from the paths above, before answering or acting.',
    ].join(' '),
    noSession: 'CLAUDE_CODE_SESSION_ID missing: run it from the main session\'s Bash.',
    bad: (k, v) => `invalid value for --${k}: ${v}`,
    badBaton: (v) => `--bastao expects HANDOFF:START:STEPS (numbers), got: ${v}`,
    usage: 'usage: metricas.mjs gravar|decisao|decidiu|decisoes|faixa|compactou|instrucoes|fim [options]',
    semDecisao: (id) => `decision ${id} is not in the queue`,
    fila: (n) => (n ? `pending decisions (${n}):` : 'no pending decisions'),
    rotulos: { decisao: 'decision', de: 'of', frente: 'front', anterior: '‹ previous', proxima: 'next ›', responder: 'answer…', relatorio: 'report' },
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

function ler(f) {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
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

function inteiro(o, k, padrao = 0) {
  const v = o[k] ?? String(padrao);
  if (!/^\d{1,7}$/.test(String(v))) throw new Error(TXT.bad(k, v));
  return Number(v);
}

function caminho(o, k, anterior) {
  if (o[k] === undefined) return anterior || '';
  const v = o[k];
  if (v.length > 500 || /[\r\n\0]/.test(v)) throw new Error(TXT.bad(k, v.slice(0, 40)));
  return v;
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

function texto(o, k, max, obrigatorio = false) {
  const v = (o[k] ?? '').trim();
  if (obrigatorio && !v) throw new Error(TXT.bad(k, '(vazio)'));
  if (v.length > max || /[\0]/.test(v)) throw new Error(TXT.bad(k, v.slice(0, 40)));
  return v.replace(/\s*[\r\n]+\s*/g, ' ');
}

function sessaoAtual() {
  const f = arquivo(process.env.CLAUDE_CODE_SESSION_ID);
  if (!f) throw new Error(TXT.noSession);
  return f;
}

function salvar(f, m) {
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(m, null, 2));
}

// Fila de decisões do dono: a principal registra o que um retorno de filha pede a ele, e a faixa
// mostra uma decisão por vez. Sai da fila só com `decidiu`, depois da resposta do dono.
function decisao(o) {
  const f = sessaoAtual();
  const m = ler(f) || { v: 2, lang, ...calcular({ bastao: [] }), compactarEm: COMPACTAR_EM, compactacoes: 0 };
  const fila = m.decisoes || [];
  const opcoes = (o.opcoes ?? '').split('|').map((s) => s.trim()).filter(Boolean);
  if (opcoes.length > 4 || opcoes.some((s) => s.length > 40)) throw new Error(TXT.bad('opcoes', o.opcoes));
  const id = o.id ? texto(o, 'id', 10) : `D${m.proxDecisao || 1}`;
  if (!/^[A-Za-z0-9]{1,10}$/.test(id)) throw new Error(TXT.bad('id', id));
  const d = {
    id,
    frente: texto(o, 'frente', 60, true),
    pergunta: texto(o, 'pergunta', 240, true),
    opcoes,
    contexto: texto(o, 'contexto', 300),
    relatorio: caminho(o, 'relatorio', ''),
  };
  const i = fila.findIndex((x) => x.id === id);
  if (i >= 0) fila[i] = d;
  else fila.push(d);
  const n = /^D(\d+)$/.exec(id);
  if (n) m.proxDecisao = Math.max(m.proxDecisao || 1, Number(n[1]) + 1);
  m.decisoes = fila;
  m.at = Date.now();
  salvar(f, m);
  console.log(id);
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const o = args(rest);
  if (cmd === 'gravar') {
    const f = arquivo(process.env.CLAUDE_CODE_SESSION_ID);
    if (!f) throw new Error(TXT.noSession);
    const antes = ler(f) || {};
    const m = calcular(o);
    m.estado = caminho(o, 'estado', antes.estado);
    m.skill = caminho(o, 'skill', antes.skill);
    m.compactarEm = o['compactar-em'] !== undefined ? inteiro(o, 'compactar-em') : antes.compactarEm ?? COMPACTAR_EM;
    m.compactacoes = antes.compactacoes || 0;
    m.decisoes = antes.decisoes || [];
    m.proxDecisao = antes.proxDecisao || 1;
    salvar(f, { v: 2, lang, at: Date.now(), ...m });
    console.log(TXT.line(m));
    return;
  }
  if (cmd === 'decisao') return decisao(o);
  if (cmd === 'decidiu') {
    const f = sessaoAtual();
    const m = ler(f) || {};
    const fila = m.decisoes || [];
    const resto = fila.filter((x) => x.id !== o.id);
    if (resto.length === fila.length) throw new Error(TXT.semDecisao(o.id));
    m.decisoes = resto;
    m.at = Date.now();
    salvar(f, m);
    return;
  }
  if (cmd === 'decisoes') {
    const fila = (ler(sessaoAtual()) || {}).decisoes || [];
    console.log(TXT.fila(fila.length));
    for (const d of fila) {
      console.log(`${d.id} [${d.frente}] ${d.pergunta}` + (d.opcoes.length ? ` (${d.opcoes.join(' / ')})` : ''));
    }
    return;
  }
  if (cmd === 'faixa') {
    const f = arquivo(o.session);
    const m = f && ler(f);
    if (!m || !(Date.now() - m.at < VALIDADE_MS)) return;
    process.stdout.write(JSON.stringify({
      text: TXT.band(m),
      detail: TXT.detail(m),
      compactarEm: m.compactarEm || 0,
      instrucoes: TXT.instr(m),
      aviso: TXT.aviso('%K'),
      decisoes: m.decisoes || [],
      rotulos: TXT.rotulos,
    }));
    return;
  }
  if (cmd === 'compactou') {
    const f = arquivo(o.session);
    const m = f && ler(f);
    if (!m) return;
    m.compactacoes = (m.compactacoes || 0) + 1;
    m.at = Date.now();
    fs.writeFileSync(f, JSON.stringify(m, null, 2));
    return;
  }
  if (cmd === 'instrucoes') {
    const f = arquivo(process.env.CLAUDE_CODE_SESSION_ID);
    console.log(TXT.instr((f && ler(f)) || {}));
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
