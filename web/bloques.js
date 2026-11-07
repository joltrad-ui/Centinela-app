// Bloques efectivos en la app: los grupos de "caer juntos" (`effectiveBlocks` del motor) mezclados con los bloques de la lista.
// Se calculan con los cierres hasta el corte del mes y con el umbral de Reglas (`blockCoFall`), una vez por barrido, cierres,
// umbral y mes, y dejan en cada nombre del barrido su bloque efectivo (`sym.be`). `sym.b` no cambia: sigue siendo el de la lista.
// Lo guardado con nombres de bloque (Mis bloques, el filtro de Bloque del Buscador y sus combinaciones guardadas) se pasa a los
// bloques nuevos cuando cambian; lo que había en cada bloque se recuerda en `centinela.bloques.v1`, solo en este dispositivo.

import { blockCutoff, effectiveBlocks, nyToday } from "./engine.js";

const LS = "centinela.bloques.v1";

export function createBloques({ state, readLocal, writeLocal }) {
  let cache = { key: "", info: null };
  const migrators = [];

  /** La lista base en su orden. El barrido la publica (`lista`); un barrido de antes no la trae y vale el orden de los cierres,
   *  que es el de universe.json. */
  function listOf() {
    const symbols = (state.scan?.symbols ?? []).filter((sym) => sym.b);
    if (Array.isArray(state.scan?.lista) && state.scan.lista.length) return state.scan.lista.filter((row) => row && typeof row.s === "string");
    const bySym = new Map(symbols.map((sym) => [sym.s, sym]));
    const order = Object.keys(state.hist?.symbols ?? {}).filter((s) => bySym.has(s));
    for (const sym of symbols) if (!order.includes(sym.s)) order.push(sym.s);
    return order.map((s) => ({ s, b: bySym.get(s).b }));
  }

  /** Lo que había en cada bloque la última vez; si nunca se guardó, los bloques de la lista. */
  function before(list) {
    const saved = readLocal(LS);
    if (saved && saved.members && typeof saved.members === "object") return saved;
    const members = {};
    for (const row of list) (members[row.b] ??= []).push(row.s);
    return { members, notice: false, fresh: true };
  }

  /** Los bloques de ahora. Al cambiar (mes, umbral, cierres o lista) se migra lo guardado. */
  function info() {
    const today = nyToday();
    const threshold = state.config.rules.blockCoFall;
    const key = JSON.stringify([state.scan?.at, (state.scan?.symbols ?? []).length, state.hist?.at, threshold, blockCutoff(today)]);
    if (cache.key === key) return cache.info;
    const list = listOf();
    const hist = state.hist?.symbols ?? null;
    const out = effectiveBlocks({ list, hist, last: state.hist?.last ?? null, today, threshold });
    for (const sym of state.scan?.symbols ?? []) {
      if (out.of[sym.s]) sym.be = out.of[sym.s];
      else delete sym.be;
    }
    cache = { key, info: out };
    // Sin cierres todavía (la app acaba de abrir) no se migra nada: se esperaría a tenerlos y se movería dos veces.
    if (hist && list.length) {
      const prev = before(list);
      if (JSON.stringify(prev.members) !== JSON.stringify(out.members)) {
        let changed = false;
        for (const migrate of migrators) changed = migrate(prev.members, out) || changed;
        writeLocal(LS, { members: out.members, notice: Boolean(prev.notice) || changed });
      } else if (prev.fresh) writeLocal(LS, { members: out.members, notice: false });
    }
    return out;
  }

  return {
    info,
    /** Registra quién guarda nombres de bloque: `migrate(antes, ahora)` los pasa a los de ahora y dice si algo cambió. */
    onChange: (migrate) => migrators.push(migrate),
    /** El bloque efectivo de un símbolo (o null si no está en la lista). */
    of: (s) => info().of[s] ?? null,
    /** Los bloques ya abiertos: los marcados a mano y los de los deals sin cerrar, sacados de su símbolo (no del bloque que tenían al apuntarlos). */
    held(marked, deals) {
      const of = info().of;
      return [...new Set([...marked, ...deals.map((deal) => of[deal.s] ?? deal.b).filter(Boolean)])];
    },
    /** ¿Hay que avisar de que los bloques han cambiado? Se apaga al abrir Mis bloques. */
    notice: () => readLocal(LS)?.notice === true,
    seen() {
      const saved = readLocal(LS);
      if (saved?.notice) writeLocal(LS, { ...saved, notice: false });
    },
  };
}
