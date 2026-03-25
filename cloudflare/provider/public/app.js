const API_BASE = "/api";
const SESSION_STORAGE_KEY = "providerPortalSessionToken";

let boot = null;
let providerState = null;
let selectedSlot = null;
let appointmentsState = [];
let pendingPurchaseOrdersState = [];
let sessionToken = "";

document.addEventListener("DOMContentLoaded", async function () {
  wireEvents();
  await loadBootstrap();
  await restoreSession();
});

function wireEvents() {
  document.querySelectorAll("[data-tab-target]").forEach(function (button) {
    button.addEventListener("click", function () {
      activateTab(button.getAttribute("data-tab-target"));
    });
  });

  document.getElementById("registerForm").addEventListener("submit", submitRegistration);
  document.getElementById("lookupForm").addEventListener("submit", submitLogin);
  document.getElementById("passwordRecoveryRequestForm").addEventListener("submit", submitPasswordRecoveryRequest);
  document.getElementById("passwordResetForm").addEventListener("submit", submitPasswordReset);
  document.getElementById("emailRecoveryForm").addEventListener("submit", submitEmailRecovery);
  document.getElementById("refreshCalendar").addEventListener("click", refreshDashboard);
  document.getElementById("requestAppointmentButton").addEventListener("click", requestAppointment);
  document.getElementById("logoutButton").addEventListener("click", logout);
  document.getElementById("appointmentOc").addEventListener("change", renderSelectedPurchaseOrderSummary);
  document.getElementById("forgotPasswordToggle").addEventListener("click", function () {
    togglePanel("passwordRecoveryPanel");
  });
  document.getElementById("forgotEmailToggle").addEventListener("click", function () {
    togglePanel("emailRecoveryPanel");
  });
}

async function loadBootstrap() {
  try {
    boot = await api("providerBootstrap", {});
  } catch (error) {
    console.warn(error);
  }
}

async function restoreSession() {
  const storedToken = localStorage.getItem(SESSION_STORAGE_KEY) || "";
  if (!storedToken) {
    return;
  }
  sessionToken = storedToken;
  try {
    await refreshDashboard();
  } catch (error) {
    clearSession();
  }
}

async function submitRegistration(event) {
  event.preventDefault();
  const payload = formToObject(event.target);

  try {
    const response = await api("registerProvider", payload);
    showMessage(response.message, "success");
    handleAuthenticatedResponse(response);
    showGeneratedCode(response.dashboard && response.dashboard.provider ? response.dashboard.provider.vendorCode : "");
    activateTab("loginPanel");
    document.getElementById("lookupForm").email.value = payload.email || "";
    document.getElementById("lookupForm").password.value = payload.password || "";
  } catch (error) {
    showMessage(error.message || "No pudimos completar tu registro en este momento. Intenta nuevamente en unos minutos.", "error");
  }
}

async function submitLogin(event) {
  event.preventDefault();
  const payload = formToObject(event.target);

  try {
    const response = await api("providerLogin", payload);
    showMessage("Ingreso correcto.", "success");
    handleAuthenticatedResponse(response);
  } catch (error) {
    showMessage(error.message || "No pudimos iniciar sesi\u00f3n en este momento.", "error");
  }
}

async function submitPasswordRecoveryRequest(event) {
  event.preventDefault();
  const payload = formToObject(event.target);

  try {
    const response = await api("requestPasswordReset", payload);
    showMessage(response.message, "success");
  } catch (error) {
    showMessage(error.message || "No pudimos procesar la recuperaci\u00f3n en este momento.", "error");
  }
}

async function submitPasswordReset(event) {
  event.preventDefault();
  const payload = formToObject(event.target);

  try {
    const response = await api("resetPassword", payload);
    showMessage(response.message, "success");
    document.getElementById("lookupForm").email.value = payload.email || "";
    document.getElementById("lookupForm").password.value = "";
    document.getElementById("passwordResetForm").reset();
    document.getElementById("passwordRecoveryPanel").classList.add("hidden");
    activateTab("loginPanel");
  } catch (error) {
    showMessage(error.message || "No pudimos actualizar la contrase\u00f1a en este momento.", "error");
  }
}

async function submitEmailRecovery(event) {
  event.preventDefault();
  const payload = formToObject(event.target);

  try {
    const response = await api("recoverEmailByTaxId", payload);
    const result = document.getElementById("emailRecoveryResult");
    result.classList.remove("hidden");
    result.innerHTML = "<p><strong>" + escapeHtml(response.maskedEmail) + "</strong></p><p>" + escapeHtml(response.message) + "</p>";
    showMessage("Consulta realizada correctamente.", "success");
  } catch (error) {
    showMessage(error.message || "No pudimos recuperar el correo en este momento.", "error");
  }
}

function handleAuthenticatedResponse(response) {
  sessionToken = response.sessionToken || "";
  if (sessionToken) {
    localStorage.setItem(SESSION_STORAGE_KEY, sessionToken);
  }
  if (response.dashboard) {
    renderDashboard(response.dashboard);
  }
  document.getElementById("logoutButton").classList.remove("hidden");
}

async function refreshDashboard() {
  if (!sessionToken) {
    return;
  }

  const data = await api("providerDashboard", {
    sessionToken: sessionToken,
    startDate: boot && boot.today ? boot.today : null
  });
  renderDashboard(data);
}

function renderDashboard(data) {
  if (!data.found) {
    clearSession();
    resetProviderView();
    showMessage(data.message || "No encontramos tu cuenta.", "error");
    return;
  }

  activateTab("loginPanel");
  providerState = data.provider;
  appointmentsState = data.appointments || [];
  pendingPurchaseOrdersState = data.pendingPurchaseOrders || [];
  selectedSlot = null;
  document.getElementById("selectedSlotLabel").textContent = "Ninguna";
  document.getElementById("logoutButton").classList.remove("hidden");

  const summary = document.getElementById("providerSummary");
  summary.classList.remove("hidden");
  summary.innerHTML = [
    '<div class="status status-' + data.provider.registrationStatus.toLowerCase() + '">' + escapeHtml(data.provider.registrationStatus) + "</div>",
    "<p><strong>" + escapeHtml(data.provider.vendorName) + "</strong></p>",
    "<p>C\u00f3digo de proveedor: " + escapeHtml(data.provider.vendorCode) + " | Correo: " + escapeHtml(data.provider.email) + "</p>"
  ].join("");

  const warnings = document.getElementById("warnings");
  warnings.innerHTML = "";
  (data.warnings || []).forEach(function (warning) {
    const node = document.createElement("div");
    node.className = "note";
    node.textContent = warning;
    warnings.appendChild(node);
  });

  renderAppointments(appointmentsState);
  renderPendingPurchaseOrders(pendingPurchaseOrdersState);

  const panel = document.getElementById("appointmentPanel");
  if (data.canRequestAppointments && data.calendar) {
    panel.classList.remove("hidden");
    renderCalendar(data.calendar);
  } else {
    panel.classList.add("hidden");
  }
}

function renderPendingPurchaseOrders(openOrders) {
  const select = document.getElementById("appointmentOc");
  const summary = document.getElementById("appointmentOcSummary");
  select.innerHTML = '<option value="">Selecciona una OC abierta</option>';

  openOrders.forEach(function (order) {
    const option = document.createElement("option");
    option.value = order.poNumber;
    option.textContent = order.poNumber + " | " + (order.area || "Sin area") + " | " + (order.deliveryDate || "Sin fecha");
    select.appendChild(option);
  });

  if (!openOrders.length) {
    summary.classList.remove("hidden");
    summary.innerHTML = "<p>No tienes OCs abiertas habilitadas para solicitar cita. La OC debe tener area y material definidos en SAP.</p>";
    return;
  }

  summary.classList.add("hidden");
  summary.innerHTML = "";
}

function renderSelectedPurchaseOrderSummary() {
  const summary = document.getElementById("appointmentOcSummary");
  const selectedPoNumber = document.getElementById("appointmentOc").value;
  const selected = pendingPurchaseOrdersState.find(function (item) {
    return item.poNumber === selectedPoNumber;
  });

  if (!selected) {
    if (pendingPurchaseOrdersState.length) {
      summary.classList.add("hidden");
      summary.innerHTML = "";
    }
    return;
  }

  summary.classList.remove("hidden");
  summary.innerHTML = [
    "<p><strong>Area:</strong> " + escapeHtml(selected.area || "No definida") + "</p>",
    "<p><strong>Fecha entrega:</strong> " + escapeHtml(selected.deliveryDate || "Sin fecha") + "</p>",
    "<p><strong>Lineas:</strong> " + escapeHtml(String(selected.lineCount || 0)) + "</p>",
    "<p><strong>Resumen:</strong> " + escapeHtml(selected.itemsSummary || "Sin detalle de materiales") + "</p>"
  ].join("");
}

function renderCalendar(calendar) {
  const wrapper = document.getElementById("calendar");
  wrapper.innerHTML = "";

  calendar.days.forEach(function (day) {
    const card = document.createElement("article");
    card.className = "day-card";
    card.innerHTML = [
      '<div class="day-head">',
      "<h3>" + escapeHtml(day.weekday) + "</h3>",
      "<p>" + escapeHtml(day.date) + "</p>",
      "</div>"
    ].join("");

    const slots = document.createElement("div");
    slots.className = "slots";

    if (!day.slots.length) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "Sin atenci\u00f3n ese d\u00eda";
      slots.appendChild(empty);
    } else {
      day.slots.forEach(function (slot) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "slot slot-" + slot.status.toLowerCase();
        button.disabled = !slot.isSelectable;
        button.innerHTML = "<span>" + escapeHtml(slot.label) + "</span>";
        button.addEventListener("click", function () {
          selectedSlot = slot;
          document.getElementById("selectedSlotLabel").textContent = slot.startIso + " (" + slot.label + ")";
          document.querySelectorAll(".slot.selected").forEach(function (node) {
            node.classList.remove("selected");
          });
          button.classList.add("selected");
        });
        slots.appendChild(button);
      });
    }

    card.appendChild(slots);
    wrapper.appendChild(card);
  });
}

function renderAppointments(appointments) {
  const section = document.getElementById("appointmentsHistory");
  const wrapper = document.getElementById("appointmentsTable");
  section.classList.remove("hidden");

  if (!appointments.length) {
    wrapper.innerHTML = '<p class="muted">A\u00fan no tienes citas registradas.</p>';
    return;
  }

  const rows = appointments.map(function (item) {
    const downloadButton = item.appointmentStatus === "APROBADA"
      ? '<button class="button subtle table-action" type="button" onclick="downloadAppointment(\'' + escapeAttribute(item.appointmentId) + '\')">Descargar</button>'
      : "";

    return [
      "<tr>",
      "<td>" + escapeHtml(item.slotDate) + "</td>",
      "<td>" + escapeHtml(item.slotLabel) + "</td>",
      "<td>" + escapeHtml(item.appointmentStatus) + "</td>",
      "<td>" + escapeHtml(item.ocNumber || "") + "</td>",
      "<td>" + downloadButton + "</td>",
      "</tr>"
    ].join("");
  }).join("");

  wrapper.innerHTML = [
    "<table>",
    "<thead><tr><th>Fecha</th><th>Hora</th><th>Estado</th><th>OC</th><th>Acci\u00f3n</th></tr></thead>",
    "<tbody>" + rows + "</tbody>",
    "</table>"
  ].join("");
}

async function requestAppointment() {
  if (!providerState || !sessionToken) {
    showMessage("Primero inicia sesi\u00f3n con una cuenta v\u00e1lida.", "error");
    return;
  }
  if (!selectedSlot) {
    showMessage("Selecciona un horario disponible.", "error");
    return;
  }

  try {
    const response = await api("requestAppointment", {
      sessionToken: sessionToken,
      providerId: providerState.providerId,
      startIso: selectedSlot.startIso,
      ocNumber: document.getElementById("appointmentOc").value,
      notes: document.getElementById("appointmentNotes").value
    });
    showMessage(response.message, "success");
    await refreshDashboard();
  } catch (error) {
    showMessage(error.message || "No pudimos registrar tu solicitud en este momento. Intenta nuevamente en unos minutos.", "error");
  }
}

function logout() {
  clearSession();
  resetProviderView();
  activateTab("loginPanel");
  showMessage("Tu sesi\u00f3n fue cerrada.", "success");
}

function clearSession() {
  sessionToken = "";
  localStorage.removeItem(SESSION_STORAGE_KEY);
}

function togglePanel(panelId) {
  const panel = document.getElementById(panelId);
  panel.classList.toggle("hidden");
}

function showGeneratedCode(vendorCode) {
  if (!vendorCode) {
    return;
  }
  const generatedCodeBox = document.getElementById("generatedCodeBox");
  generatedCodeBox.classList.remove("hidden");
  generatedCodeBox.innerHTML = [
    '<p class="eyebrow">C\u00d3DIGO GENERADO</p>',
    '<p><strong>' + escapeHtml(vendorCode) + "</strong></p>",
    "<p>Conserva este c\u00f3digo como referencia de tu cuenta dentro del portal.</p>"
  ].join("");
}

function downloadAppointment(appointmentId) {
  const appointment = appointmentsState.find(function (item) {
    return item.appointmentId === appointmentId;
  });

  if (!appointment) {
    showMessage("No se encontr\u00f3 la cita para descargar.", "error");
    return;
  }

  const content = [
    "<!DOCTYPE html>",
    '<html lang="es">',
    "<head>",
    '<meta charset="UTF-8">',
    "<title>Cita de proveedor</title>",
    "<style>",
    "body{font-family:Manrope,Arial,sans-serif;padding:32px;color:#1f1a14;background:#f5efe4;}",
    ".ticket{max-width:760px;margin:0 auto;border:1px solid #d8ccb6;border-radius:24px;padding:32px;background:#fffdf8;}",
    "h1{font-family:Georgia,serif;margin-top:0;font-size:38px;}",
    "table{width:100%;border-collapse:collapse;}",
    "td{padding:12px 0;border-bottom:1px solid #eee4d3;vertical-align:top;}",
    "</style>",
    "</head>",
    "<body>",
    '<div class="ticket">',
    "<h1>Constancia de cita</h1>",
    "<p>Atenci\u00f3n de proveedores - Grupo Santis</p>",
    "<table>",
    "<tr><td><strong>Proveedor</strong></td><td>" + escapeHtml(appointment.vendorName || providerState.vendorName) + "</td></tr>",
    "<tr><td><strong>C\u00f3digo de proveedor</strong></td><td>" + escapeHtml(appointment.vendorCode || providerState.vendorCode) + "</td></tr>",
    "<tr><td><strong>Fecha</strong></td><td>" + escapeHtml(appointment.slotDate) + "</td></tr>",
    "<tr><td><strong>Hora</strong></td><td>" + escapeHtml(appointment.slotLabel) + "</td></tr>",
    "<tr><td><strong>Estado</strong></td><td>" + escapeHtml(appointment.appointmentStatus) + "</td></tr>",
    "<tr><td><strong>OC</strong></td><td>" + escapeHtml(appointment.ocNumber || "No registrada") + "</td></tr>",
    "<tr><td><strong>Area</strong></td><td>" + escapeHtml(appointment.ocArea || "No registrada") + "</td></tr>",
    "<tr><td><strong>Resumen OC</strong></td><td>" + escapeHtml(appointment.ocItemsSummary || "No disponible") + "</td></tr>",
    "<tr><td><strong>C\u00f3digo de acceso</strong></td><td>" + escapeHtml(appointment.accessCode || "Revisa tu correo registrado") + "</td></tr>",
    "</table>",
    "</div>",
    "</body>",
    "</html>"
  ].join("");

  const blob = new Blob([content], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "cita-" + (appointment.slotDate || "proveedor") + ".html";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
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
  let data;

  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error("No pudimos completar la operaci\u00f3n en este momento. Intenta nuevamente en unos minutos.");
  }

  if (!response.ok || !data.ok) {
    throw new Error(normalizeUserError(data.error));
  }

  return data.data;
}

function formToObject(form) {
  const data = new FormData(form);
  return Object.fromEntries(data.entries());
}

function showMessage(text, type) {
  const box = document.getElementById("message");
  box.textContent = text;
  box.className = "message " + type;
}

function activateTab(panelId) {
  document.querySelectorAll("[data-tab-target]").forEach(function (button) {
    const isActive = button.getAttribute("data-tab-target") === panelId;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  });

  document.querySelectorAll("[data-tab-panel]").forEach(function (panel) {
    const isActive = panel.id === panelId;
    panel.classList.toggle("is-active", isActive);
    panel.hidden = !isActive;
  });
}

function normalizeUserError(message) {
  const value = String(message || "").toLowerCase();

  if (!value) {
    return "No se pudo completar la operaci\u00f3n. Intenta nuevamente en unos minutos.";
  }

  if (
    value.indexOf("json") >= 0 ||
    value.indexOf("apps script") >= 0 ||
    value.indexOf("backend") >= 0 ||
    value.indexOf("web app") >= 0 ||
    value.indexOf("upstream") >= 0
  ) {
    return "No pudimos cargar la disponibilidad en este momento. Intenta nuevamente en unos minutos.";
  }

  return message;
}

function resetProviderView() {
  providerState = null;
  appointmentsState = [];
  pendingPurchaseOrdersState = [];
  selectedSlot = null;
  document.getElementById("providerSummary").classList.add("hidden");
  document.getElementById("generatedCodeBox").classList.add("hidden");
  document.getElementById("appointmentPanel").classList.add("hidden");
  document.getElementById("appointmentsHistory").classList.add("hidden");
  document.getElementById("warnings").innerHTML = "";
  document.getElementById("emailRecoveryResult").classList.add("hidden");
  document.getElementById("logoutButton").classList.add("hidden");
  document.getElementById("appointmentOc").innerHTML = '<option value="">Selecciona una OC abierta</option>';
  document.getElementById("appointmentOcSummary").classList.add("hidden");
  document.getElementById("appointmentOcSummary").innerHTML = "";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
}
