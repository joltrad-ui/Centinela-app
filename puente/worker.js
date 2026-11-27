// Puente de Centinela: un Cloudflare Worker que pide a CBOE los datos que el barrido no puede pedir
// directamente, porque CBOE bloquea a los servidores de GitHub desde el 20-nov-2026.
//
// Solo reenvía lecturas de cdn.cboe.com/api/global/delayed_quotes/ y solo con la clave buena,
// así nadie puede usarlo como puente para otras webs.
//
// Uso: https://<tu-worker>.workers.dev/?k=<CLAVE>&url=<dirección de CBOE codificada>
// La clave se guarda en el Worker como secreto con el nombre CLAVE.

const ALLOWED_HOST = "cdn.cboe.com";
const ALLOWED_PATH = "/api/global/delayed_quotes/";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export default {
  async fetch(request, env) {
    const cors = { "Access-Control-Allow-Origin": "*" };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "GET") return new Response("solo GET", { status: 405, headers: cors });

    const here = new URL(request.url);
    if (!env.CLAVE || here.searchParams.get("k") !== env.CLAVE) {
      return new Response("clave incorrecta", { status: 401, headers: cors });
    }
    let target;
    try {
      target = new URL(here.searchParams.get("url") ?? "");
    } catch {
      return new Response("falta la dirección", { status: 400, headers: cors });
    }
    if (target.protocol !== "https:" || target.hostname !== ALLOWED_HOST || !target.pathname.startsWith(ALLOWED_PATH)) {
      return new Response("destino no permitido", { status: 403, headers: cors });
    }

    const res = await fetch(target.toString(), {
      headers: { "User-Agent": UA, Accept: "application/json" },
      cf: { cacheTtl: 60 },
    });
    const headers = new Headers(cors);
    headers.set("Content-Type", res.headers.get("Content-Type") ?? "application/json");
    headers.set("X-Puente", "centinela");
    return new Response(res.body, { status: res.status, headers });
  },
};
