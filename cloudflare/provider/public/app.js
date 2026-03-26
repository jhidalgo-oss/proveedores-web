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
  [
    "registerForm",
    "lookupForm",
    "passwordRecoveryRequestForm",
    "passwordResetForm",
    "emailRecoveryForm"
  ].forEach(function (formId) {
    document.getElementById(formId).addEventListener("invalid", handleFormInvalid, true);
  });

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
  document.getElementById("appointmentOcSearch").addEventListener("input", renderPendingPurchaseOrders);
  document.querySelector('#registerForm input[name="ocNumber"]').addEventListener("blur", lookupRegistrationVendor);
  document.querySelector('#registerForm input[name="ocNumber"]').addEventListener("input", resetRegistrationLookupState);
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
    await refreshDashboard({ resetOnMissing: true });
  } catch (error) {
    clearSession();
    resetProviderView();
  }
}

async function submitRegistration(event) {
  event.preventDefault();
  const payload = formToObject(event.target);
  const releaseBusy = setBusyState(getSubmitButton(event), true);
  showMessage("Procesando tu registro...", "loading");

  try {
    const response = await api("registerProvider", payload);
    handleAuthenticatedResponse(response);
    showGeneratedCode(response.provider ? response.provider.vendorCode : "");
    activateTab("loginPanel");
    document.getElementById("lookupForm").email.value = payload.email || "";
    document.getElementById("lookupForm").password.value = payload.password || "";
    if (response.provider && response.provider.registrationStatus === "APROBADO") {
      if (response.dashboard) {
        showMessage("Cuenta creada e ingreso correcto.", "success");
      } else {
        showMessage("Cuenta creada. Cargando tus datos...", "loading");
        try {
          await refreshDashboard({ preserveShell: true });
          showMessage("Cuenta creada e ingreso correcto.", "success");
        } catch (error) {
          showMessage("Tu cuenta fue creada y tu sesi\u00f3n est\u00e1 activa, pero no pudimos cargar todo el panel en este momento. Intenta actualizar nuevamente.", "error");
        }
      }
      return;
    }
    showMessage(response.message, "success");
  } catch (error) {
    showMessage(error.message || "No pudimos completar tu registro en este momento. Intenta nuevamente en unos minutos.", "error");
  } finally {
    releaseBusy();
  }
}

async function lookupRegistrationVendor() {
  const form = document.getElementById("registerForm");
  const ocInput = form.querySelector('input[name="ocNumber"]');
  const vendorNameInput = form.querySelector('input[name="vendorName"]');
  const vendorNameResult = document.getElementById("vendorNameResult");
  const status = document.getElementById("registerLookupStatus");
  const ocNumber = String(ocInput.value || "").trim();

  if (!ocNumber) {
    vendorNameInput.value = "";
    vendorNameResult.textContent = "Se completará al validar la OC.";
    status.textContent = "";
    return;
  }

  status.textContent = "Validando OC...";

  try {
    const response = await api("lookupRegistrationByTaxId", { ocNumber });
    if (!response.found) {
      vendorNameInput.value = "";
      vendorNameResult.textContent = "No encontramos una razón social disponible para esa OC.";
      status.textContent = response.message || "No encontramos OCs abiertas para esa OC.";
      return;
    }

    vendorNameInput.value = response.vendorName || "";
    ocInput.value = response.ocNumber || ocNumber;
    vendorNameResult.textContent = response.vendorName || "Razón social encontrada.";
    status.textContent = "Razón social encontrada. OCs abiertas: " + String(response.openOrders || 0) + ".";
  } catch (error) {
    vendorNameInput.value = "";
    vendorNameResult.textContent = "No pudimos validar la OC en este momento.";
    status.textContent = error.message || "No pudimos validar la OC en este momento.";
  }
}

function resetRegistrationLookupState() {
  const form = document.getElementById("registerForm");
  form.querySelector('input[name="vendorName"]').value = "";
  document.getElementById("vendorNameResult").textContent = "Se completará al validar la OC.";
  document.getElementById("registerLookupStatus").textContent = "";
}

async function submitLogin(event) {
  event.preventDefault();
  const payload = formToObject(event.target);
  const releaseBusy = setBusyState(getSubmitButton(event), true);
  showMessage("Validando tu acceso...", "loading");

  try {
    const response = await api("providerLogin", payload);
    handleAuthenticatedResponse(response);
    if (response.dashboard) {
      showMessage("Ingreso correcto.", "success");
    } else {
      showMessage("Ingreso correcto. Cargando tus datos...", "loading");
      try {
        await refreshDashboard({ preserveShell: true });
        showMessage("Ingreso correcto.", "success");
      } catch (error) {
        showMessage("Ingresaste correctamente, pero no pudimos cargar todo tu panel en este momento. Intenta actualizar nuevamente.", "error");
      }
    }
  } catch (error) {
    showMessage(error.message || "No pudimos iniciar sesi\u00f3n en este momento.", "error");
  } finally {
    releaseBusy();
  }
}

async function submitPasswordRecoveryRequest(event) {
  event.preventDefault();
  const payload = formToObject(event.target);
  const releaseBusy = setBusyState(getSubmitButton(event), true);
  showMessage("Enviando solicitud de recuperacion...", "loading");

  try {
    const response = await api("requestPasswordReset", payload);
    showMessage(response.message, "success");
  } catch (error) {
    showMessage(error.message || "No pudimos procesar la recuperaci\u00f3n en este momento.", "error");
  } finally {
    releaseBusy();
  }
}

async function submitPasswordReset(event) {
  event.preventDefault();
  const payload = formToObject(event.target);
  const releaseBusy = setBusyState(getSubmitButton(event), true);
  showMessage("Actualizando tu contrasena...", "loading");

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
  } finally {
    releaseBusy();
  }
}

async function submitEmailRecovery(event) {
  event.preventDefault();
  const payload = formToObject(event.target);
  const releaseBusy = setBusyState(getSubmitButton(event), true);
  showMessage("Consultando tu correo asociado...", "loading");

  try {
    const response = await api("recoverEmailByTaxId", payload);
    const result = document.getElementById("emailRecoveryResult");
    result.classList.remove("hidden");
    result.innerHTML = "<p><strong>" + escapeHtml(response.maskedEmail) + "</strong></p><p>" + escapeHtml(response.message) + "</p>";
    showMessage("Consulta realizada correctamente.", "success");
  } catch (error) {
    showMessage(error.message || "No pudimos recuperar el correo en este momento.", "error");
  } finally {
    releaseBusy();
  }
}

function handleAuthenticatedResponse(response) {
  sessionToken = response.sessionToken || "";
  if (sessionToken) {
    localStorage.setItem(SESSION_STORAGE_KEY, sessionToken);
  }
  if (response.provider) {
    renderAuthenticatedShell(response.provider);
  }
  if (response.dashboard) {
    renderDashboard(response.dashboard);
  }
  document.getElementById("logoutButton").classList.remove("hidden");
}

async function refreshDashboard(options) {
  options = options || {};
  if (!sessionToken) {
    return;
  }

  const data = await api("providerDashboard", {
    sessionToken: sessionToken,
    startDate: boot && boot.today ? boot.today : null
  });
  renderDashboard(data, options);
}

function renderDashboard(data, options) {
  options = options || {};
  if (!data.found) {
    if (options.preserveShell && providerState && sessionToken) {
      collapseDashboardPanels();
      renderPersistentWarning(data.message || "No pudimos terminar de cargar tu panel en este momento. Intenta actualizar nuevamente.");
      showMessage("Tu sesi\u00f3n sigue activa, pero no pudimos cargar todo el panel en este momento. Intenta actualizar nuevamente.", "error");
      return;
    }

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
  document.getElementById("guestAccessBlock").classList.add("hidden");
  document.getElementById("accountPanel").classList.remove("hidden");

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
  renderPendingPurchaseOrders();

  const panel = document.getElementById("appointmentPanel");
  if (data.canRequestAppointments && data.calendar) {
    panel.classList.remove("hidden");
    renderCalendar(data.calendar);
  } else {
    panel.classList.add("hidden");
  }
}

function renderAuthenticatedShell(provider) {
  if (!provider) {
    return;
  }
  activateTab("loginPanel");
  setAccessAuthenticatedMode(true);
  providerState = provider;
  document.getElementById("guestAccessBlock").classList.add("hidden");
  document.getElementById("accountPanel").classList.remove("hidden");
  const summary = document.getElementById("providerSummary");
  summary.classList.remove("hidden");
  summary.innerHTML = [
    '<div class="status status-' + String(provider.registrationStatus || "pendiente").toLowerCase() + '">' + escapeHtml(provider.registrationStatus || "PENDIENTE") + "</div>",
    "<p><strong>" + escapeHtml(provider.vendorName || "") + "</strong></p>",
    "<p>C\u00f3digo de proveedor: " + escapeHtml(provider.vendorCode || "") + " | Correo: " + escapeHtml(provider.email || "") + "</p>"
  ].join("");
  renderPersistentWarning("");
}

function renderPendingPurchaseOrders() {
  const openOrders = pendingPurchaseOrdersState || [];
  const select = document.getElementById("appointmentOc");
  const summary = document.getElementById("appointmentOcSummary");
  const searchValue = String(document.getElementById("appointmentOcSearch").value || "").trim().toLowerCase();
  const currentValue = select.value;
  select.innerHTML = '<option value="">Selecciona una OC abierta</option>';

  const filteredOrders = openOrders.filter(function (order) {
    if (!searchValue) {
      return true;
    }
    const haystack = [
      order.poNumber,
      order.area,
      order.areaCodes,
      order.itemGroups,
      order.buyerName,
      order.itemsSummary,
      order.deliveryDate
    ].join(" ").toLowerCase();
    return haystack.indexOf(searchValue) >= 0;
  });

  filteredOrders.forEach(function (order) {
    const option = document.createElement("option");
    option.value = order.poNumber;
    option.textContent = order.poNumber + " | " + (order.area || "Sin area") + " | " + (order.itemsSummary || "Sin detalle");
    select.appendChild(option);
  });

  if (filteredOrders.some(function (order) { return order.poNumber === currentValue; })) {
    select.value = currentValue;
  }

  if (!openOrders.length) {
    summary.classList.remove("hidden");
    summary.innerHTML = "<p>No tienes OCs abiertas habilitadas para solicitar cita. La OC debe tener area y material definidos en SAP.</p>";
    return;
  }

  if (openOrders.length && !filteredOrders.length) {
    summary.classList.remove("hidden");
    summary.innerHTML = "<p>No encontramos OCs que coincidan con tu b\u00fasqueda.</p>";
    return;
  }

  renderSelectedPurchaseOrderSummary();
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
    "<p><strong>Ubicaci\u00f3n SAP:</strong> " + escapeHtml(selected.areaCodes || selected.storageLocation || "No definida") + "</p>",
    "<p><strong>Fecha entrega:</strong> " + escapeHtml(selected.deliveryDate || "Sin fecha") + "</p>",
    "<p><strong>Grupo:</strong> " + escapeHtml(selected.itemGroups || "Sin definir") + "</p>",
    "<p><strong>Pendiente:</strong> " + escapeHtml(formatQuantity(selected.openQtyTotal, selected.totalUom) || "Sin dato") + "</p>",
    "<p><strong>Lineas:</strong> " + escapeHtml(String(selected.lineCount || 0)) + "</p>",
    "<p><strong>Resumen:</strong> " + escapeHtml(selected.itemsSummary || "Sin detalle de materiales") + "</p>"
  ].join("");
}

function formatQuantity(value, uom) {
  const numeric = Number(value || 0);
  if (!numeric) {
    return "";
  }
  const normalized = String(Math.round(numeric * 100) / 100)
    .replace(/\.0+$/, "")
    .replace(/(\.\d*[1-9])0+$/, "$1");
  return uom ? normalized + " " + uom : normalized;
}

function renderCalendar(calendar) {
  const wrapper = document.getElementById("calendar");
  wrapper.innerHTML = "";
  wrapper.classList.add("provider-agenda");

  groupCalendarWeeks(calendar.days || []).forEach(function (week) {
    const weekNode = document.createElement("section");
    weekNode.className = "agenda-week";

    const head = document.createElement("div");
    head.className = "agenda-week-head";
    head.innerHTML = [
      "<span class=\"eyebrow\">SEMANA</span>",
      "<p>" + escapeHtml(week.label) + "</p>"
    ].join("");
    weekNode.appendChild(head);

    const grid = document.createElement("div");
    grid.className = "agenda-grid";
    grid.style.gridTemplateColumns = "88px repeat(" + week.days.length + ", minmax(0, 1fr))";

    const corner = document.createElement("div");
    corner.className = "agenda-corner";
    corner.textContent = "Hora";
    grid.appendChild(corner);

    week.days.forEach(function (day) {
      const dayHead = document.createElement("div");
      dayHead.className = "agenda-day-head";
      dayHead.innerHTML = [
        "<strong>" + escapeHtml(day.weekday) + "</strong>",
        "<span>" + escapeHtml(day.date) + "</span>"
      ].join("");
      grid.appendChild(dayHead);
    });

    buildWeekTimeRows(week.days).forEach(function (row) {
      const timeCell = document.createElement("div");
      timeCell.className = "agenda-time";
      timeCell.textContent = row.timeLabel;
      grid.appendChild(timeCell);

      week.days.forEach(function (day) {
        const slot = row.byDate[day.date] || null;
        const cell = document.createElement("div");
        cell.className = "agenda-cell";

        if (!slot) {
          cell.innerHTML = '<span class="agenda-empty">-</span>';
          grid.appendChild(cell);
          return;
        }

        const button = document.createElement("button");
        button.type = "button";
        button.className = "slot agenda-slot slot-" + String(slot.status || "available").toLowerCase();
        button.disabled = !slot.isSelectable;
        button.innerHTML = "<span>" + escapeHtml(getAgendaSlotLabel(slot)) + "</span>";
        if (selectedSlot && selectedSlot.startIso === slot.startIso) {
          button.classList.add("selected");
        }
        button.addEventListener("click", function () {
          selectedSlot = slot;
          document.getElementById("selectedSlotLabel").textContent = slot.startIso + " (" + slot.label + ")";
          document.querySelectorAll(".agenda-slot.selected").forEach(function (node) {
            node.classList.remove("selected");
          });
          button.classList.add("selected");
        });
        cell.appendChild(button);
        grid.appendChild(cell);
      });
    });

    weekNode.appendChild(grid);
    wrapper.appendChild(weekNode);
  });
}

function groupCalendarWeeks(days) {
  const weeks = [];
  for (let index = 0; index < days.length; index += 7) {
    const weekDays = days.slice(index, index + 7);
    if (!weekDays.length) {
      continue;
    }
    weeks.push({
      days: weekDays,
      label: weekDays[0].date + " al " + weekDays[weekDays.length - 1].date
    });
  }
  return weeks;
}

function buildWeekTimeRows(days) {
  const rowMap = {};

  days.forEach(function (day) {
    (day.slots || []).forEach(function (slot) {
      const timeKey = getSlotTimeKey(slot.startIso);
      if (!rowMap[timeKey]) {
        rowMap[timeKey] = {
          timeKey: timeKey,
          timeLabel: timeKey,
          byDate: {}
        };
      }
      rowMap[timeKey].byDate[day.date] = slot;
    });
  });

  return Object.keys(rowMap)
    .sort()
    .map(function (key) {
      return rowMap[key];
    });
}

function getSlotTimeKey(startIso) {
  return String(startIso || "").slice(11, 16);
}

function getAgendaSlotLabel(slot) {
  if (slot.status === "AVAILABLE") {
    return "Disponible";
  }
  if (slot.status === "PENDING") {
    return "Pendiente";
  }
  if (slot.status === "APPROVED") {
    return "Tomado";
  }
  return slot.label || "";
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

  const releaseBusy = setBusyState(document.getElementById("requestAppointmentButton"), true);
  showMessage("Registrando tu solicitud de cita...", "loading");

  try {
    const response = await api("requestAppointment", {
      sessionToken: sessionToken,
      providerId: providerState.providerId,
      startIso: selectedSlot.startIso,
      ocNumber: document.getElementById("appointmentOc").value,
      notes: document.getElementById("appointmentNotes").value
    });
    showMessage(response.message, "success");
    try {
      await refreshDashboard({ preserveShell: true });
    } catch (error) {
      showMessage(response.message + " Si no ves el cambio de inmediato, actualiza el panel nuevamente.", "success");
    }
  } catch (error) {
    showMessage(error.message || "No pudimos registrar tu solicitud en este momento. Intenta nuevamente en unos minutos.", "error");
  } finally {
    releaseBusy();
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

function handleFormInvalid(event) {
  if (!event.target || typeof event.target.reportValidity !== "function") {
    return;
  }
  showMessage("Revisa los campos obligatorios antes de continuar.", "error");
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

function showGeneratedCode(vendorCode) {
  if (!vendorCode) {
    return;
  }
  document.getElementById("accountPanel").classList.remove("hidden");
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
    throw new Error(defaultActionError(action));
  }

  if (!response.ok || !data.ok) {
    throw new Error(normalizeUserError(data.error, action));
  }

  return data.data;
}

function formToObject(form) {
  const data = new FormData(form);
  return Object.fromEntries(data.entries());
}

function showMessage(text, type) {
  ["message", "accessMessage"].forEach(function (id) {
    const box = document.getElementById(id);
    if (!box) {
      return;
    }
    box.textContent = text;
    box.className = "message " + type;
  });

  const accessBox = document.getElementById("accessMessage");
  if (accessBox && typeof accessBox.scrollIntoView === "function") {
    accessBox.scrollIntoView({
      behavior: "smooth",
      block: "nearest"
    });
  }
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

  const panel = document.getElementById(panelId);
  if (panel && typeof panel.scrollIntoView === "function") {
    panel.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }
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
    case "providerBootstrap":
    case "providerDashboard":
      return "No pudimos cargar la disponibilidad en este momento. Intenta nuevamente en unos minutos.";
    case "registerProvider":
      return "No pudimos validar tu registro en este momento. Intenta nuevamente en unos minutos.";
    case "lookupRegistrationByTaxId":
      return "No pudimos validar la OC en este momento. Intenta nuevamente en unos minutos.";
    case "lookupProviderReference":
      return "No pudimos consultar esa referencia en este momento. Intenta nuevamente en unos minutos.";
    case "providerLogin":
      return "No pudimos iniciar sesión en este momento. Intenta nuevamente en unos minutos.";
    case "requestAppointment":
      return "No pudimos registrar tu solicitud en este momento. Intenta nuevamente en unos minutos.";
    default:
      return "No se pudo completar la operación. Intenta nuevamente en unos minutos.";
  }
}

function resetProviderView() {
  providerState = null;
  appointmentsState = [];
  pendingPurchaseOrdersState = [];
  selectedSlot = null;
  setAccessAuthenticatedMode(false);
  document.getElementById("guestAccessBlock").classList.remove("hidden");
  document.getElementById("accountPanel").classList.add("hidden");
  document.getElementById("providerSummary").classList.add("hidden");
  document.getElementById("generatedCodeBox").classList.add("hidden");
  document.getElementById("appointmentPanel").classList.add("hidden");
  document.getElementById("appointmentsHistory").classList.add("hidden");
  document.getElementById("warnings").innerHTML = "";
  document.getElementById("emailRecoveryResult").classList.add("hidden");
  document.getElementById("lookupForm").reset();
  document.getElementById("passwordRecoveryRequestForm").reset();
  document.getElementById("passwordResetForm").reset();
  document.getElementById("emailRecoveryForm").reset();
  document.getElementById("passwordRecoveryPanel").classList.add("hidden");
  document.getElementById("emailRecoveryPanel").classList.add("hidden");
  document.getElementById("appointmentOc").innerHTML = '<option value="">Selecciona una OC abierta</option>';
  document.getElementById("appointmentOcSearch").value = "";
  document.getElementById("appointmentOcSummary").classList.add("hidden");
  document.getElementById("appointmentOcSummary").innerHTML = "";
  renderPersistentWarning("");
}

function setAccessAuthenticatedMode(isAuthenticated) {
  const accessIntro = document.getElementById("accessIntro");
  const accessTabs = document.getElementById("accessTabs");
  const registerPanel = document.getElementById("registerPanel");
  const guestAccessBlock = document.getElementById("guestAccessBlock");

  if (accessIntro) {
    accessIntro.classList.toggle("hidden", isAuthenticated);
  }
  if (accessTabs) {
    accessTabs.classList.toggle("hidden", isAuthenticated);
  }
  if (registerPanel) {
    registerPanel.classList.toggle("hidden", isAuthenticated);
    registerPanel.hidden = Boolean(isAuthenticated);
    registerPanel.classList.remove("is-active");
  }
  if (guestAccessBlock) {
    guestAccessBlock.classList.toggle("hidden", isAuthenticated);
  }

  if (!isAuthenticated) {
    activateTab("loginPanel");
  }
}

function collapseDashboardPanels() {
  appointmentsState = [];
  pendingPurchaseOrdersState = [];
  selectedSlot = null;
  document.getElementById("appointmentPanel").classList.add("hidden");
  document.getElementById("appointmentsHistory").classList.add("hidden");
  document.getElementById("appointmentOc").innerHTML = '<option value="">Selecciona una OC abierta</option>';
  document.getElementById("appointmentOcSearch").value = "";
  document.getElementById("appointmentOcSummary").classList.add("hidden");
  document.getElementById("appointmentOcSummary").innerHTML = "";
}

function renderPersistentWarning(message) {
  const warnings = document.getElementById("warnings");
  if (!warnings) {
    return;
  }
  warnings.innerHTML = "";
  if (!message) {
    return;
  }
  const node = document.createElement("div");
  node.className = "note";
  node.textContent = message;
  warnings.appendChild(node);
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
