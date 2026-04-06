const API_BASE = "/api";
const SESSION_STORAGE_KEY = "providerPortalSessionToken";
const ACCESS_STORAGE_KEY = "providerPortalAccessSnapshot";

let boot = null;
let providerState = null;
let currentAccess = null;
let selectedSlot = null;
let appointmentsState = [];
let pendingPurchaseOrdersState = [];
let sessionToken = "";
let currentCalendarWeeks = [];
let currentWeekIndex = 0;
let messageHideTimer = null;
let requestAppointmentInFlight = false;
let requestAppointmentRunId = 0;

document.addEventListener("DOMContentLoaded", async function () {
  wireEvents();
  await loadBootstrap();
  resetProviderView();
  await restorePersistedSession();
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
  document.getElementById("appointmentDuration").addEventListener("change", handleDurationChange);
  document.getElementById("appointmentNotes").addEventListener("input", updateRequestAvailabilityState);
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
    const durationSelect = document.getElementById("appointmentDuration");
    if (durationSelect && boot && boot.config && boot.config.slotMinutes) {
      durationSelect.value = String(boot.config.slotMinutes);
    }
    renderDurationHint();
  } catch (error) {
    console.warn(error);
  }
}

async function restorePersistedSession() {
  const persistedToken = getActiveSessionToken();
  if (!persistedToken) {
    return;
  }

  sessionToken = persistedToken;
  try {
    const dashboard = await refreshDashboard();
    if (dashboard && dashboard.found) {
      hideGlobalMessage();
      hideAccessMessage();
      return;
    }
  } catch (error) {
    console.warn("No pudimos restaurar la sesion persistida.", error);
  }

  clearSession();
  resetProviderView();
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
      if (hasRenderableDashboard(response.dashboard)) {
        showMessage("Cuenta creada e ingreso correcto.", "success");
      } else {
        clearSession();
        resetProviderView();
        showMessage("Tu cuenta fue creada, pero no pudimos abrir tu panel en este momento. Intenta nuevamente.", "error");
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
    if (hasRenderableDashboard(response.dashboard)) {
      hideGlobalMessage();
      hideAccessMessage();
    } else {
      clearSession();
      resetProviderView();
      showMessage("No pudimos abrir tu panel en este momento. Intenta nuevamente.", "error");
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
    setCurrentAccess(response.provider, sessionToken);
  }
  if (response.provider) {
    renderAuthenticatedShell(response.provider);
  }
  if (hasRenderableDashboard(response.dashboard)) {
    renderDashboard(response.dashboard);
  }
  document.getElementById("logoutButton").classList.remove("hidden");
}

async function refreshDashboard(options) {
  options = options || {};
  const activeToken = getActiveSessionToken();
  if (!activeToken) {
    return null;
  }
  sessionToken = activeToken;

  const data = await api("providerDashboard", {
    sessionToken: activeToken,
    startDate: boot && boot.today ? boot.today : null
  });
  renderDashboard(data, options);
  return data;
}

function renderDashboard(data, options) {
  options = options || {};
  if (!data.found) {
    if (providerState) {
      collapseDashboardPanels();
      renderPersistentWarning(data.message || "No pudimos terminar de cargar tu panel en este momento. Intenta actualizar nuevamente.");
      showMessage("Tu sesi\u00f3n sigue activa, pero no pudimos actualizar el panel en este momento. Intenta nuevamente.", "error");
      return;
    }

    clearSession();
    resetProviderView();
    showMessage(data.message || "No encontramos tu cuenta.", "error");
    return;
  }

  activateTab("loginPanel");
  setAccessAuthenticatedMode(true);
  renderRequestFeedback("", "");
  providerState = data.provider;
  setCurrentAccess(data.provider, sessionToken);
  appointmentsState = data.appointments || [];
  pendingPurchaseOrdersState = data.pendingPurchaseOrders || [];
  selectedSlot = null;
  currentCalendarWeeks = [];
  currentWeekIndex = 0;
  document.getElementById("selectedSlotLabel").textContent = "Ninguna";
  renderDurationHint();
  document.getElementById("guestAccessBlock").classList.add("hidden");
  document.getElementById("accountPanel").classList.remove("hidden");
  syncAccountIdentity(data.provider);

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
  updateRequestAvailabilityState();

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
  renderRequestFeedback("", "");
  providerState = provider;
  setCurrentAccess(provider, sessionToken);
  document.getElementById("guestAccessBlock").classList.add("hidden");
  document.getElementById("accountPanel").classList.remove("hidden");
  syncAccountIdentity(provider);
  const summary = document.getElementById("providerSummary");
  summary.classList.remove("hidden");
  summary.innerHTML = [
    '<div class="status status-' + String(provider.registrationStatus || "pendiente").toLowerCase() + '">' + escapeHtml(provider.registrationStatus || "PENDIENTE") + "</div>",
    "<p><strong>" + escapeHtml(provider.vendorName || "") + "</strong></p>",
    "<p>C\u00f3digo de proveedor: " + escapeHtml(provider.vendorCode || "") + " | Correo: " + escapeHtml(provider.email || "") + "</p>"
  ].join("");
  renderPersistentWarning("");
  updateRequestAvailabilityState();
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
  } else if (!currentValue && filteredOrders.length) {
    select.value = filteredOrders[0].poNumber;
  }

  if (!openOrders.length) {
    summary.classList.remove("hidden");
    summary.innerHTML = "<p>No tienes OCs abiertas habilitadas para solicitar cita. La OC debe tener area y material definidos en SAP.</p>";
    updateRequestAvailabilityState();
    return;
  }

  if (openOrders.length && !filteredOrders.length) {
    summary.classList.remove("hidden");
    summary.innerHTML = "<p>No encontramos OCs que coincidan con tu b\u00fasqueda.</p>";
    updateRequestAvailabilityState();
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
    renderRequestFeedback("", "");
    updateRequestAvailabilityState();
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
  renderRequestFeedback("", "");
  updateRequestAvailabilityState();
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
  currentCalendarWeeks = groupCalendarWeeks(calendar.days || []);
  currentWeekIndex = normalizeWeekIndex(currentWeekIndex, currentCalendarWeeks.length);
  renderCurrentCalendarWeek();
}

function handleDurationChange() {
  const durationMinutes = getSelectedDurationMinutes();
  const hadSelection = Boolean(selectedSlot);
  const selectedStillValid = selectedSlot && isSlotRangeSelectable(selectedSlot.startIso, durationMinutes);
  if (!selectedStillValid) {
    selectedSlot = null;
    document.getElementById("selectedSlotLabel").textContent = "Ninguna";
    if (hadSelection) {
      showMessage("La nueva duración ya no cabe en el horario que habías elegido. Selecciona otro inicio.", "error");
    }
  } else {
    updateSelectedSlotLabel();
  }
  renderDurationHint();
  renderCurrentCalendarWeek();
  updateRequestAvailabilityState();
}

function renderCurrentCalendarWeek() {
  const wrapper = document.getElementById("calendar");
  if (!wrapper) {
    return;
  }

  wrapper.innerHTML = "";

  if (!currentCalendarWeeks.length) {
    wrapper.innerHTML = '<div class="agenda-empty-state">No hay disponibilidad publicada para esta semana.</div>';
    return;
  }

  const week = currentCalendarWeeks[currentWeekIndex];
  const weekNode = document.createElement("section");
  weekNode.className = "agenda-week";

  const head = document.createElement("div");
  head.className = "agenda-week-head";

  const weekMeta = document.createElement("div");
  weekMeta.className = "agenda-week-meta";
  weekMeta.innerHTML = [
    '<span class="eyebrow">SEMANA ' + escapeHtml(String(week.weekNumber)) + "</span>",
    "<p>" + escapeHtml(week.label) + "</p>"
  ].join("");

  const weekNav = document.createElement("div");
  weekNav.className = "agenda-week-nav";

  const prevButton = document.createElement("button");
  prevButton.type = "button";
  prevButton.className = "button subtle agenda-nav-button";
  prevButton.textContent = "Anterior";
  prevButton.disabled = currentWeekIndex === 0;
  prevButton.addEventListener("click", function () {
    currentWeekIndex = normalizeWeekIndex(currentWeekIndex - 1, currentCalendarWeeks.length);
    renderCurrentCalendarWeek();
  });

  const nextButton = document.createElement("button");
  nextButton.type = "button";
  nextButton.className = "button subtle agenda-nav-button";
  nextButton.textContent = "Siguiente";
  nextButton.disabled = currentWeekIndex >= currentCalendarWeeks.length - 1;
  nextButton.addEventListener("click", function () {
    currentWeekIndex = normalizeWeekIndex(currentWeekIndex + 1, currentCalendarWeeks.length);
    renderCurrentCalendarWeek();
  });

  weekNav.appendChild(prevButton);
  weekNav.appendChild(nextButton);
  head.appendChild(weekMeta);
  head.appendChild(weekNav);
  weekNode.appendChild(head);

  const grid = document.createElement("div");
  grid.className = "agenda-grid";
  grid.style.gridTemplateColumns = "72px repeat(" + week.days.length + ", minmax(0, 1fr))";

  const corner = document.createElement("div");
  corner.className = "agenda-corner";
  corner.textContent = "Hora Inicio";
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
        cell.innerHTML = '<span class="agenda-empty"></span>';
        grid.appendChild(cell);
        return;
      }

      const button = document.createElement("button");
      button.type = "button";
      const durationMinutes = getSelectedDurationMinutes();
      const supportsDuration = slot.status === "AVAILABLE" && canSlotSupportDuration(day, slot, durationMinutes);
      const rangeSelection = getRangeSelectionState(day, slot, durationMinutes);
      const visualStatus = slot.status === "AVAILABLE" && !supportsDuration ? "range" : String(slot.status || "available").toLowerCase();
      button.className = "slot agenda-slot slot-" + visualStatus;
      button.disabled = !supportsDuration;
      button.title = buildAgendaSlotTitle(day, slot, supportsDuration, durationMinutes);
      button.setAttribute("aria-label", buildAgendaSlotTitle(day, slot, supportsDuration, durationMinutes));
      button.innerHTML = buildAgendaSlotInnerHtml(day, slot, supportsDuration, durationMinutes, rangeSelection);
      if (rangeSelection.inRange) {
        button.classList.add("selected-range");
      }
      if (rangeSelection.isSingle) {
        button.classList.add("selected", "selected-single");
      } else {
        if (rangeSelection.isStart) {
          button.classList.add("selected", "selected-start");
        }
        if (rangeSelection.isMiddle) {
          button.classList.add("selected-middle");
        }
      if (rangeSelection.isEnd) {
        button.classList.add("selected-end");
      }
    }
    button.addEventListener("click", function () {
        if (!supportsDuration) {
          showMessage("Ese inicio no tiene tiempo continuo suficiente para la descarga estimada.", "error");
          return;
      }
      renderRequestFeedback("", "");
      selectedSlot = slot;
      updateSelectedSlotLabel();
      renderCurrentCalendarWeek();
      updateRequestAvailabilityState();
    });
    cell.appendChild(button);
    grid.appendChild(cell);
  });
  });

  weekNode.appendChild(grid);
  wrapper.appendChild(weekNode);
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
      label: weekDays[0].date + " al " + weekDays[weekDays.length - 1].date,
      weekNumber: getIsoWeekNumber(weekDays[0].date)
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

function buildAgendaSlotInnerHtml(day, slot, supportsDuration, durationMinutes, rangeSelection) {
  const startTime = escapeHtml(String(slot.startIso || "").slice(11, 16));
  const endTime = escapeHtml(computeSlotRangeEnd(selectedSlot ? selectedSlot.startIso : slot.startIso, durationMinutes));

  if (rangeSelection.isSingle) {
    return [
      '<span class="agenda-range-time agenda-range-time-start">', startTime, "</span>",
      '<span class="agenda-range-connector">a</span>',
      '<span class="agenda-range-time agenda-range-time-end">', escapeHtml(computeSlotRangeEnd(slot.startIso, durationMinutes)), "</span>"
    ].join("");
  }

  if (rangeSelection.isStart) {
    return '<span class="agenda-range-time agenda-range-time-start">' + startTime + "</span>";
  }

  if (rangeSelection.isEnd) {
    return '<span class="agenda-range-time agenda-range-time-end">' + endTime + "</span>";
  }

  if (rangeSelection.isMiddle) {
    return '<span class="agenda-range-fill" aria-hidden="true"></span>';
  }

  if (slot.status === "PENDING" || slot.status === "APPROVED") {
    return '<span class="agenda-slot-indicator" aria-hidden="true"></span>';
  }

  return "";
}

function buildAgendaSlotTitle(day, slot, supportsDuration, durationMinutes) {
  if (slot.status === "AVAILABLE" && !supportsDuration) {
    return day.weekday + " " + day.date + " · " + slot.label + " · No hay " + durationMinutes + " minutos continuos desde este inicio.";
  }
  return day.weekday + " " + day.date + " · " + slot.label + " · " + getAgendaSlotLabel(slot);
}

function normalizeWeekIndex(index, total) {
  if (!total) {
    return 0;
  }
  return Math.max(0, Math.min(index, total - 1));
}

function getIsoWeekNumber(dateString) {
  const date = new Date(String(dateString || "") + "T00:00:00");
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  return Math.ceil((((utcDate - yearStart) / 86400000) + 1) / 7);
}

function getSelectedDurationMinutes() {
  const select = document.getElementById("appointmentDuration");
  const value = Number(select ? select.value : 30);
  return Number.isFinite(value) ? value : 30;
}

function canSlotSupportDuration(day, slot, durationMinutes) {
  const slotMinutes = Number(boot && boot.config && boot.config.slotMinutes ? boot.config.slotMinutes : 30);
  const requiredSlots = Math.max(1, Math.ceil(durationMinutes / slotMinutes));
  const daySlots = Array.isArray(day && day.slots) ? day.slots : [];
  const startIndex = daySlots.findIndex(function (item) {
    return item.startIso === slot.startIso;
  });

  if (startIndex < 0) {
    return false;
  }

  for (let index = 0; index < requiredSlots; index += 1) {
    const current = daySlots[startIndex + index];
    if (!current || current.status !== "AVAILABLE") {
      return false;
    }
  }

  return true;
}

function isSlotRangeSelectable(startIso, durationMinutes) {
  for (const week of currentCalendarWeeks) {
    for (const day of week.days || []) {
      const slot = (day.slots || []).find(function (item) {
        return item.startIso === startIso;
      });
      if (slot) {
        return canSlotSupportDuration(day, slot, durationMinutes);
      }
    }
  }
  return false;
}

function buildSelectedSlotText(day, slot, durationMinutes) {
  const startTime = String(slot.startIso || "").slice(11, 16);
  const endDate = new Date(slot.startIso);
  endDate.setMinutes(endDate.getMinutes() + durationMinutes);
  const endTime = String(endDate.getHours()).padStart(2, "0") + ":" + String(endDate.getMinutes()).padStart(2, "0");
  return day.weekday + " " + day.date + " · " + startTime + " - " + endTime + " · " + durationMinutes + " min";
}

function formatDurationLabel(durationMinutes) {
  if (durationMinutes % 60 === 0) {
    return String(durationMinutes / 60) + " h";
  }
  return String(durationMinutes) + " min";
}

function computeSlotRangeEnd(startIso, durationMinutes) {
  const endDate = new Date(startIso);
  endDate.setMinutes(endDate.getMinutes() + durationMinutes);
  return String(endDate.getHours()).padStart(2, "0") + ":" + String(endDate.getMinutes()).padStart(2, "0");
}

function updateSelectedSlotLabel() {
  if (!selectedSlot) {
    document.getElementById("selectedSlotLabel").textContent = "Ninguna";
    return;
  }
  const match = findDayBySlotStart(selectedSlot.startIso);
  if (!match) {
    document.getElementById("selectedSlotLabel").textContent = selectedSlot.label || "Ninguna";
    return;
  }
  document.getElementById("selectedSlotLabel").textContent = buildSelectedSlotText(match.day, selectedSlot, getSelectedDurationMinutes());
}

function findDayBySlotStart(startIso) {
  for (const week of currentCalendarWeeks) {
    for (const day of week.days || []) {
      if ((day.slots || []).some(function (item) { return item.startIso === startIso; })) {
        return { week, day };
      }
    }
  }
  return null;
}

function isSlotInsideSelectedRange(slotStartIso) {
  if (!selectedSlot) {
    return false;
  }
  const durationMinutes = getSelectedDurationMinutes();
  const selectedStart = new Date(selectedSlot.startIso);
  const selectedEnd = new Date(selectedSlot.startIso);
  const slotStart = new Date(slotStartIso);

  if (Number.isNaN(selectedStart.getTime()) || Number.isNaN(selectedEnd.getTime()) || Number.isNaN(slotStart.getTime())) {
    return false;
  }

  selectedEnd.setMinutes(selectedEnd.getMinutes() + durationMinutes);
  return slotStart >= selectedStart && slotStart < selectedEnd;
}

function getRangeSelectionState(day, slot, durationMinutes) {
  if (!selectedSlot) {
    return {
      inRange: false,
      isStart: false,
      isMiddle: false,
      isEnd: false,
      isSingle: false
    };
  }

  const daySlots = Array.isArray(day && day.slots) ? day.slots : [];
  const selectedIndex = daySlots.findIndex(function (item) {
    return item.startIso === selectedSlot.startIso;
  });
  const currentIndex = daySlots.findIndex(function (item) {
    return item.startIso === slot.startIso;
  });
  const slotMinutes = Number(boot && boot.config && boot.config.slotMinutes ? boot.config.slotMinutes : 30);
  const requiredSlots = Math.max(1, Math.ceil(durationMinutes / slotMinutes));

  if (selectedIndex < 0 || currentIndex < 0) {
    return {
      inRange: false,
      isStart: false,
      isMiddle: false,
      isEnd: false,
      isSingle: false
    };
  }

  const relativeIndex = currentIndex - selectedIndex;
  const inRange = relativeIndex >= 0 && relativeIndex < requiredSlots;
  const isSingle = inRange && requiredSlots === 1;

  return {
    inRange: inRange,
    isStart: inRange && relativeIndex === 0 && requiredSlots > 1,
    isMiddle: inRange && relativeIndex > 0 && relativeIndex < requiredSlots - 1,
    isEnd: inRange && relativeIndex === requiredSlots - 1 && requiredSlots > 1,
    isSingle: isSingle
  };
}

function renderDurationHint() {
  const hint = document.getElementById("appointmentDurationHint");
  if (!hint) {
    return;
  }
  const durationMinutes = getSelectedDurationMinutes();
  hint.textContent = "Se bloquearán " + durationMinutes + " minutos continuos desde la hora elegida. Si el rango choca o se pasa del horario, ese inicio no podrá seleccionarse.";
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
      "<td>" + escapeHtml(formatDisplayDate(item.slotDate)) + "</td>",
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

function formatDisplayDate(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  const isoMatch = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) {
    return isoMatch[1];
  }
  return text;
}

async function requestAppointment() {
  if (requestAppointmentInFlight) {
    return;
  }
  requestAppointmentInFlight = true;
  const runId = ++requestAppointmentRunId;
  const activeToken = getActiveSessionToken();
  const access = buildAppointmentRequestAccess() || {
    providerId: "",
    vendorCode: "",
    email: ""
  };
  const selectedOc = document.getElementById("appointmentOc").value;
  if (!selectedSlot) {
    renderRequestFeedback("Selecciona una hora de inicio disponible.", "error");
    hideGlobalMessage();
    requestAppointmentInFlight = false;
    return;
  }
  if (!selectedOc) {
    renderRequestFeedback("Selecciona una OC abierta para continuar.", "error");
    hideGlobalMessage();
    document.getElementById("appointmentOc").focus();
    requestAppointmentInFlight = false;
    return;
  }

  const releaseBusy = setBusyState(document.getElementById("requestAppointmentButton"), true);
  hideGlobalMessage();
  renderRequestFeedback("Registrando tu solicitud de cita...", "loading");

  try {
    if (activeToken) {
      sessionToken = activeToken;
    }
    hideAccessMessage();
    const response = await api("requestAppointment", {
      sessionToken: activeToken || "",
      providerId: access.providerId || "",
      vendorCode: access.vendorCode || "",
      email: access.email || "",
      startIso: selectedSlot.startIso,
      durationMinutes: getSelectedDurationMinutes(),
      ocNumber: selectedOc,
      notes: document.getElementById("appointmentNotes").value
    });

    hideGlobalMessage();
    const successMessage = response.message || "Tu solicitud de cita fue registrada correctamente.";
    const createdAppointment = response.appointment || null;
    if (runId !== requestAppointmentRunId) {
      return;
    }

    if (createdAppointment) {
      appointmentsState = mergeAppointmentIntoState(createdAppointment, appointmentsState);
      renderAppointments(appointmentsState);
    }

    selectedSlot = null;
    document.getElementById("selectedSlotLabel").textContent = "Ninguna";
    document.getElementById("appointmentNotes").value = "";
    renderDurationHint();
    renderCalendarSelection();
    updateRequestAvailabilityState();
    renderRequestFeedback(
      createdAppointment
        ? "Tu solicitud de cita fue registrada correctamente y ya aparece en tu historial."
        : successMessage,
      "success"
    );

    queueProviderDashboardSync();

  } catch (error) {
    if (runId === requestAppointmentRunId) {
      renderRequestFeedback(error.message || "No pudimos registrar tu solicitud en este momento. Intenta nuevamente en unos minutos.", "error");
      hideGlobalMessage();
    }
  } finally {
    releaseBusy();
    if (runId === requestAppointmentRunId) {
      requestAppointmentInFlight = false;
    }
    updateRequestAvailabilityState();
  }
}

function queueProviderDashboardSync() {
  window.setTimeout(function () {
    refreshDashboard({ preserveShell: true }).catch(function (error) {
      console.warn("No pudimos sincronizar el dashboard después de registrar la cita.", error);
    });
  }, 1500);
}

function buildAppointmentRequestAccess() {
  const sources = [
    currentAccess,
    getCurrentAccess(),
    getAccountIdentity(),
    providerState,
    getPersistedAccessSnapshot(),
    readSummaryAccessIdentity()
  ];

  const resolved = sources.reduce(function (accumulator, source) {
    if (!source) {
      return accumulator;
    }
    if (!accumulator.providerId && source.providerId) {
      accumulator.providerId = String(source.providerId || "").trim();
    }
    if (!accumulator.vendorCode && source.vendorCode) {
      accumulator.vendorCode = String(source.vendorCode || "").trim();
    }
    if (!accumulator.email && source.email) {
      accumulator.email = String(source.email || "").trim();
    }
    return accumulator;
  }, {
    providerId: "",
    vendorCode: "",
    email: ""
  });

  if (!resolved.providerId && !resolved.vendorCode && !resolved.email) {
    return null;
  }

  resolved.sessionToken = String(getActiveSessionToken() || "").trim();
  currentAccess = resolved;
  syncAccountIdentity(resolved);
  return resolved;
}

function readSummaryAccessIdentity() {
  const summary = document.getElementById("providerSummary");
  if (!summary) {
    return null;
  }
  const text = String(summary.textContent || "").trim();
  if (!text) {
    return null;
  }
  const vendorCodeMatch = text.match(/Código de proveedor:\s*([^|\s]+)/i);
  const emailMatch = text.match(/Correo:\s*([^\s]+)/i);
  const identity = {
    providerId: "",
    vendorCode: vendorCodeMatch ? String(vendorCodeMatch[1] || "").trim() : "",
    email: emailMatch ? String(emailMatch[1] || "").trim() : ""
  };
  if (!identity.vendorCode && !identity.email) {
    return null;
  }
  return identity;
}

function mergeAppointmentIntoState(appointment, currentList) {
  const list = Array.isArray(currentList) ? currentList.slice() : [];
  const appointmentId = String(appointment && appointment.appointmentId || "").trim();
  if (!appointmentId) {
    return list;
  }

  const nextList = list.filter(function (row) {
    return String(row && row.appointmentId || "").trim() !== appointmentId;
  });

  nextList.unshift(appointment);
  nextList.sort(function (left, right) {
    const leftValue = String((left && left.effectiveStart) || (left && left.requestedStart) || "");
    const rightValue = String((right && right.effectiveStart) || (right && right.requestedStart) || "");
    return rightValue.localeCompare(leftValue);
  });
  return nextList;
}

function logout() {
  clearSession({ clearIdentity: true });
  resetProviderView();
  activateTab("loginPanel");
  showMessage("Tu sesi\u00f3n fue cerrada.", "success");
}

function clearSession(options) {
  options = options || {};
  sessionToken = "";
  localStorage.removeItem(SESSION_STORAGE_KEY);
  currentAccess = null;
  syncAccountIdentity(null, { clearSnapshot: Boolean(options.clearIdentity) });
}

function getActiveSessionToken() {
  return String(sessionToken || localStorage.getItem(SESSION_STORAGE_KEY) || "").trim();
}

function persistAccessSnapshot(identity) {
  if (!identity) {
    localStorage.removeItem(ACCESS_STORAGE_KEY);
    return;
  }
  const snapshot = {
    providerId: String(identity.providerId || "").trim(),
    vendorCode: String(identity.vendorCode || "").trim(),
    email: String(identity.email || "").trim()
  };
  if (!snapshot.providerId && !snapshot.vendorCode && !snapshot.email) {
    localStorage.removeItem(ACCESS_STORAGE_KEY);
    return;
  }
  localStorage.setItem(ACCESS_STORAGE_KEY, JSON.stringify(snapshot));
}

function getPersistedAccessSnapshot() {
  try {
    const raw = String(localStorage.getItem(ACCESS_STORAGE_KEY) || "").trim();
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    const snapshot = {
      providerId: String(parsed.providerId || "").trim(),
      vendorCode: String(parsed.vendorCode || "").trim(),
      email: String(parsed.email || "").trim()
    };
    if (!snapshot.providerId && !snapshot.vendorCode && !snapshot.email) {
      return null;
    }
    return snapshot;
  } catch (error) {
    console.warn("No pudimos leer el snapshot local de acceso.", error);
    localStorage.removeItem(ACCESS_STORAGE_KEY);
    return null;
  }
}

function syncAccountIdentity(provider, options) {
  options = options || {};
  if (!provider) {
    const panel = document.getElementById("accountPanel");
    if (panel) {
      delete panel.dataset.providerId;
      delete panel.dataset.vendorCode;
      delete panel.dataset.email;
    }
    if (options.clearSnapshot) {
      persistAccessSnapshot(null);
    }
    return;
  }
  const identity = {
    providerId: String(provider.providerId || "").trim(),
    vendorCode: String(provider.vendorCode || "").trim(),
    email: String(provider.email || "").trim()
  };
  persistAccessSnapshot(identity);
  const panel = document.getElementById("accountPanel");
  if (!panel) {
    return;
  }
  panel.dataset.providerId = identity.providerId;
  panel.dataset.vendorCode = identity.vendorCode;
  panel.dataset.email = identity.email;
}

function getAccountIdentity() {
  const panel = document.getElementById("accountPanel");
  if (panel) {
    const providerId = String(panel.dataset.providerId || "").trim();
    const vendorCode = String(panel.dataset.vendorCode || "").trim();
    const email = String(panel.dataset.email || "").trim();
    if (providerId || vendorCode || email) {
      return {
        providerId: providerId,
        vendorCode: vendorCode,
        email: email
      };
    }
  }
  if (providerState) {
    const providerId = String(providerState.providerId || "").trim();
    const vendorCode = String(providerState.vendorCode || "").trim();
    const email = String(providerState.email || "").trim();
    if (providerId || vendorCode || email) {
      return {
        providerId: providerId,
        vendorCode: vendorCode,
        email: email
      };
    }
  }
  const snapshot = getPersistedAccessSnapshot();
  if (snapshot) {
    return snapshot;
  }
  return null;
}

function setCurrentAccess(provider, token) {
  const identity = provider || getAccountIdentity();
  if (!identity) {
    currentAccess = null;
    return;
  }
  currentAccess = {
    providerId: String(identity.providerId || "").trim(),
    vendorCode: String(identity.vendorCode || "").trim(),
    email: String(identity.email || "").trim(),
    sessionToken: String(token || getActiveSessionToken() || "").trim()
  };
  persistAccessSnapshot(currentAccess);
}

function getCurrentAccess() {
  if (currentAccess && (currentAccess.providerId || currentAccess.vendorCode || currentAccess.email)) {
    currentAccess.sessionToken = String(getActiveSessionToken() || currentAccess.sessionToken || "").trim();
    return currentAccess;
  }
  const fallback = getAccountIdentity();
  if (!fallback) {
    return null;
  }
  currentAccess = {
    providerId: fallback.providerId || "",
    vendorCode: fallback.vendorCode || "",
    email: fallback.email || "",
    sessionToken: String(getActiveSessionToken() || "").trim()
  };
  return currentAccess;
}

function getResolvedRequestAccess() {
  const access = getCurrentAccess();
  if (access && (access.providerId || access.vendorCode || access.email)) {
    return access;
  }
  if (providerState) {
    const fallback = {
      providerId: String(providerState.providerId || "").trim(),
      vendorCode: String(providerState.vendorCode || "").trim(),
      email: String(providerState.email || "").trim(),
      sessionToken: String(getActiveSessionToken() || "").trim()
    };
    if (fallback.providerId || fallback.vendorCode || fallback.email) {
      currentAccess = fallback;
      syncAccountIdentity(fallback);
      return fallback;
    }
  }
  const snapshot = getPersistedAccessSnapshot();
  if (snapshot) {
    currentAccess = {
      providerId: snapshot.providerId || "",
      vendorCode: snapshot.vendorCode || "",
      email: snapshot.email || "",
      sessionToken: String(getActiveSessionToken() || "").trim()
    };
    syncAccountIdentity(currentAccess);
    return currentAccess;
  }
  return null;
}

function updateRequestAvailabilityState() {
  const button = document.getElementById("requestAppointmentButton");
  if (!button) {
    return;
  }
  const access = getCurrentAccess();
  const hasIdentity = Boolean(access && (access.providerId || access.vendorCode || access.email));
  const hasSlot = Boolean(selectedSlot);
  const hasOc = Boolean(document.getElementById("appointmentOc").value);
  button.disabled = !(hasIdentity && hasSlot && hasOc);
  button.classList.toggle("is-disabled", button.disabled);
  if (hasIdentity && hasSlot && hasOc) {
    const feedback = document.getElementById("requestFeedback");
    const text = String(feedback && feedback.textContent || "").trim().toLowerCase();
    if (text.indexOf("inicia sesión") >= 0 || text.indexOf("inicia sesion") >= 0 || text.indexOf("cuenta válida") >= 0 || text.indexOf("cuenta valida") >= 0) {
      renderRequestFeedback("", "");
    }
  }
}

function togglePanel(panelId) {
  const panel = document.getElementById(panelId);
  panel.classList.toggle("hidden");
}

function handleFormInvalid(event) {
  if (!event.target) {
    return;
  }
  hideGlobalMessage();
  showAccessValidationMessage(buildInvalidFieldMessage(event.target));
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
  if (messageHideTimer) {
    clearTimeout(messageHideTimer);
    messageHideTimer = null;
  }

  ["message", "accessMessage"].forEach(function (id) {
    if (id === "accessMessage" && isAccessShellAuthenticated()) {
      return;
    }
    const box = document.getElementById(id);
    if (!box) {
      return;
    }
    box.textContent = text;
    box.className = "message " + type;
  });

  const accessBox = document.getElementById("accessMessage");
  if (accessBox && !isAccessShellAuthenticated() && typeof accessBox.scrollIntoView === "function") {
    accessBox.scrollIntoView({
      behavior: "smooth",
      block: "nearest"
    });
  }

  if (type === "success") {
    messageHideTimer = setTimeout(function () {
      ["message", "accessMessage"].forEach(function (id) {
        const box = document.getElementById(id);
        if (!box) {
          return;
        }
        box.textContent = "";
        box.className = "message hidden";
      });
    }, 2200);
  }
}

function isAccessShellAuthenticated() {
  const guestAccessBlock = document.getElementById("guestAccessBlock");
  return Boolean(guestAccessBlock && guestAccessBlock.classList.contains("hidden"));
}

function hideGlobalMessage() {
  const box = document.getElementById("message");
  if (!box) {
    return;
  }
  box.textContent = "";
  box.className = "message hidden";
}

function hideAccessMessage() {
  const box = document.getElementById("accessMessage");
  if (!box) {
    return;
  }
  box.textContent = "";
  box.className = "message hidden";
}

function renderRequestFeedback(text, type) {
  const box = document.getElementById("requestFeedback");
  if (!box) {
    return;
  }
  if (!text) {
    box.textContent = "";
    box.className = "note hidden";
    return;
  }
  box.textContent = text;
  box.className = "note";
  if (type) {
    box.classList.add("note-" + type);
  }
}

function showAccessValidationMessage(text) {
  const box = document.getElementById("accessMessage");
  if (!box) {
    return;
  }
  box.textContent = text || "Revisa los campos obligatorios antes de continuar.";
  box.className = "message error";
}

function buildInvalidFieldMessage(field) {
  const labelText = getFieldLabelText(field);
  if (!labelText) {
    return "Revisa los campos obligatorios antes de continuar.";
  }
  return "Completa " + labelText + " para continuar.";
}

function getFieldLabelText(field) {
  const label = field.closest("label");
  if (!label) {
    return "";
  }

  const parts = Array.from(label.childNodes)
    .filter(function (node) {
      return node.nodeType === Node.TEXT_NODE;
    })
    .map(function (node) {
      return String(node.textContent || "").trim();
    })
    .filter(Boolean);

  return parts.join(" ").replace(/\s+/g, " ").trim();
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
  if (action === "providerAccess") {
    return "No pudimos iniciar sesión en este momento. Intenta nuevamente en unos minutos.";
  }
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
  currentAccess = null;
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
  hideAccessMessage();
  renderPersistentWarning("");
  renderRequestFeedback("", "");
  updateRequestAvailabilityState();
}

function setAccessAuthenticatedMode(isAuthenticated) {
  const accessIntro = document.getElementById("accessIntro");
  const accessTabs = document.getElementById("accessTabs");
  const registerPanel = document.getElementById("registerPanel");
  const guestAccessBlock = document.getElementById("guestAccessBlock");
  const accessMessage = document.getElementById("accessMessage");

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
  if (accessMessage) {
    accessMessage.classList.toggle("hidden", isAuthenticated);
    if (isAuthenticated) {
      accessMessage.textContent = "";
      accessMessage.className = "message hidden";
    }
  }

  if (!isAuthenticated) {
    activateTab("loginPanel");
  }
}

function collapseDashboardPanels() {
  appointmentsState = [];
  pendingPurchaseOrdersState = [];
  selectedSlot = null;
  currentCalendarWeeks = [];
  currentWeekIndex = 0;
  document.getElementById("appointmentPanel").classList.add("hidden");
  document.getElementById("appointmentsHistory").classList.add("hidden");
  document.getElementById("appointmentOc").innerHTML = '<option value="">Selecciona una OC abierta</option>';
  document.getElementById("appointmentOcSearch").value = "";
  document.getElementById("appointmentOcSummary").classList.add("hidden");
  document.getElementById("appointmentOcSummary").innerHTML = "";
  renderRequestFeedback("", "");
  updateRequestAvailabilityState();
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

function hasRenderableDashboard(dashboard) {
  return Boolean(dashboard && dashboard.found === true && dashboard.provider);
}
