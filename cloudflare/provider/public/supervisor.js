const API_BASE = "/api";
const SUPERVISOR_ACCESS_KEY_STORAGE = "supervisorPortalAccessKey";

let boot = null;
let accessKey = "";

document.addEventListener("DOMContentLoaded", async function () {
  wireEvents();
  restoreAccessKey();
  await loadBootstrap();
  if (!requiresAccessKey()) {
    await loadDashboard();
  }
});

function wireEvents() {
  document.getElementById("loadDashboard").addEventListener("click", function () {
    loadDashboard();
  });

  document.getElementById("accessKey").addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      event.preventDefault();
      loadDashboard();
    }
  });

  document.getElementById("manualAppointmentForm").addEventListener("submit", submitManualAppointment);
}

async function loadBootstrap() {
  try {
    boot = await api("supervisorBootstrap", {});
    renderAccessSummary();
  } catch (error) {
    showMessage(error.message || "No pudimos iniciar el panel interno.", "error");
  }
}

function restoreAccessKey() {
  accessKey = sessionStorage.getItem(SUPERVISOR_ACCESS_KEY_STORAGE) || "";
  document.getElementById("accessKey").value = accessKey;
}

function requiresAccessKey() {
  return Boolean(boot && boot.config && boot.config.supervisorProtected);
}

function renderAccessSummary() {
  const summary = document.getElementById("panelSummary");
  const protectedMode = requiresAccessKey();
  summary.innerHTML = [
    '<div class="note">',
    "<p><strong>Acceso adicional:</strong> " + escapeHtml(protectedMode ? "Activo" : "No configurado") + "</p>",
    "<p><strong>Supervisor:</strong> " + escapeHtml(boot && boot.config ? boot.config.supervisorName : "Freddy") + "</p>",
    "<p><strong>Ventana visible:</strong> " + escapeHtml(String(boot && boot.config ? boot.config.lookaheadDays : 14)) + " d&iacute;as</p>",
    "</div>"
  ].join("");
}

async function loadDashboard() {
  accessKey = String(document.getElementById("accessKey").value || "").trim();

  if (requiresAccessKey() && !accessKey) {
    showMessage("Ingresa la clave de supervisor para continuar.", "error");
    return;
  }

  const releaseBusy = setBusyState(document.getElementById("loadDashboard"), true);
  showMessage("Cargando panel interno...", "loading");

  try {
    const data = await api("supervisorDashboard", {
      accessKey: accessKey,
      startDate: boot && boot.today ? boot.today : null
    });
    sessionStorage.setItem(SUPERVISOR_ACCESS_KEY_STORAGE, accessKey);
    renderDashboard(data);
    showMessage("Panel actualizado.", "success");
  } catch (error) {
    showMessage(error.message || "No pudimos cargar el panel interno. Intenta nuevamente.", "error");
  } finally {
    releaseBusy();
  }
}

async function submitManualAppointment(event) {
  event.preventDefault();
  const form = event.target;
  const payload = formToObject(form);
  payload.accessKey = String(document.getElementById("accessKey").value || "").trim();
  payload.allowOutsideSchedule = Boolean(payload.allowOutsideSchedule);
  const releaseBusy = setBusyState(getSubmitButton(event), true);
  showMessage("Creando cita manual...", "loading");

  try {
    const response = await api("createManualAppointment", payload);
    form.reset();
    showMessage(response.message, "success");
    await loadDashboard();
  } catch (error) {
    showMessage(error.message || "No pudimos crear la cita manual.", "error");
  } finally {
    releaseBusy();
  }
}

function renderDashboard(data) {
  document.getElementById("providersMetric").textContent = String(data.stats && data.stats.providersPending || 0);
  document.getElementById("appointmentsMetric").textContent = String(data.stats && data.stats.appointmentsPending || 0);
  document.getElementById("ordersMetric").textContent = data.stats && data.stats.openOrdersLoaded ? "S\u00ed" : "No";
  document.getElementById("providersCount").textContent = String((data.pendingProviders || []).length);
  document.getElementById("appointmentsCount").textContent = String((data.pendingAppointments || []).length);

  renderPendingProviders(data.pendingProviders || []);
  renderPendingAppointments(data.pendingAppointments || []);
  renderApprovedAppointments(data.approvedAppointments || []);
  renderCalendar(data.calendar || { days: [] });
}

function renderPendingProviders(items) {
  const wrapper = document.getElementById("providersPending");
  wrapper.innerHTML = "";

  if (!items.length) {
    wrapper.innerHTML = '<p class="muted">No hay proveedores pendientes.</p>';
    return;
  }

  items.forEach(function (item) {
    const card = document.createElement("article");
    card.className = "summary admin-list-card";
    card.innerHTML = [
      "<p><strong>" + escapeHtml(item.vendorName) + "</strong></p>",
      "<p>C\u00f3digo: " + escapeHtml(item.vendorCode || "") + " | Correo: " + escapeHtml(item.email || "") + "</p>",
      "<p>OC: " + escapeHtml(item.ocNumber || "") + " | Estado: " + escapeHtml(item.registrationStatus || "") + "</p>"
    ].join("");

    const actions = document.createElement("div");
    actions.className = "admin-actions";

    actions.appendChild(createActionButton("Aprobar", "button primary", async function () {
      const notes = window.prompt("Observaci\u00f3n opcional para aprobar el proveedor:", "") || "";
      await runAction("approveProvider", {
        providerId: item.providerId,
        accessKey: accessKey,
        notes: notes
      });
    }, "Aprobando..."));

    actions.appendChild(createActionButton("Rechazar", "button subtle", async function () {
      const notes = window.prompt("Motivo de rechazo:", "");
      if (notes === null) {
        return;
      }
      await runAction("rejectProvider", {
        providerId: item.providerId,
        accessKey: accessKey,
        notes: notes
      });
    }, "Rechazando..."));

    card.appendChild(actions);
    wrapper.appendChild(card);
  });
}

function renderPendingAppointments(items) {
  const wrapper = document.getElementById("appointmentsPending");
  wrapper.innerHTML = "";

  if (!items.length) {
    wrapper.innerHTML = '<p class="muted">No hay citas pendientes.</p>';
    return;
  }

  items.forEach(function (item) {
    const card = document.createElement("article");
    card.className = "summary admin-list-card";
    card.innerHTML = [
      "<p><strong>" + escapeHtml(item.vendorName) + "</strong></p>",
      "<p>" + escapeHtml(item.slotDate || "") + " | " + escapeHtml(item.slotLabel || "") + "</p>",
      "<p>OC: " + escapeHtml(item.ocNumber || "") + " | \u00c1rea: " + escapeHtml(item.ocArea || "Sin definir") + "</p>",
      "<p>Comprador: " + escapeHtml(item.ocBuyerName || "Sin definir") + " | Grupos: " + escapeHtml(item.ocItemGroups || "Sin definir") + "</p>",
      "<p>Resumen: " + escapeHtml(item.ocItemsSummary || "Sin detalle disponible") + "</p>"
    ].join("");

    const actions = document.createElement("div");
    actions.className = "admin-actions";

    actions.appendChild(createActionButton("Aprobar", "button primary", async function () {
      const notes = window.prompt("Observaci\u00f3n opcional para la aprobaci\u00f3n:", "") || "";
      await runAction("approveAppointment", {
        appointmentId: item.appointmentId,
        accessKey: accessKey,
        notes: notes
      });
    }, "Aprobando..."));

    actions.appendChild(createActionButton("Reasignar", "button secondary", async function () {
      const startIso = window.prompt("Nueva fecha y hora en formato YYYY-MM-DDTHH:MM", (item.effectiveStart || "").slice(0, 16));
      if (!startIso) {
        return;
      }
      const allowOutsideSchedule = window.confirm("Aceptar fuera del horario habitual si corresponde?");
      const notes = window.prompt("Observaci\u00f3n de reasignaci\u00f3n:", "") || "";
      await runAction("rescheduleAppointment", {
        appointmentId: item.appointmentId,
        accessKey: accessKey,
        startIso: startIso,
        allowOutsideSchedule: allowOutsideSchedule,
        approveAfter: true,
        notes: notes
      });
    }, "Reasignando..."));

    actions.appendChild(createActionButton("Rechazar", "button subtle", async function () {
      const notes = window.prompt("Motivo de rechazo:", "");
      if (notes === null) {
        return;
      }
      await runAction("rejectAppointment", {
        appointmentId: item.appointmentId,
        accessKey: accessKey,
        notes: notes
      });
    }, "Rechazando..."));

    card.appendChild(actions);
    wrapper.appendChild(card);
  });
}

function renderApprovedAppointments(items) {
  const wrapper = document.getElementById("approvedAppointments");
  if (!items.length) {
    wrapper.innerHTML = '<p class="muted">Todav\u00eda no hay citas aprobadas.</p>';
    return;
  }

  const rows = items.map(function (item) {
    return [
      "<tr>",
      "<td>" + escapeHtml(item.vendorName || "") + "</td>",
      "<td>" + escapeHtml(item.ocNumber || "") + "</td>",
      "<td>" + escapeHtml(item.ocArea || "") + "</td>",
      "<td>" + escapeHtml(item.slotDate || "") + "</td>",
      "<td>" + escapeHtml(item.slotLabel || "") + "</td>",
      "<td>" + escapeHtml(item.outsideSchedule === "SI" ? "S\u00ed" : "No") + "</td>",
      "</tr>"
    ].join("");
  }).join("");

  wrapper.innerHTML = [
    "<table>",
    "<thead><tr><th>Proveedor</th><th>OC</th><th>\u00c1rea</th><th>Fecha</th><th>Hora</th><th>Fuera horario</th></tr></thead>",
    "<tbody>" + rows + "</tbody>",
    "</table>"
  ].join("");
}

function renderCalendar(calendar) {
  const wrapper = document.getElementById("calendar");
  wrapper.innerHTML = "";

  (calendar.days || []).forEach(function (day) {
    const card = document.createElement("article");
    card.className = "day-card";
    card.innerHTML = [
      '<div class="day-head">',
      "<h3>" + escapeHtml(day.weekday || "") + "</h3>",
      "<p>" + escapeHtml(day.date || "") + "</p>",
      "</div>"
    ].join("");

    const slots = document.createElement("div");
    slots.className = "slots";

    if (!day.slots || !day.slots.length) {
      slots.innerHTML = '<p class="muted">Sin horario base</p>';
    } else {
      day.slots.forEach(function (slot) {
        const node = document.createElement("div");
        node.className = "slot slot-" + String(slot.status || "available").toLowerCase();
        node.title = buildCalendarSlotTitle(slot);
        node.innerHTML = [
          '<span class="slot-time">' + escapeHtml(slot.label || "") + "</span>",
          '<span class="slot-indicator" aria-hidden="true"></span>'
        ].join("");
        slots.appendChild(node);
      });
    }

    card.appendChild(slots);
    wrapper.appendChild(card);
  });
}

function buildCalendarSlotTitle(slot) {
  const status = String(slot.status || "AVAILABLE").toUpperCase();
  const vendor = String(slot.vendorName || "").trim();

  if (status === "APPROVED") {
    return (slot.label || "") + " | Aprobado" + (vendor ? " | " + vendor : "");
  }
  if (status === "PENDING") {
    return (slot.label || "") + " | Pendiente de aprobación" + (vendor ? " | " + vendor : "");
  }
  return (slot.label || "") + " | Disponible";
}

function createActionButton(label, className, handler, loadingText) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.dataset.loadingText = loadingText || "Procesando...";
  button.addEventListener("click", async function () {
    const releaseBusy = setBusyState(button, true);
    try {
      await Promise.resolve(handler());
    } catch (error) {
      showMessage(error.message || "No pudimos completar la acci\u00f3n.", "error");
    } finally {
      releaseBusy();
    }
  });
  return button;
}

async function runAction(action, payload) {
  showMessage("Procesando acci\u00f3n...", "loading");
  const response = await api(action, payload || {});
  showMessage(response.message || "Acci\u00f3n completada.", "success");
  await loadDashboard();
}

async function api(action, payload) {
  const response = await fetch(API_BASE + "/" + action, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload || {})
  });

  const text = await response.text();
  let data = null;

  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(defaultActionError(action));
  }

  if (!response.ok || !data.ok) {
    throw new Error(normalizeUserError(data.error, action));
  }

  return data.data;
}

function normalizeUserError(message, action) {
  const value = String(message || "").toLowerCase();
  if (!value) {
    return defaultActionError(action);
  }
  if (
    value.indexOf("json") >= 0 ||
    value.indexOf("apps script") >= 0 ||
    value.indexOf("backend") >= 0 ||
    value.indexOf("web app") >= 0 ||
    value.indexOf("upstream") >= 0
  ) {
    return defaultActionError(action);
  }
  return message;
}

function defaultActionError(action) {
  switch (action) {
    case "supervisorBootstrap":
    case "supervisorDashboard":
      return "No pudimos cargar el panel interno en este momento. Intenta nuevamente en unos minutos.";
    case "approveProvider":
    case "rejectProvider":
      return "No pudimos actualizar el proveedor en este momento. Intenta nuevamente en unos minutos.";
    case "approveAppointment":
    case "rejectAppointment":
    case "rescheduleAppointment":
    case "createManualAppointment":
      return "No pudimos actualizar la cita en este momento. Intenta nuevamente en unos minutos.";
    default:
      return "No se pudo completar la operaci\u00f3n. Intenta nuevamente en unos minutos.";
  }
}

function getSubmitButton(event) {
  return event.submitter || event.target.querySelector('button[type="submit"]');
}

function setBusyState(button, isBusy) {
  if (!button) {
    return function () {};
  }

  if (isBusy) {
    if (!button.dataset.originalText) {
      button.dataset.originalText = button.textContent;
    }
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.classList.add("is-loading");
    button.textContent = button.dataset.loadingText || "Cargando...";
    return function () {
      setBusyState(button, false);
    };
  }

  button.disabled = false;
  button.removeAttribute("aria-busy");
  button.classList.remove("is-loading");
  button.textContent = button.dataset.originalText || button.textContent;
  return function () {};
}

function formToObject(form) {
  const data = new FormData(form);
  const result = Object.fromEntries(data.entries());
  result.allowOutsideSchedule = data.get("allowOutsideSchedule") === "on";
  return result;
}

function showMessage(text, type) {
  const box = document.getElementById("message");
  box.textContent = text;
  box.className = "message " + type;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
