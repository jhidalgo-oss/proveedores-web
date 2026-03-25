const API_BASE = "/api";

let boot = null;
let providerState = null;
let selectedSlot = null;

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
    showMessage(error.message || "No se pudo inicializar la pagina.", "error");
  }
}

async function submitRegistration(event) {
  event.preventDefault();
  const payload = formToObject(event.target);
  try {
    const response = await api("registerProvider", payload);
    showMessage(response.message, "success");
    document.getElementById("lookupForm").vendorCode.value = payload.vendorCode;
    document.getElementById("lookupForm").email.value = payload.email;
    await lookupProvider(payload.vendorCode, payload.email);
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
    providerState = null;
    document.getElementById("providerSummary").classList.add("hidden");
    document.getElementById("appointmentPanel").classList.add("hidden");
    document.getElementById("appointmentsHistory").classList.add("hidden");
    document.getElementById("warnings").innerHTML = "";
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
    providerState = null;
    document.getElementById("providerSummary").classList.add("hidden");
    document.getElementById("appointmentPanel").classList.add("hidden");
    document.getElementById("appointmentsHistory").classList.add("hidden");
    document.getElementById("warnings").innerHTML = "";
    showMessage(data.message || "Proveedor no encontrado.", "error");
    return;
  }

  providerState = data.provider;
  const summary = document.getElementById("providerSummary");
  summary.classList.remove("hidden");
  summary.innerHTML = `
    <div class="status status-${data.provider.registrationStatus.toLowerCase()}">${escapeHtml(data.provider.registrationStatus)}</div>
    <p><strong>${escapeHtml(data.provider.vendorName)}</strong></p>
    <p>Codigo: ${escapeHtml(data.provider.vendorCode)} | Correo: ${escapeHtml(data.provider.email)}</p>
  `;

  const warnings = document.getElementById("warnings");
  warnings.innerHTML = "";
  (data.warnings || []).forEach(function (warning) {
    const node = document.createElement("div");
    node.className = "note";
    node.textContent = warning;
    warnings.appendChild(node);
  });

  renderAppointments(data.appointments || []);

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
    card.innerHTML = `
      <div class="day-head">
        <h3>${escapeHtml(day.weekday)}</h3>
        <p>${escapeHtml(day.date)}</p>
      </div>
    `;

    const slots = document.createElement("div");
    slots.className = "slots";

    if (!day.slots.length) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "Sin atencion ese dia";
      slots.appendChild(empty);
    } else {
      day.slots.forEach(function (slot) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `slot slot-${slot.status.toLowerCase()}`;
        button.disabled = !slot.isSelectable;
        button.innerHTML = `<span>${escapeHtml(slot.label)}</span>`;
        button.addEventListener("click", function () {
          selectedSlot = slot;
          document.getElementById("selectedSlotLabel").textContent = `${slot.startIso} (${slot.label})`;
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
    wrapper.innerHTML = '<p class="muted">Aun no tienes citas registradas.</p>';
    return;
  }

  const rows = appointments.map(function (item) {
    return `
      <tr>
        <td>${escapeHtml(item.slotDate)}</td>
        <td>${escapeHtml(item.slotLabel)}</td>
        <td>${escapeHtml(item.appointmentStatus)}</td>
        <td>${escapeHtml(item.ocNumber || "")}</td>
      </tr>
    `;
  }).join("");

  wrapper.innerHTML = `
    <table>
      <thead>
        <tr><th>Fecha</th><th>Hora</th><th>Estado</th><th>OC</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

async function requestAppointment() {
  if (!providerState) {
    showMessage("Primero consulta tu proveedor.", "error");
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

async function api(action, payload) {
  const response = await fetch(`${API_BASE}/${action}`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload || {})
  });

  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.error || "No se pudo completar la operacion.");
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
  box.className = `message ${type}`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
