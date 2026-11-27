// Si existe la variable CBOE_PUENTE (secreto de GitHub), las lecturas de CBOE pasan por el puente
// (puente/worker.js). Su valor es la parte fija de la dirección, con la clave, por ejemplo:
//   https://centinela-puente.<tu-cuenta>.workers.dev/?k=<CLAVE>&url=
// Sin la variable, se pide a CBOE directamente, como antes.
// La dirección del puente lleva la clave: no se escribe nunca en el registro (el repositorio es público).

export function viaPuente(url, puente = process.env.CBOE_PUENTE) {
  const base = String(puente ?? "").trim();
  if (!base.startsWith("https://") || !url.startsWith("https://cdn.cboe.com/")) return url;
  return base + encodeURIComponent(url);
}

export const usaPuente = (puente = process.env.CBOE_PUENTE) => String(puente ?? "").trim().startsWith("https://");
