const API_BASE = "/api";

let boot = null;
let providerState = null;
let selectedSlot = null;
let appointmentsState = [];

document.addEventListener("DOMContentLoaded", async function () {
  wireEvents();
  await loadBootstrap();
});

function wireEvents() {
  document.getElementById("registerForm").addEventListener("submit", submitRegistration);
  document.getElementById("lookupForm").addEventListener("submit", submitLookup);
  document.getElementById("refreshCalendar").addEventListener("click", refreshDashboard);
  document.getElementById("requestAppointmentButton").addEventListener("click", requestAppointment);
}

async function loadBootstrap() {
  try {
    boot = await api("providerBootstrap", {});
  } catch (error) {
    showMessage(error.message || "No se pudo inicializar la p\u00e1gina.", "error");
  }
}

async function submitRegistration(event) {
  event.preventDefault();
  const payload = formToObject(event.target);

  try {
    const response = await api("registerProvider", payload);
    showMessage(response.message, "success");

    const generatedCodeBox = document.getElementById("generatedCodeBox");
    generatedCodeBox.classList.remove("hidden");
    generatedCodeBox.innerHTML = [
      '<p class="eyebrow">C\u00d3DIGO GENERADO</p>',
      '<p><strong>' + escapeHtml(response.provider.vendorCode) + '</strong></p>',
      '<p>Guarda este c\u00f3digo. Lo usar\u00e1s junto con tu correo para volver a ingresar.</p>'
    ].join("");

    document.getElementById("lookupForm").vendorCode.value = response.provider.vendorCode;
    document.getElementById("lookupForm").email.value = response.provider.email;
    await lookupProvider(response.provider.vendorCode, response.provider.email);
  } catch (error) {
    showMessage(error.message, "error");
  }
}

async function submitLookup(event) {
  event.preventDefault();
  await lookupProvider(event.target.vendorCode.value, event.target.email.value);
}

async function lookupProvider(vendorCode, email) {
  selectedSlot = null;
  document.getElementById("selectedSlotLabel").textContent = "Ninguna";

  try {
    const data = await api("providerDashboard", {
      vendorCode: vendorCode,
      email: email,
      startDate: boot && boot.today ? boot.today : null
    });
    renderDashboard(data);
  } catch (error) {
    resetProviderView();
    showMessage(error.message, "error");
  }
}

async function refreshDashboard() {
  if (!providerState) {
    return;
  }
  await lookupProvider(providerState.vendorCode, providerState.email);
}

function renderDashboard(data) {
  if (!data.found) {
    resetProviderView();
    showMessage(data.message || "Proveedor no encontrado.", "error");
    return;
  }

  providerState = data.provider;
  appointmentsState = data.appointments || [];

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

  const panel = document.getElementById("appointmentPanel");
  if (data.canRequestAppointments && data.calendar) {
    panel.classList.remove("hidden");
    renderCalendar(data.calendar);
  } else {
    panel.classList.add("hidden");
  }
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
  if (!providerState) {
    showMessage("Primero inicia sesi\u00f3n con tu c\u00f3digo y correo.", "error");
    return;
  }
  if (!selectedSlot) {
    showMessage("Selecciona un horario disponible.", "error");
    return;
  }

  try {
    const response = await api("requestAppointment", {
      providerId: providerState.providerId,
      vendorCode: providerState.vendorCode,
      email: providerState.email,
      startIso: selectedSlot.startIso,
      ocNumber: document.getElementById("appointmentOc").value,
      notes: document.getElementById("appointmentNotes").value
    });
    showMessage(response.message, "success");
    await refreshDashboard();
  } catch (error) {
    showMessage(error.message, "error");
  }
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
    throw new Error("El servicio no respondi\u00f3 correctamente. Verifica la publicaci\u00f3n del backend de Apps Script.");
  }

  if (!response.ok || !data.ok) {
    throw new Error(data.error || "No se pudo completar la operaci\u00f3n.");
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

function resetProviderView() {
  providerState = null;
  appointmentsState = [];
  document.getElementById("providerSummary").classList.add("hidden");
  document.getElementById("generatedCodeBox").classList.add("hidden");
  document.getElementById("appointmentPanel").classList.add("hidden");
  document.getElementById("appointmentsHistory").classList.add("hidden");
  document.getElementById("warnings").innerHTML = "";
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
