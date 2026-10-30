// Pestaña Avisos: lo que ha avisado el barrido y cómo se enteran el móvil y el ordenador.

export function createAvisos(ctx) {
  const { state, esc, when, sectionHead, changeConfig, foot, syncLine, isPublic } = ctx;

  function viewAvisos() {
    const a = state.config.alerts;
    const push = state.scan?.push;
    const items = state.alerts.length
      ? state.alerts
          .map(
            (alert) => `<div class="alert">
              <p class="xs muted num">${when(alert.at)}</p>
              <p><b>${esc(alert.title)}</b></p>
              <p class="small muted">${esc(alert.text)}</p>
            </div>`,
          )
          .join("")
      : `<div class="alert"><p class="small muted">${isPublic() ? "Los avisos se ven en la app ntfy. El primer barrido solo toma nota; avisa cuando algo cambia." : "Sin avisos todavía. El primer barrido solo toma nota; avisa cuando algo cambia."}</p></div>`;
    return `<div class="narrow">
      <header class="top">
        <h1 class="sr-only">Avisos</h1>
        <p class="small muted">${
          state.mode === "muestra" ? "Versión de prueba: aquí se anotarán los avisos cuando la app barra de verdad." : isPublic() ? (push ? "Avisos al móvil activos. Llegan a la app ntfy; aquí no se anotan, porque esta página la puede abrir cualquiera." : "Avisos al móvil sin configurar. Faltan los secretos NTFY_TOPIC y CENTINELA_CONFIG en GitHub.") : push ? "Avisos al móvil activos." : state.mode === "nube" ? "Avisos al móvil sin configurar: se anotan aquí, pero no llegan al teléfono. Falta el secreto NTFY_TOPIC en tu repositorio." : "Avisos al móvil sin configurar: se anotan aquí, pero no llegan al teléfono. El LEEME explica cómo activarlos con ntfy."
        }</p>
      </header>
      <div class="panel">
        <div class="gate">
          <button role="switch" aria-checked="${a.favorites}" data-alert="favorites">
            <span><b>Un nombre pasa a cumplir</b><span class="small muted">Avisa cuando un nombre de la lista entra en tus reglas.</span></span>
            <span class="switch"><i></i></span>
          </button>
        </div>
      </div>
      <p class="small muted" style="margin-top:8px">${esc(syncLine())}</p>
      <section class="block">
        ${sectionHead("Bitácora")}
        <div class="panel">${items}</div>
      </section>
      ${foot()}
    </div>`;
  }


  /** Clic en un interruptor de avisos; devuelve true si era suyo. */
  function click(el) {
    if (!el.dataset.alert) return false;
    changeConfig((config) => {
      config.alerts[el.dataset.alert] = !config.alerts[el.dataset.alert];
    });
    return true;
  }

  return { view: viewAvisos, click };
}
