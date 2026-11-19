// "Avisos al móvil", "Puente de datos" y "Tu repositorio privado": cómo se conecta la app con el barrido y con GitHub.
// Se pinta dentro de Reglas (`reglas.js`); sus botones y formularios se atienden aquí.

export function createConexion(ctx) {
  const { state, esc, readLocal, writeLocal, render, root, ghReady, reload, LS_COPIED, LS_BRIDGE, LS_GH, sectionHead } = ctx;

  /** Texto para pegar en el secreto CENTINELA_CONFIG de GitHub. */
  function secretText() {
    const { rules, order, alerts, off } = state.config;
    return JSON.stringify({ rules, order, alerts, off });
  }

  function secretBlock() {
    const copiedAt = Number(readLocal(LS_COPIED) ?? 0);
    const stale = copiedAt > 0 && state.config.savedAt > copiedAt;
    const status = !copiedAt
      ? "Todavía no has copiado la configuración desde este dispositivo."
      : stale
        ? "Has cambiado las reglas después de la última copia: los avisos siguen con las anteriores."
        : "Los avisos usan lo que copiaste por última vez desde este dispositivo.";
    return `<section class="block">
      ${sectionHead("Avisos al móvil")}
      <p class="small muted">Tus reglas se guardan solo en este dispositivo; no se publican. Para que los avisos las sigan, copia la configuración y pégala en GitHub como secreto <b>CENTINELA_CONFIG</b>. Repítelo cuando cambies las reglas.</p>
      <div class="panel"><div class="form">
        <p class="small${stale ? "" : " muted"}">${status}</p>
        <button class="btn primary" style="margin-top:10px" data-act="copy-secret">Copiar configuración para avisos</button>
        ${state.copied ? `<p class="small" style="margin-top:10px">${esc(state.copied)}</p>` : ""}
        ${state.copied && state.copied.startsWith("No") ? `<textarea class="textfield" id="secreto" readonly style="height:120px;padding:10px;margin-top:10px">${esc(secretText())}</textarea>` : ""}
      </div></div>
    </section>`;
  }

  function bridgeBlock() {
    const own = String(readLocal(LS_BRIDGE) ?? "");
    return `<section class="block">
      ${sectionHead("Puente de datos")}
      <p class="small muted">Este archivo prueba a leer CBOE directamente y, si no puede, por tres puentes gratuitos de terceros. Si tienes un puente propio, pon aquí su dirección y será el primero que pruebe.</p>
      <div class="panel"><div class="form">
        <form data-bridge>
          <label for="puente">Dirección del puente propio (opcional)<input class="textfield" id="puente" name="bridge" value="${esc(own)}" placeholder="https://…/?url=" autocomplete="off"></label>
          <button class="btn primary" style="margin-top:12px" type="submit">Guardar</button>
        </form>
      </div></div>
    </section>`;
  }

  function ghBlock() {
    const ready = ghReady();
    return `<section class="block">
      ${sectionHead("Tu repositorio privado")}
      <p class="small muted">${ready ? "Conectada. Los barridos, las reglas y los favoritos se leen y se guardan en tu repositorio privado." : "La app necesita tu usuario, el nombre del repositorio y una llave de acceso para leer tus barridos. La llave se queda solo en este dispositivo."}</p>
      <div class="panel">
        <div class="form">
          ${
            state.showGh || !ready
              ? `<form data-gh>
                  <label for="gh-owner">Usuario de GitHub<input class="textfield" id="gh-owner" name="owner" value="${esc(state.gh.owner)}" autocomplete="off" autocapitalize="none"></label>
                  <label for="gh-repo">Repositorio<input class="textfield" id="gh-repo" name="repo" value="${esc(state.gh.repo)}" autocomplete="off" autocapitalize="none"></label>
                  <label for="gh-token">Llave de acceso<input class="textfield" id="gh-token" name="token" type="password" value="${esc(state.gh.token)}" autocomplete="off"></label>
                  <button class="btn primary" style="margin-top:12px" type="submit">Conectar</button>
                </form>`
              : `<p class="small">${esc(state.gh.owner)}/${esc(state.gh.repo)}</p>
                 <button class="btn quiet" style="margin-top:8px" data-act="gh-edit">Cambiar</button>
                 <button class="btn quiet" style="margin-top:8px" data-act="gh-clear">Desconectar</button>`
          }
        </div>
      </div>
    </section>`;
  }

  /** Clic en uno de sus botones; devuelve true si era suyo. */
  function click(el) {
    if (el.dataset.act === "copy-secret") {
      const done = (text) => {
        state.copied = text;
        render();
        root.querySelector("#secreto")?.select();
      };
      try {
        navigator.clipboard.writeText(secretText()).then(
          () => {
            writeLocal(LS_COPIED, Date.now());
            done("Copiado. Pégalo en GitHub: Settings → Secrets and variables → Actions → CENTINELA_CONFIG.");
          },
          () => done("No se pudo copiar solo. Mantén pulsado el texto de abajo y cópialo a mano."),
        );
      } catch {
        done("No se pudo copiar solo. Mantén pulsado el texto de abajo y cópialo a mano.");
      }
    } else if (el.dataset.act === "gh-edit") {
      state.showGh = true;
      render();
    } else if (el.dataset.act === "gh-clear") {
      state.gh = { ...state.gh, token: "" };
      writeLocal(LS_GH, state.gh);
      state.sync = { state: "local", message: "" };
      render();
    } else return false;
    return true;
  }

  /** Envío de uno de sus formularios; devuelve true si era suyo. */
  function submit(form) {
    if (form.matches("[data-bridge]")) {
      writeLocal(LS_BRIDGE, String(new FormData(form).get("bridge") ?? "").trim());
      render();
    } else if (form.matches("[data-gh]")) {
      const data = new FormData(form);
      state.gh = {
        owner: String(data.get("owner") ?? "").trim(),
        repo: String(data.get("repo") ?? "").trim(),
        token: String(data.get("token") ?? "").trim(),
      };
      writeLocal(LS_GH, state.gh);
      state.showGh = false;
      state.tab = "buscador";
      reload();
    } else return false;
    return true;
  }

  return { block: () => (state.mode === "nube" ? (ghReady() ? ghBlock() : secretBlock()) : ""), bridge: () => (state.mode === "muestra" && !window.claude?.use ? bridgeBlock() : ""), click, submit };
}
