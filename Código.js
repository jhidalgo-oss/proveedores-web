var APP_DEFAULTS = {
  spreadsheetId: '1NfEcup2dVetL-i9tHtA6G9jlO2cZjYdbyYnZiJv535M',
  supervisorName: 'Freddy',
  slotMinutes: 30,
  maxAdvanceDays: 30,
  lookaheadDays: 14,
  securityProperty: 'SUPERVISOR_ACCESS_KEY',
  sheets: {
    providers: 'PROVEEDORES',
    appointments: 'CITAS',
    sap: 'SAP_PROVEEDORES',
    audit: 'AUDITORIA',
    config: 'CONFIG'
  }
};

var PROVIDER_STATUS = {
  PENDING: 'PENDIENTE',
  APPROVED: 'APROBADO',
  REJECTED: 'RECHAZADO'
};

var APPOINTMENT_STATUS = {
  PENDING: 'PENDIENTE',
  APPROVED: 'APROBADA',
  REJECTED: 'RECHAZADA',
  CANCELLED: 'CANCELADA'
};

var SENSITIVE_FIELDS = {
  passwordHash: true,
  passwordSalt: true,
  resetTokenHash: true,
  resetTokenExpiresAt: true,
  sessionTokenHash: true,
  sessionTokenExpiresAt: true
};

var SHEET_HEADERS = {};
SHEET_HEADERS[APP_DEFAULTS.sheets.providers] = [
  'providerId',
  'vendorCode',
  'vendorName',
  'taxId',
  'contactName',
  'email',
  'phone',
  'ocNumber',
  'sapStatus',
  'registrationStatus',
  'createdAt',
  'updatedAt',
  'approvedBy',
  'approvedAt',
  'notes',
  'passwordHash',
  'passwordSalt',
  'resetTokenHash',
  'resetTokenExpiresAt',
  'sessionTokenHash',
  'sessionTokenExpiresAt'
];
SHEET_HEADERS[APP_DEFAULTS.sheets.appointments] = [
  'appointmentId',
  'providerId',
  'vendorCode',
  'vendorName',
  'email',
  'ocNumber',
  'requestedStart',
  'requestedEnd',
  'effectiveStart',
  'effectiveEnd',
  'slotDate',
  'slotLabel',
  'appointmentStatus',
  'outsideSchedule',
  'requestedAt',
  'approvedAt',
  'approvedBy',
  'accessCode',
  'mailSentAt',
  'notes'
];
SHEET_HEADERS[APP_DEFAULTS.sheets.sap] = [
  'vendorCode',
  'vendorName',
  'taxId',
  'active',
  'lastSync',
  'notes'
];
SHEET_HEADERS[APP_DEFAULTS.sheets.audit] = [
  'timestamp',
  'eventType',
  'recordId',
  'actor',
  'details'
];
SHEET_HEADERS[APP_DEFAULTS.sheets.config] = [
  'key',
  'value',
  'description'
];

function doGet(e) {
  ensureSheets_();
  var mode = getMode_(e);
  var template = HtmlService.createTemplateFromFile(mode === 'supervisor' ? 'Supervisor' : 'Proveedor');
  template.bootData = JSON.stringify(getBootstrapData_(mode));
  return template
    .evaluate()
    .setTitle(mode === 'supervisor' ? 'Panel Supervisor Proveedores' : 'Citas de Atencion a Proveedores')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function doPost(e) {
  ensureSheets_();

  try {
    var payload = parseJsonBody_(e);
    var action = getApiAction_(e, payload);
    var response = routeApiAction_(action, payload);
    return jsonResponse_({
      ok: true,
      action: action,
      data: response,
      timestamp: nowIso_()
    });
  } catch (error) {
    return jsonResponse_({
      ok: false,
      error: error.message || 'Ocurrio un error procesando la solicitud.',
      timestamp: nowIso_()
    });
  }
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function setupSystem() {
  ensureSheets_();
  return {
    ok: true,
    bootstrap: getBootstrapData_('supervisor')
  };
}

function routeApiAction_(action, payload) {
  switch (action) {
    case 'providerBootstrap':
      return getBootstrapData_('proveedor');
    case 'providerLogin':
      return providerLogin(payload);
    case 'providerDashboard':
      return getProviderDashboard(payload);
    case 'registerProvider':
      return registerProvider(payload);
    case 'requestPasswordReset':
      return requestPasswordReset(payload);
    case 'resetPassword':
      return resetPassword(payload);
    case 'recoverEmailByTaxId':
      return recoverEmailByTaxId(payload);
    case 'requestAppointment':
      return requestAppointment(payload);
    case 'health':
      return {
        service: 'proveedores-citas',
        status: 'ok',
        mode: 'apps-script-api'
      };
    default:
      throw new Error('Accion API no soportada: ' + action);
  }
}

function getProviderDashboard(criteria) {
  ensureSheets_();
  criteria = criteria || {};
  var provider = findProvider_(criteria);
  if (!provider) {
    return {
      found: false,
      message: 'No encontramos un proveedor con ese código y correo.'
    };
  }

  var config = getRuntimeConfig_();
  var startDate = criteria.startDate || formatDate_(new Date());
  return {
    found: true,
    provider: cleanRow_(provider),
    warnings: buildProviderWarnings_(provider),
    appointments: getProviderAppointments_(provider.providerId),
    canRequestAppointments: provider.registrationStatus === PROVIDER_STATUS.APPROVED,
    calendar: provider.registrationStatus === PROVIDER_STATUS.APPROVED
      ? buildCalendar_(startDate, config.lookaheadDays, false)
      : null
  };
}

function registerProvider(payload) {
  ensureSheets_();
  var config = getRuntimeConfig_();
  var clean = normalizeProviderPayload_(payload);
  var providers = getSheetData_(APP_DEFAULTS.sheets.providers);
  var existing = providers.find(function(row) {
    var sameTaxId = clean.taxId && digitsOnly_(row.taxId) === clean.taxId;
    return sameText_(row.email, clean.email) || sameTaxId;
  });
  var sapResult = validateVendorAgainstSap_(clean.sapVendorCode, clean.taxId);

  if (config.strictSapValidation && sapResult.catalogLoaded && !sapResult.matched) {
    throw new Error('El proveedor no existe en el padrón SAP. Verifica los datos antes de continuar.');
  }

  var now = nowIso_();
  var record = existing || {};
  record.providerId = record.providerId || nextId_('PRV');
  record.vendorCode = record.vendorCode || generateProviderCode_();
  record.vendorName = sapResult.vendorName || clean.vendorName;
  record.taxId = clean.taxId;
  record.contactName = clean.contactName;
  record.email = clean.email;
  record.phone = clean.phone;
  record.ocNumber = record.ocNumber || '';
  record.sapStatus = sapResult.status;
  record.createdAt = record.createdAt || now;
  record.updatedAt = now;
  record.notes = clean.notes;

  if (record.registrationStatus !== PROVIDER_STATUS.APPROVED) {
    record.registrationStatus = PROVIDER_STATUS.PENDING;
    record.approvedBy = '';
    record.approvedAt = '';
  }

  saveRecord_(APP_DEFAULTS.sheets.providers, record, 'providerId', existing && existing._rowNumber);
  audit_('PROVEEDOR_REGISTRO', record.providerId, record.email, 'Proveedor registrado o actualizado');

  return {
    ok: true,
    message: record.registrationStatus === PROVIDER_STATUS.APPROVED
      ? 'Tus datos fueron actualizados. Tu código de proveedor es ' + record.vendorCode + '. Ya puedes solicitar una cita.'
      : 'Registro enviado. Tu código de proveedor es ' + record.vendorCode + '. Grupo Santis validará y autorizará tu solicitud.',
    provider: cleanRow_(record),
    sap: sapResult
  };
}

function requestAppointment(payload) {
  ensureSheets_();
  var clean = normalizeAppointmentRequest_(payload);
  var provider = findProvider_({
    providerId: clean.providerId,
    vendorCode: clean.vendorCode,
    email: clean.email
  });

  if (!provider) {
    throw new Error('Primero registra al proveedor y confirma el correo usado.');
  }
  if (provider.registrationStatus !== PROVIDER_STATUS.APPROVED) {
    throw new Error('El proveedor aún no está aprobado por Grupo Santis.');
  }

  var slotStart = parseLocalDateTime_(clean.startIso);
  validateSlotRequest_(slotStart);
  assertSlotAvailable_(clean.startIso, '');

  var slotEnd = addMinutes_(slotStart, getRuntimeConfig_().slotMinutes);
  var appointment = {
    appointmentId: nextId_('CIT'),
    providerId: provider.providerId,
    vendorCode: provider.vendorCode,
    vendorName: provider.vendorName,
    email: provider.email,
    ocNumber: clean.ocNumber || provider.ocNumber || '',
    requestedStart: clean.startIso,
    requestedEnd: formatDateTime_(slotEnd),
    effectiveStart: clean.startIso,
    effectiveEnd: formatDateTime_(slotEnd),
    slotDate: formatDate_(slotStart),
    slotLabel: formatSlotLabel_(slotStart, slotEnd),
    appointmentStatus: APPOINTMENT_STATUS.PENDING,
    outsideSchedule: 'NO',
    requestedAt: nowIso_(),
    approvedAt: '',
    approvedBy: '',
    accessCode: '',
    mailSentAt: '',
    notes: clean.notes
  };

  saveRecord_(APP_DEFAULTS.sheets.appointments, appointment, 'appointmentId');
  audit_('CITA_SOLICITADA', appointment.appointmentId, provider.email, appointment.slotLabel);

  return {
    ok: true,
    message: 'Tu solicitud de cita fue registrada y queda pendiente de aprobación.',
    appointment: cleanRow_(appointment)
  };
}

function getSupervisorDashboard(options) {
  ensureSheets_();
  options = options || {};
  assertSupervisorAccess_(options.accessKey);

  var startDate = options.startDate || formatDate_(new Date());
  var providers = getSheetData_(APP_DEFAULTS.sheets.providers);
  var appointments = getSheetData_(APP_DEFAULTS.sheets.appointments);

  return {
    ok: true,
    security: {
      protected: isSupervisorProtected_()
    },
    pendingProviders: providers
      .filter(function(row) { return row.registrationStatus === PROVIDER_STATUS.PENDING; })
      .sort(sortByDateField_('createdAt'))
      .map(cleanRow_),
    pendingAppointments: appointments
      .filter(function(row) { return row.appointmentStatus === APPOINTMENT_STATUS.PENDING; })
      .sort(sortByDateField_('effectiveStart'))
      .map(cleanRow_),
    approvedAppointments: appointments
      .filter(function(row) { return row.appointmentStatus === APPOINTMENT_STATUS.APPROVED; })
      .sort(sortByDateField_('effectiveStart'))
      .slice(0, 25)
      .map(cleanRow_),
    calendar: buildCalendar_(startDate, getRuntimeConfig_().lookaheadDays, true),
    stats: {
      sapCatalogLoaded: hasSapCatalog_(),
      providersPending: providers.filter(function(row) { return row.registrationStatus === PROVIDER_STATUS.PENDING; }).length,
      appointmentsPending: appointments.filter(function(row) { return row.appointmentStatus === APPOINTMENT_STATUS.PENDING; }).length
    }
  };
}

function approveProvider(payload) {
  ensureSheets_();
  payload = payload || {};
  assertSupervisorAccess_(payload.accessKey);
  var provider = getRecordById_(APP_DEFAULTS.sheets.providers, 'providerId', payload.providerId);
  if (!provider) {
    throw new Error('No encontramos el proveedor.');
  }

  provider.registrationStatus = PROVIDER_STATUS.APPROVED;
  provider.approvedBy = getApproverName_();
  provider.approvedAt = nowIso_();
  provider.updatedAt = nowIso_();
  provider.notes = appendNote_(provider.notes, payload.notes || 'Aprobado para solicitar citas.');

  saveRecord_(APP_DEFAULTS.sheets.providers, provider, 'providerId', provider._rowNumber);
  sendProviderApprovalEmail_(provider);
  audit_('PROVEEDOR_APROBADO', provider.providerId, provider.email, provider.approvedBy);

  return {
    ok: true,
    message: 'Proveedor aprobado correctamente.'
  };
}

function rejectProvider(payload) {
  ensureSheets_();
  payload = payload || {};
  assertSupervisorAccess_(payload.accessKey);
  var provider = getRecordById_(APP_DEFAULTS.sheets.providers, 'providerId', payload.providerId);
  if (!provider) {
    throw new Error('No encontramos el proveedor.');
  }

  provider.registrationStatus = PROVIDER_STATUS.REJECTED;
  provider.updatedAt = nowIso_();
  provider.notes = appendNote_(provider.notes, payload.notes || 'Registro rechazado por supervisor.');

  saveRecord_(APP_DEFAULTS.sheets.providers, provider, 'providerId', provider._rowNumber);
  audit_('PROVEEDOR_RECHAZADO', provider.providerId, provider.email, payload.notes || '');

  return {
    ok: true,
    message: 'Proveedor rechazado.'
  };
}

function approveAppointment(payload) {
  ensureSheets_();
  payload = payload || {};
  assertSupervisorAccess_(payload.accessKey);

  var appointment = getRecordById_(APP_DEFAULTS.sheets.appointments, 'appointmentId', payload.appointmentId);
  if (!appointment) {
    throw new Error('No encontramos la cita.');
  }

  var targetStart = payload.startIso ? parseLocalDateTime_(payload.startIso) : parseLocalDateTime_(appointment.effectiveStart);
  var allowOutside = payload.allowOutsideSchedule === true;
  validateSupervisorSlot_(targetStart, allowOutside);
  assertSlotAvailable_(formatDateTime_(targetStart), appointment.appointmentId);

  var slotEnd = addMinutes_(targetStart, getRuntimeConfig_().slotMinutes);
  appointment.effectiveStart = formatDateTime_(targetStart);
  appointment.effectiveEnd = formatDateTime_(slotEnd);
  appointment.slotDate = formatDate_(targetStart);
  appointment.slotLabel = formatSlotLabel_(targetStart, slotEnd);
  appointment.outsideSchedule = isWithinSchedule_(targetStart) ? 'NO' : 'SI';
  appointment.appointmentStatus = APPOINTMENT_STATUS.APPROVED;
  appointment.approvedAt = nowIso_();
  appointment.approvedBy = getApproverName_();
  appointment.accessCode = appointment.accessCode || generateAccessCode_();
  appointment.notes = appendNote_(appointment.notes, payload.notes || 'Cita aprobada.');

  saveRecord_(APP_DEFAULTS.sheets.appointments, appointment, 'appointmentId', appointment._rowNumber);
  sendAppointmentEmail_(appointment, false);
  audit_('CITA_APROBADA', appointment.appointmentId, appointment.email, appointment.slotLabel);

  return {
    ok: true,
    message: 'Cita aprobada y correo enviado al proveedor.'
  };
}

function rejectAppointment(payload) {
  ensureSheets_();
  payload = payload || {};
  assertSupervisorAccess_(payload.accessKey);
  var appointment = getRecordById_(APP_DEFAULTS.sheets.appointments, 'appointmentId', payload.appointmentId);
  if (!appointment) {
    throw new Error('No encontramos la cita.');
  }

  appointment.appointmentStatus = APPOINTMENT_STATUS.REJECTED;
  appointment.notes = appendNote_(appointment.notes, payload.notes || 'Cita rechazada por supervisor.');
  saveRecord_(APP_DEFAULTS.sheets.appointments, appointment, 'appointmentId', appointment._rowNumber);
  audit_('CITA_RECHAZADA', appointment.appointmentId, appointment.email, payload.notes || '');

  return {
    ok: true,
    message: 'Cita rechazada.'
  };
}

function rescheduleAppointment(payload) {
  ensureSheets_();
  payload = payload || {};
  assertSupervisorAccess_(payload.accessKey);
  var appointment = getRecordById_(APP_DEFAULTS.sheets.appointments, 'appointmentId', payload.appointmentId);
  if (!appointment) {
    throw new Error('No encontramos la cita.');
  }

  var targetStart = parseLocalDateTime_(payload.startIso);
  var allowOutside = payload.allowOutsideSchedule === true;
  validateSupervisorSlot_(targetStart, allowOutside);
  assertSlotAvailable_(formatDateTime_(targetStart), appointment.appointmentId);

  var slotEnd = addMinutes_(targetStart, getRuntimeConfig_().slotMinutes);
  appointment.effectiveStart = formatDateTime_(targetStart);
  appointment.effectiveEnd = formatDateTime_(slotEnd);
  appointment.slotDate = formatDate_(targetStart);
  appointment.slotLabel = formatSlotLabel_(targetStart, slotEnd);
  appointment.outsideSchedule = isWithinSchedule_(targetStart) ? 'NO' : 'SI';
  appointment.notes = appendNote_(appointment.notes, payload.notes || 'Cita reasignada por supervisor.');

  if (payload.approveAfter === true || appointment.appointmentStatus === APPOINTMENT_STATUS.APPROVED) {
    appointment.appointmentStatus = APPOINTMENT_STATUS.APPROVED;
    appointment.approvedAt = nowIso_();
    appointment.approvedBy = getApproverName_();
    appointment.accessCode = appointment.accessCode || generateAccessCode_();
  }

  saveRecord_(APP_DEFAULTS.sheets.appointments, appointment, 'appointmentId', appointment._rowNumber);

  if (appointment.appointmentStatus === APPOINTMENT_STATUS.APPROVED) {
    sendAppointmentEmail_(appointment, true);
  }

  audit_('CITA_REASIGNADA', appointment.appointmentId, appointment.email, appointment.slotLabel);

  return {
    ok: true,
    message: 'Cita reasignada correctamente.'
  };
}

function createManualAppointment(payload) {
  ensureSheets_();
  payload = payload || {};
  assertSupervisorAccess_(payload.accessKey);

  var clean = normalizeAppointmentRequest_(payload);
  var provider = findProvider_({
    vendorCode: clean.vendorCode,
    email: clean.email
  });

  if (!provider) {
    throw new Error('El proveedor debe registrarse y ser aprobado antes de crear una cita manual.');
  }
  if (provider.registrationStatus !== PROVIDER_STATUS.APPROVED) {
    throw new Error('El proveedor aun no esta aprobado.');
  }

  var targetStart = parseLocalDateTime_(clean.startIso);
  var allowOutside = payload.allowOutsideSchedule === true;
  validateSupervisorSlot_(targetStart, allowOutside);
  assertSlotAvailable_(formatDateTime_(targetStart), '');

  var slotEnd = addMinutes_(targetStart, getRuntimeConfig_().slotMinutes);
  var appointment = {
    appointmentId: nextId_('CIT'),
    providerId: provider.providerId,
    vendorCode: provider.vendorCode,
    vendorName: provider.vendorName,
    email: provider.email,
    ocNumber: clean.ocNumber || provider.ocNumber || '',
    requestedStart: formatDateTime_(targetStart),
    requestedEnd: formatDateTime_(slotEnd),
    effectiveStart: formatDateTime_(targetStart),
    effectiveEnd: formatDateTime_(slotEnd),
    slotDate: formatDate_(targetStart),
    slotLabel: formatSlotLabel_(targetStart, slotEnd),
    appointmentStatus: APPOINTMENT_STATUS.APPROVED,
    outsideSchedule: isWithinSchedule_(targetStart) ? 'NO' : 'SI',
    requestedAt: nowIso_(),
    approvedAt: nowIso_(),
    approvedBy: getApproverName_(),
    accessCode: generateAccessCode_(),
    mailSentAt: '',
    notes: clean.notes || 'Cita manual coordinada por supervisor.'
  };

  saveRecord_(APP_DEFAULTS.sheets.appointments, appointment, 'appointmentId');
  sendAppointmentEmail_(appointment, false);
  audit_('CITA_MANUAL', appointment.appointmentId, appointment.email, appointment.slotLabel);

  return {
    ok: true,
    message: 'Cita manual creada y enviada al proveedor.'
  };
}

function getBootstrapData_(mode) {
  var config = getRuntimeConfig_();
  return {
    mode: mode,
    today: formatDate_(new Date()),
    config: {
      slotMinutes: config.slotMinutes,
      maxAdvanceDays: config.maxAdvanceDays,
      lookaheadDays: config.lookaheadDays,
      supervisorName: config.supervisorName,
      strictSapValidation: config.strictSapValidation,
      hasSapCatalog: hasSapCatalog_(),
      supervisorProtected: isSupervisorProtected_()
    }
  };
}

function getRuntimeConfig_() {
  var props = PropertiesService.getScriptProperties();
  return {
    spreadsheetId: props.getProperty('SPREADSHEET_ID') || APP_DEFAULTS.spreadsheetId,
    supervisorName: props.getProperty('SUPERVISOR_NAME') || APP_DEFAULTS.supervisorName,
    slotMinutes: Number(props.getProperty('SLOT_MINUTES') || APP_DEFAULTS.slotMinutes),
    maxAdvanceDays: Number(props.getProperty('MAX_ADVANCE_DAYS') || APP_DEFAULTS.maxAdvanceDays),
    lookaheadDays: Number(props.getProperty('LOOKAHEAD_DAYS') || APP_DEFAULTS.lookaheadDays),
    strictSapValidation: stringToBoolean_(props.getProperty('STRICT_SAP_VALIDATION'))
  };
}

function ensureSheets_() {
  var spreadsheet = getSpreadsheet_();
  Object.keys(SHEET_HEADERS).forEach(function(sheetName) {
    var sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) {
      sheet = spreadsheet.insertSheet(sheetName);
    }
    var headers = SHEET_HEADERS[sheetName];
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
      if (sheetName === APP_DEFAULTS.sheets.config) {
        seedConfigSheet_(sheet);
      }
    } else {
      var existingHeaders = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
      var mismatch = headers.some(function(header, index) {
        return String(existingHeaders[index] || '') !== header;
      });
      if (mismatch) {
        sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
      }
    }
  });
}

function seedConfigSheet_(sheet) {
  var config = getRuntimeConfig_();
  var rows = [
    ['SPREADSHEET_ID', config.spreadsheetId, 'ID de la hoja principal'],
    ['SUPERVISOR_NAME', config.supervisorName, 'Nombre visible del supervisor'],
    ['SLOT_MINUTES', String(config.slotMinutes), 'Duracion de la cita en minutos'],
    ['MAX_ADVANCE_DAYS', String(config.maxAdvanceDays), 'Cuantos dias hacia adelante se permiten'],
    ['LOOKAHEAD_DAYS', String(config.lookaheadDays), 'Cuantos dias muestra el calendario'],
    ['STRICT_SAP_VALIDATION', config.strictSapValidation ? 'TRUE' : 'FALSE', 'Bloquea proveedores no encontrados en SAP']
  ];
  sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
}

function getSpreadsheet_() {
  return SpreadsheetApp.openById(getRuntimeConfig_().spreadsheetId);
}

function getSheet_(sheetName) {
  var sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) {
    throw new Error('No existe la hoja ' + sheetName + '.');
  }
  return sheet;
}

function getSheetData_(sheetName) {
  var sheet = getSheet_(sheetName);
  if (sheet.getLastRow() < 2) {
    return [];
  }
  var values = sheet.getDataRange().getValues();
  var headers = values[0];
  return values.slice(1).filter(function(row) {
    return row.some(function(cell) { return cell !== ''; });
  }).map(function(row, index) {
    var item = {};
    headers.forEach(function(header, columnIndex) {
      item[header] = row[columnIndex];
    });
    item._rowNumber = index + 2;
    return item;
  });
}

function saveRecord_(sheetName, record, idField, rowNumber) {
  var sheet = getSheet_(sheetName);
  var headers = SHEET_HEADERS[sheetName];
  var row = headers.map(function(header) {
    return record[header] || '';
  });

  if (rowNumber) {
    sheet.getRange(rowNumber, 1, 1, headers.length).setValues([row]);
    record._rowNumber = rowNumber;
    return rowNumber;
  }

  if (!record[idField]) {
    record[idField] = nextId_(idField.toUpperCase());
    row = headers.map(function(header) {
      return record[header] || '';
    });
  }
  sheet.appendRow(row);
  record._rowNumber = sheet.getLastRow();
  return record._rowNumber;
}

function getRecordById_(sheetName, idField, idValue) {
  return getSheetData_(sheetName).find(function(row) {
    return sameText_(row[idField], idValue);
  });
}

function findProvider_(criteria) {
  criteria = criteria || {};
  var providers = getSheetData_(APP_DEFAULTS.sheets.providers);
  return providers.find(function(row) {
    if (criteria.providerId && sameText_(row.providerId, criteria.providerId)) {
      return true;
    }
    if (criteria.vendorCode && criteria.email) {
      return sameText_(row.vendorCode, criteria.vendorCode) && sameText_(row.email, criteria.email);
    }
    if (criteria.vendorCode) {
      return sameText_(row.vendorCode, criteria.vendorCode);
    }
    if (criteria.email) {
      return sameText_(row.email, criteria.email);
    }
    return false;
  });
}

function getProviderAppointments_(providerId) {
  return getSheetData_(APP_DEFAULTS.sheets.appointments)
    .filter(function(row) { return sameText_(row.providerId, providerId); })
    .sort(sortByDateField_('effectiveStart'))
    .map(cleanRow_);
}

function buildProviderWarnings_(provider) {
  var warnings = [];
  if (provider.sapStatus === 'SIN_PADRON') {
    warnings.push('No hay un padrón SAP cargado aún. La validación se hará manualmente.');
  }
  if (provider.sapStatus === 'NO_ENCONTRADO') {
    warnings.push('El proveedor no fue encontrado en SAP y debe revisarse manualmente.');
  }
  if (provider.registrationStatus === PROVIDER_STATUS.PENDING) {
    warnings.push('Grupo Santis debe validar primero el alta del proveedor.');
  }
  return warnings;
}

function buildCalendar_(startDateText, days, includeDetails) {
  var startDate = parseLocalDate_(startDateText);
  var appointments = getSheetData_(APP_DEFAULTS.sheets.appointments)
    .filter(function(row) {
      return row.appointmentStatus === APPOINTMENT_STATUS.PENDING || row.appointmentStatus === APPOINTMENT_STATUS.APPROVED;
    });
  var byStart = {};

  appointments.forEach(function(row) {
    var key = row.effectiveStart;
    if (!byStart[key] || row.appointmentStatus === APPOINTMENT_STATUS.APPROVED) {
      byStart[key] = row;
    }
  });

  var calendar = [];
  for (var dayIndex = 0; dayIndex < days; dayIndex += 1) {
    var currentDate = addDays_(startDate, dayIndex);
    var isoDate = formatDate_(currentDate);
    var slots = generateSlotsForDate_(currentDate).map(function(slot) {
      var appointment = byStart[slot.startIso];
      var state = appointment
        ? (appointment.appointmentStatus === APPOINTMENT_STATUS.APPROVED ? 'APPROVED' : 'PENDING')
        : 'AVAILABLE';
      return {
        startIso: slot.startIso,
        endIso: slot.endIso,
        label: slot.label,
        status: state,
        isSelectable: state === 'AVAILABLE',
        vendorName: appointment && includeDetails ? appointment.vendorName : '',
        email: appointment && includeDetails ? appointment.email : '',
        appointmentId: appointment ? appointment.appointmentId : '',
        outsideSchedule: appointment ? appointment.outsideSchedule === 'SI' : false
      };
    });

    appointments
      .filter(function(row) {
        return row.slotDate === isoDate && row.outsideSchedule === 'SI';
      })
      .forEach(function(row) {
        if (!byStart[row.effectiveStart]) {
          return;
        }
        var start = parseLocalDateTime_(row.effectiveStart);
        var end = parseLocalDateTime_(row.effectiveEnd);
        var label = formatSlotLabel_(start, end) + ' (extra)';
        var status = row.appointmentStatus === APPOINTMENT_STATUS.APPROVED ? 'APPROVED' : 'PENDING';
        if (!slots.some(function(slot) { return slot.startIso === row.effectiveStart; })) {
          slots.push({
            startIso: row.effectiveStart,
            endIso: row.effectiveEnd,
            label: label,
            status: status,
            isSelectable: false,
            vendorName: includeDetails ? row.vendorName : '',
            email: includeDetails ? row.email : '',
            appointmentId: row.appointmentId,
            outsideSchedule: true
          });
        }
      });

    slots.sort(function(left, right) {
      return String(left.startIso).localeCompare(String(right.startIso));
    });

    calendar.push({
      date: isoDate,
      weekday: weekdayName_(currentDate),
      hasService: slots.length > 0,
      slots: slots
    });
  }

  return {
    startDate: startDateText,
    days: calendar
  };
}

function generateSlotsForDate_(date) {
  if (!isBusinessDay_(date)) {
    return [];
  }

  var schedule = getScheduleForDate_(date);
  var slots = [];
  var current = makeDateTime_(formatDate_(date), schedule.startHour, schedule.startMinute);
  var end = makeDateTime_(formatDate_(date), schedule.endHour, schedule.endMinute);

  while (current < end) {
    var next = addMinutes_(current, getRuntimeConfig_().slotMinutes);
    slots.push({
      startIso: formatDateTime_(current),
      endIso: formatDateTime_(next),
      label: formatSlotLabel_(current, next)
    });
    current = next;
  }

  return slots;
}

function validateVendorAgainstSap_(vendorCode, taxId) {
  var catalog = getSheetData_(APP_DEFAULTS.sheets.sap);
  if (!catalog.length) {
    return {
      catalogLoaded: false,
      matched: false,
      status: 'SIN_PADRON',
      vendorName: ''
    };
  }

  var vendorDigits = digitsOnly_(vendorCode);
  var taxDigits = digitsOnly_(taxId);
  var match = catalog.find(function(row) {
    var codeMatch = vendorDigits && digitsOnly_(row.vendorCode) === vendorDigits;
    var taxMatch = taxDigits && digitsOnly_(row.taxId) === taxDigits;
    return codeMatch || taxMatch;
  });

  if (!match) {
    return {
      catalogLoaded: true,
      matched: false,
      status: 'NO_ENCONTRADO',
      vendorName: ''
    };
  }

  return {
    catalogLoaded: true,
    matched: true,
    status: 'VALIDADO',
    vendorName: match.vendorName || ''
  };
}

function validateSlotRequest_(dateTime) {
  var config = getRuntimeConfig_();
  if (!isWithinSchedule_(dateTime)) {
    throw new Error('Las citas de proveedor solo pueden pedirse dentro del horario habil.');
  }
  if (!isBusinessDay_(dateTime)) {
    throw new Error('Solo se atiende de lunes a viernes.');
  }
  if (dateTime < makeDateTime_(formatDate_(new Date()), 0, 0)) {
    throw new Error('No se pueden solicitar citas en el pasado.');
  }
  var limit = addDays_(new Date(), config.maxAdvanceDays);
  if (dateTime > limit) {
    throw new Error('La cita supera el maximo de dias configurado.');
  }
}

function validateSupervisorSlot_(dateTime, allowOutsideSchedule) {
  if (!isBusinessDay_(dateTime) && !allowOutsideSchedule) {
    throw new Error('Fuera de lunes a viernes solo se permite si marcas fuera de horario.');
  }
  if (!isWithinSchedule_(dateTime) && !allowOutsideSchedule) {
    throw new Error('Ese horario esta fuera del rango normal. Activa la excepcion para coordinarlo.');
  }
}

function assertSlotAvailable_(startIso, currentAppointmentId) {
  var occupied = getSheetData_(APP_DEFAULTS.sheets.appointments).find(function(row) {
    if (currentAppointmentId && sameText_(row.appointmentId, currentAppointmentId)) {
      return false;
    }
    if (row.effectiveStart !== startIso) {
      return false;
    }
    return row.appointmentStatus === APPOINTMENT_STATUS.PENDING || row.appointmentStatus === APPOINTMENT_STATUS.APPROVED;
  });
  if (occupied) {
    throw new Error('Ese horario ya no esta disponible.');
  }
}

function normalizeProviderPayload_(payload) {
  payload = payload || {};
  var email = String(payload.email || '').trim().toLowerCase();
  var taxId = digitsOnly_(payload.taxId);
  var sapVendorCode = digitsOnly_(payload.sapVendorCode || '');

  if (!String(payload.vendorName || '').trim()) {
    throw new Error('La razón social o nombre del proveedor es obligatoria.');
  }
  if (!email || !isValidEmail_(email)) {
    throw new Error('Debes registrar un correo válido.');
  }

  return {
    vendorName: String(payload.vendorName || '').trim(),
    taxId: taxId,
    sapVendorCode: sapVendorCode,
    contactName: String(payload.contactName || '').trim(),
    email: email,
    phone: String(payload.phone || '').trim(),
    notes: String(payload.notes || '').trim()
  };
}

function normalizeAppointmentRequest_(payload) {
  payload = payload || {};
  var email = String(payload.email || '').trim().toLowerCase();
  var vendorCode = digitsOnly_(payload.vendorCode);
  var ocNumber = digitsOnly_(payload.ocNumber || '');
  var startIso = String(payload.startIso || '').trim();

  if (!vendorCode) {
    throw new Error('Falta el codigo del proveedor.');
  }
  if (!email || !isValidEmail_(email)) {
    throw new Error('Falta un correo valido.');
  }
  if (!startIso) {
    throw new Error('Selecciona un horario.');
  }
  if (payload.ocNumber && !ocNumber) {
    throw new Error('La OC solo debe contener numeros.');
  }

  return {
    providerId: String(payload.providerId || '').trim(),
    vendorCode: vendorCode,
    email: email,
    ocNumber: ocNumber,
    startIso: trimToMinute_(startIso),
    notes: String(payload.notes || '').trim()
  };
}

function sendProviderApprovalEmail_(provider) {
  if (!provider.email) {
    return;
  }
  var subject = 'Proveedor aprobado para solicitar citas';
  var body = [
    '<p>Hola ' + escapeHtml_(provider.contactName || provider.vendorName) + ',</p>',
    '<p>Tu registro fue aprobado por Grupo Santis.</p>',
    '<p>Desde este momento ya puedes ingresar al portal del proveedor y solicitar una cita disponible.</p>',
    '<p>Proveedor: <strong>' + escapeHtml_(provider.vendorName) + '</strong><br>',
    'Código de proveedor: <strong>' + escapeHtml_(provider.vendorCode) + '</strong></p>'
  ].join('');
  MailApp.sendEmail({
    to: provider.email,
    subject: subject,
    htmlBody: body
  });
}

function sendAppointmentEmail_(appointment, isReschedule) {
  if (!appointment.email) {
    return;
  }

  var start = parseLocalDateTime_(appointment.effectiveStart);
  var subject = isReschedule ? 'Cita de proveedor reasignada' : 'Cita de proveedor aprobada';
  var body = [
    '<p>Estimado proveedor,</p>',
    '<p>Tu cita fue ' + (isReschedule ? 'reasignada y confirmada' : 'aprobada') + '.</p>',
    '<p><strong>Presenta este correo en recepción o consérvalo como constancia digital.</strong></p>',
    '<table style="border-collapse:collapse;">',
    '<tr><td style="padding:4px 10px 4px 0;"><strong>Proveedor</strong></td><td>' + escapeHtml_(appointment.vendorName) + '</td></tr>',
    '<tr><td style="padding:4px 10px 4px 0;"><strong>Código</strong></td><td>' + escapeHtml_(appointment.vendorCode) + '</td></tr>',
    '<tr><td style="padding:4px 10px 4px 0;"><strong>Fecha</strong></td><td>' + escapeHtml_(formatLongDate_(start)) + '</td></tr>',
    '<tr><td style="padding:4px 10px 4px 0;"><strong>Hora</strong></td><td>' + escapeHtml_(appointment.slotLabel) + '</td></tr>',
    '<tr><td style="padding:4px 10px 4px 0;"><strong>Código de acceso</strong></td><td>' + escapeHtml_(appointment.accessCode) + '</td></tr>',
    '<tr><td style="padding:4px 10px 4px 0;"><strong>OC</strong></td><td>' + escapeHtml_(appointment.ocNumber || 'No registrada') + '</td></tr>',
    '</table>',
    appointment.outsideSchedule === 'SI'
      ? '<p>Esta cita fue coordinada fuera del horario habitual.</p>'
      : '',
    appointment.notes ? '<p>Observaciones: ' + escapeHtml_(appointment.notes) + '</p>' : ''
  ].join('');

  MailApp.sendEmail({
    to: appointment.email,
    subject: subject,
    htmlBody: body
  });

  appointment.mailSentAt = nowIso_();
  saveRecord_(APP_DEFAULTS.sheets.appointments, appointment, 'appointmentId', appointment._rowNumber);
}

function audit_(eventType, recordId, actor, details) {
  saveRecord_(APP_DEFAULTS.sheets.audit, {
    timestamp: nowIso_(),
    eventType: eventType,
    recordId: recordId,
    actor: actor,
    details: details
  }, 'recordId');
}

function hasSapCatalog_() {
  return getSheetData_(APP_DEFAULTS.sheets.sap).length > 0;
}

function getMode_(e) {
  return e && e.parameter && e.parameter.mode === 'supervisor' ? 'supervisor' : 'proveedor';
}

function getApproverName_() {
  return getRuntimeConfig_().supervisorName;
}

function isSupervisorProtected_() {
  var key = PropertiesService.getScriptProperties().getProperty(APP_DEFAULTS.securityProperty);
  return Boolean(key);
}

function assertSupervisorAccess_(accessKey) {
  var storedKey = PropertiesService.getScriptProperties().getProperty(APP_DEFAULTS.securityProperty);
  if (!storedKey) {
    return true;
  }
  if (String(accessKey || '').trim() !== storedKey) {
    throw new Error('Clave de supervisor invalida.');
  }
  return true;
}

function getScheduleForDate_(date) {
  var day = date.getDay();
  if (day >= 1 && day <= 3) {
    return { startHour: 8, startMinute: 0, endHour: 16, endMinute: 0 };
  }
  return { startHour: 8, startMinute: 0, endHour: 12, endMinute: 30 };
}

function isWithinSchedule_(date) {
  if (!isBusinessDay_(date)) {
    return false;
  }
  var schedule = getScheduleForDate_(date);
  var start = makeDateTime_(formatDate_(date), schedule.startHour, schedule.startMinute);
  var end = makeDateTime_(formatDate_(date), schedule.endHour, schedule.endMinute);
  return date >= start && addMinutes_(date, getRuntimeConfig_().slotMinutes) <= end;
}

function isBusinessDay_(date) {
  var day = date.getDay();
  return day >= 1 && day <= 5;
}

function formatDate_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function formatDateTime_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm");
}

function nowIso_() {
  return formatDateTime_(new Date());
}

function formatSlotLabel_(start, end) {
  return Utilities.formatDate(start, Session.getScriptTimeZone(), 'HH:mm') + ' - ' +
    Utilities.formatDate(end, Session.getScriptTimeZone(), 'HH:mm');
}

function formatLongDate_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "EEEE dd 'de' MMMM 'de' yyyy");
}

function weekdayName_(date) {
  var names = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];
  return names[date.getDay()];
}

function parseLocalDate_(value) {
  var parts = String(value).split('-');
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 0, 0, 0, 0);
}

function parseLocalDateTime_(value) {
  var normalized = trimToMinute_(value);
  var parts = normalized.split('T');
  if (parts.length !== 2) {
    throw new Error('Fecha y hora invalida.');
  }
  var dateParts = parts[0].split('-');
  var timeParts = parts[1].split(':');
  return new Date(
    Number(dateParts[0]),
    Number(dateParts[1]) - 1,
    Number(dateParts[2]),
    Number(timeParts[0]),
    Number(timeParts[1]),
    0,
    0
  );
}

function makeDateTime_(dateText, hour, minute) {
  var date = parseLocalDate_(dateText);
  date.setHours(hour, minute, 0, 0);
  return date;
}

function addDays_(date, days) {
  var result = new Date(date.getTime());
  result.setDate(result.getDate() + days);
  return result;
}

function addMinutes_(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

function cleanRow_(row) {
  var copy = {};
  Object.keys(row).forEach(function(key) {
    if (key.indexOf('_') === 0) {
      return;
    }
    copy[key] = row[key];
  });
  return copy;
}

function nextId_(prefix) {
  return prefix + '-' + Utilities.getUuid().split('-')[0].toUpperCase();
}

function generateProviderCode_() {
  return 'PRV' + Utilities.getUuid().replace(/-/g, '').slice(0, 6).toUpperCase();
}

function generateAccessCode_() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function appendNote_(current, note) {
  var trimmedNote = String(note || '').trim();
  if (!trimmedNote) {
    return String(current || '').trim();
  }
  if (!current) {
    return nowIso_() + ' - ' + trimmedNote;
  }
  return current + '\n' + nowIso_() + ' - ' + trimmedNote;
}

function sortByDateField_(fieldName) {
  return function(left, right) {
    return String(left[fieldName] || '').localeCompare(String(right[fieldName] || ''));
  };
}

function sameText_(left, right) {
  return String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase();
}

function digitsOnly_(value) {
  return String(value || '').replace(/\D/g, '');
}

function trimToMinute_(value) {
  return String(value || '').trim().slice(0, 16);
}

function isValidEmail_(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function stringToBoolean_(value) {
  return String(value || '').toUpperCase() === 'TRUE';
}

function escapeHtml_(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseJsonBody_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    return {};
  }

  try {
    return JSON.parse(e.postData.contents);
  } catch (error) {
    throw new Error('El cuerpo JSON no es valido.');
  }
}

function getApiAction_(e, payload) {
  var queryAction = e && e.parameter ? String(e.parameter.action || '').trim() : '';
  var bodyAction = payload && payload.action ? String(payload.action).trim() : '';
  var action = queryAction || bodyAction;
  if (!action) {
    throw new Error('Falta la accion API.');
  }
  return action;
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

// Authentication and account flow overrides for provider portal.
function getProviderDashboard(criteria) {
  ensureSheets_();
  criteria = criteria || {};
  var provider = criteria.sessionToken
    ? getProviderBySession_(criteria.sessionToken)
    : findProvider_(criteria);
  if (!provider) {
    return {
      found: false,
      message: 'No encontramos una cuenta activa con esos datos.'
    };
  }
  return buildProviderDashboardResponse_(provider, criteria.startDate || formatDate_(new Date()));
}

function providerLogin(payload) {
  ensureSheets_();
  payload = payload || {};
  var clean = normalizeLoginPayload_(payload);
  var provider = findProvider_({ email: clean.email });
  if (!provider || !provider.passwordHash) {
    throw new Error('No encontramos una cuenta activa con ese correo.');
  }
  if (!verifyPassword_(clean.password, provider.passwordSalt, provider.passwordHash)) {
    throw new Error('La contrasena no es correcta.');
  }
  return createAuthenticatedProviderResponse_(provider, payload.startDate || formatDate_(new Date()));
}

function registerProvider(payload) {
  ensureSheets_();
  var clean = normalizeProviderPayload_(payload);
  var sapResult = validateVendorAgainstSap_(clean.sapVendorCode, clean.taxId);
  if (!sapResult.matched) {
    throw new Error('Solo pueden registrarse proveedores existentes en SAP.');
  }
  if (!sapResult.active) {
    throw new Error('El proveedor existe en SAP pero no esta habilitado para este proceso. Contacta a Grupo Santis.');
  }

  var existing = findProvider_({
    taxId: clean.taxId,
    vendorCode: sapResult.sapVendorCode || clean.sapVendorCode,
    email: clean.email
  });

  if (existing && existing.email && !sameText_(existing.email, clean.email)) {
    throw new Error('Este proveedor ya tiene un correo registrado. El cambio de correo solo puede hacerlo Grupo Santis.');
  }
  if (existing && existing.passwordHash) {
    throw new Error('Este proveedor ya tiene una cuenta activa. Usa el inicio de sesion o la recuperacion de contrasena.');
  }

  var now = nowIso_();
  var salt = generateSalt_();
  var record = existing || {};
  record.providerId = record.providerId || nextId_('PRV');
  record.vendorCode = record.vendorCode || generateProviderCode_();
  record.vendorName = sapResult.vendorName || clean.vendorName;
  record.taxId = clean.taxId;
  record.contactName = clean.contactName;
  record.email = clean.email;
  record.phone = clean.phone;
  record.ocNumber = record.ocNumber || '';
  record.sapStatus = sapResult.status;
  record.createdAt = record.createdAt || now;
  record.updatedAt = now;
  record.notes = clean.notes;
  record.passwordSalt = salt;
  record.passwordHash = hashSecret_(clean.password, salt);
  record.resetTokenHash = '';
  record.resetTokenExpiresAt = '';

  if (record.registrationStatus !== PROVIDER_STATUS.APPROVED) {
    record.registrationStatus = PROVIDER_STATUS.PENDING;
    record.approvedBy = '';
    record.approvedAt = '';
  }

  saveRecord_(APP_DEFAULTS.sheets.providers, record, 'providerId', existing && existing._rowNumber);
  audit_('PROVEEDOR_REGISTRO', record.providerId, record.email, 'Proveedor registrado con cuenta y contrasena.');

  var authResponse = createAuthenticatedProviderResponse_(record, formatDate_(new Date()));
  authResponse.message = record.registrationStatus === PROVIDER_STATUS.APPROVED
    ? 'Tu cuenta fue activada correctamente. Ya puedes solicitar citas.'
    : 'Tu cuenta fue creada. Grupo Santis validara y autorizara tu alta antes de solicitar citas.';
  authResponse.sap = sapResult;
  return authResponse;
}

function requestPasswordReset(payload) {
  ensureSheets_();
  payload = payload || {};
  var email = String(payload.email || '').trim().toLowerCase();
  if (!email || !isValidEmail_(email)) {
    throw new Error('Ingresa un correo valido.');
  }
  var provider = findProvider_({ email: email });
  if (provider && provider.passwordHash) {
    var recoveryCode = generateRecoveryCode_();
    provider.resetTokenHash = hashPlain_(recoveryCode);
    provider.resetTokenExpiresAt = formatDateTime_(addMinutes_(new Date(), 30));
    provider.updatedAt = nowIso_();
    saveRecord_(APP_DEFAULTS.sheets.providers, provider, 'providerId', provider._rowNumber);
    sendPasswordResetEmail_(provider, recoveryCode);
    audit_('PASSWORD_RESET_REQUEST', provider.providerId, provider.email, 'Solicitud de recuperacion enviada.');
  }
  return {
    ok: true,
    message: 'Si encontramos una cuenta con ese correo, te enviaremos instrucciones de recuperacion.'
  };
}

function resetPassword(payload) {
  ensureSheets_();
  payload = payload || {};
  var clean = normalizePasswordResetPayload_(payload);
  var provider = findProvider_({ email: clean.email });
  if (!provider || !provider.resetTokenHash) {
    throw new Error('La solicitud de recuperacion no es valida o ya expiro.');
  }
  if (provider.resetTokenExpiresAt && parseLocalDateTime_(provider.resetTokenExpiresAt) < new Date()) {
    throw new Error('La solicitud de recuperacion ya expiro. Solicita una nueva.');
  }
  if (provider.resetTokenHash !== hashPlain_(clean.resetCode)) {
    throw new Error('El codigo de recuperacion no es correcto.');
  }

  var salt = generateSalt_();
  provider.passwordSalt = salt;
  provider.passwordHash = hashSecret_(clean.password, salt);
  provider.resetTokenHash = '';
  provider.resetTokenExpiresAt = '';
  provider.sessionTokenHash = '';
  provider.sessionTokenExpiresAt = '';
  provider.updatedAt = nowIso_();
  saveRecord_(APP_DEFAULTS.sheets.providers, provider, 'providerId', provider._rowNumber);
  audit_('PASSWORD_RESET_SUCCESS', provider.providerId, provider.email, 'Contrasena restablecida.');

  return {
    ok: true,
    message: 'Tu contrasena fue actualizada. Ya puedes iniciar sesion.'
  };
}

function recoverEmailByTaxId(payload) {
  ensureSheets_();
  payload = payload || {};
  var taxId = digitsOnly_(payload.taxId);
  if (!taxId) {
    throw new Error('Ingresa un RUC valido.');
  }
  var provider = findProvider_({ taxId: taxId });
  if (!provider || !provider.email) {
    throw new Error('No encontramos una cuenta registrada con ese RUC.');
  }
  return {
    ok: true,
    message: 'El correo asociado a este RUC es ' + maskEmail_(provider.email) + '. Si necesitas cambiarlo, solo Grupo Santis puede hacerlo.',
    maskedEmail: maskEmail_(provider.email)
  };
}

function requestAppointment(payload) {
  ensureSheets_();
  payload = payload || {};
  var clean = normalizeAppointmentRequest_(payload);
  var provider = clean.sessionToken
    ? getProviderBySession_(clean.sessionToken)
    : findProvider_({
        providerId: clean.providerId,
        vendorCode: clean.vendorCode,
        email: clean.email
      });

  if (!provider) {
    throw new Error('Primero inicia sesion con una cuenta valida.');
  }
  if (provider.registrationStatus !== PROVIDER_STATUS.APPROVED) {
    throw new Error('El proveedor aun no esta aprobado por Grupo Santis.');
  }

  var slotStart = parseLocalDateTime_(clean.startIso);
  validateSlotRequest_(slotStart);
  assertSlotAvailable_(clean.startIso, '');

  var slotEnd = addMinutes_(slotStart, getRuntimeConfig_().slotMinutes);
  var appointment = {
    appointmentId: nextId_('CIT'),
    providerId: provider.providerId,
    vendorCode: provider.vendorCode,
    vendorName: provider.vendorName,
    email: provider.email,
    ocNumber: clean.ocNumber || provider.ocNumber || '',
    requestedStart: clean.startIso,
    requestedEnd: formatDateTime_(slotEnd),
    effectiveStart: clean.startIso,
    effectiveEnd: formatDateTime_(slotEnd),
    slotDate: formatDate_(slotStart),
    slotLabel: formatSlotLabel_(slotStart, slotEnd),
    appointmentStatus: APPOINTMENT_STATUS.PENDING,
    outsideSchedule: 'NO',
    requestedAt: nowIso_(),
    approvedAt: '',
    approvedBy: '',
    accessCode: '',
    mailSentAt: '',
    notes: clean.notes
  };

  saveRecord_(APP_DEFAULTS.sheets.appointments, appointment, 'appointmentId');
  audit_('CITA_SOLICITADA', appointment.appointmentId, provider.email, appointment.slotLabel);

  return {
    ok: true,
    message: 'Tu solicitud de cita fue registrada y queda pendiente de aprobacion.',
    appointment: cleanRow_(appointment)
  };
}

function buildProviderDashboardResponse_(provider, startDate) {
  var config = getRuntimeConfig_();
  return {
    found: true,
    provider: cleanRow_(provider),
    warnings: buildProviderWarnings_(provider),
    appointments: getProviderAppointments_(provider.providerId),
    canRequestAppointments: provider.registrationStatus === PROVIDER_STATUS.APPROVED,
    calendar: provider.registrationStatus === PROVIDER_STATUS.APPROVED
      ? buildCalendar_(startDate, config.lookaheadDays, false)
      : null
  };
}

function createAuthenticatedProviderResponse_(provider, startDate) {
  var session = createProviderSession_(provider);
  return {
    ok: true,
    message: 'Sesion iniciada correctamente.',
    sessionToken: session.token,
    sessionExpiresAt: session.expiresAt,
    dashboard: buildProviderDashboardResponse_(provider, startDate || formatDate_(new Date()))
  };
}

function createProviderSession_(provider) {
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  provider.sessionTokenHash = hashPlain_(token);
  provider.sessionTokenExpiresAt = formatDateTime_(addDays_(new Date(), 1));
  provider.updatedAt = nowIso_();
  saveRecord_(APP_DEFAULTS.sheets.providers, provider, 'providerId', provider._rowNumber);
  return {
    token: token,
    expiresAt: provider.sessionTokenExpiresAt
  };
}

function getProviderBySession_(sessionToken) {
  if (!sessionToken) {
    return null;
  }
  var tokenHash = hashPlain_(String(sessionToken || '').trim());
  var provider = getSheetData_(APP_DEFAULTS.sheets.providers).find(function(row) {
    return row.sessionTokenHash && row.sessionTokenHash === tokenHash;
  });
  if (!provider) {
    return null;
  }
  if (provider.sessionTokenExpiresAt && parseLocalDateTime_(provider.sessionTokenExpiresAt) < new Date()) {
    provider.sessionTokenHash = '';
    provider.sessionTokenExpiresAt = '';
    saveRecord_(APP_DEFAULTS.sheets.providers, provider, 'providerId', provider._rowNumber);
    return null;
  }
  return provider;
}

function normalizeProviderPayload_(payload) {
  payload = payload || {};
  var email = String(payload.email || '').trim().toLowerCase();
  var taxId = digitsOnly_(payload.taxId);
  var sapVendorCode = digitsOnly_(payload.sapVendorCode || '');
  var password = String(payload.password || '').trim();
  var passwordConfirm = String(payload.passwordConfirm || '').trim();

  if (!taxId) {
    throw new Error('El RUC o documento es obligatorio.');
  }
  if (!email || !isValidEmail_(email)) {
    throw new Error('Debes registrar un correo valido.');
  }
  validatePasswordStrength_(password);
  if (password !== passwordConfirm) {
    throw new Error('La confirmacion de contrasena no coincide.');
  }

  return {
    vendorName: String(payload.vendorName || '').trim(),
    taxId: taxId,
    sapVendorCode: sapVendorCode,
    contactName: String(payload.contactName || '').trim(),
    email: email,
    phone: String(payload.phone || '').trim(),
    notes: String(payload.notes || '').trim(),
    password: password
  };
}

function normalizeLoginPayload_(payload) {
  var email = String(payload.email || '').trim().toLowerCase();
  var password = String(payload.password || '').trim();
  if (!email || !isValidEmail_(email)) {
    throw new Error('Ingresa un correo valido.');
  }
  if (!password) {
    throw new Error('Ingresa tu contrasena.');
  }
  return {
    email: email,
    password: password
  };
}

function normalizePasswordResetPayload_(payload) {
  var email = String(payload.email || '').trim().toLowerCase();
  var resetCode = String(payload.resetCode || '').trim().toUpperCase();
  var password = String(payload.password || '').trim();
  var passwordConfirm = String(payload.passwordConfirm || '').trim();
  if (!email || !isValidEmail_(email)) {
    throw new Error('Ingresa un correo valido.');
  }
  if (!resetCode) {
    throw new Error('Ingresa el codigo de recuperacion.');
  }
  validatePasswordStrength_(password);
  if (password !== passwordConfirm) {
    throw new Error('La confirmacion de contrasena no coincide.');
  }
  return {
    email: email,
    resetCode: resetCode,
    password: password
  };
}

function normalizeAppointmentRequest_(payload) {
  payload = payload || {};
  var email = String(payload.email || '').trim().toLowerCase();
  var vendorCode = digitsOnly_(payload.vendorCode);
  var ocNumber = digitsOnly_(payload.ocNumber || '');
  var startIso = String(payload.startIso || '').trim();
  var sessionToken = String(payload.sessionToken || '').trim();

  if (!sessionToken) {
    if (!vendorCode) {
      throw new Error('Falta el codigo del proveedor.');
    }
    if (!email || !isValidEmail_(email)) {
      throw new Error('Falta un correo valido.');
    }
  }
  if (!startIso) {
    throw new Error('Selecciona un horario.');
  }
  if (payload.ocNumber && !ocNumber) {
    throw new Error('La OC solo debe contener numeros.');
  }

  return {
    providerId: String(payload.providerId || '').trim(),
    vendorCode: vendorCode,
    email: email,
    ocNumber: ocNumber,
    startIso: trimToMinute_(startIso),
    notes: String(payload.notes || '').trim(),
    sessionToken: sessionToken
  };
}

function validateVendorAgainstSap_(vendorCode, taxId) {
  var catalog = getSheetData_(APP_DEFAULTS.sheets.sap);
  var vendorDigits = digitsOnly_(vendorCode);
  var taxDigits = digitsOnly_(taxId);
  var match = catalog.find(function(row) {
    var codeMatch = vendorDigits && digitsOnly_(row.vendorCode) === vendorDigits;
    var taxMatch = taxDigits && digitsOnly_(row.taxId) === taxDigits;
    return codeMatch || taxMatch;
  });
  if (!match) {
    return {
      catalogLoaded: catalog.length > 0,
      matched: false,
      status: catalog.length ? 'NO_ENCONTRADO' : 'SIN_PADRON',
      vendorName: '',
      sapVendorCode: '',
      active: false
    };
  }
  var isActive = !String(match.active || '').trim() || String(match.active).toUpperCase() === 'TRUE' || String(match.active).toUpperCase() === 'ACTIVO';
  return {
    catalogLoaded: true,
    matched: true,
    status: isActive ? 'VALIDADO' : 'INACTIVO',
    vendorName: match.vendorName || '',
    sapVendorCode: String(match.vendorCode || '').trim(),
    active: isActive
  };
}

function buildProviderWarnings_(provider) {
  var warnings = [];
  if (provider.sapStatus === 'SIN_PADRON') {
    warnings.push('No hay un padron SAP cargado aun. La validacion se hara manualmente.');
  }
  if (provider.sapStatus === 'NO_ENCONTRADO') {
    warnings.push('El proveedor no fue encontrado en SAP y debe revisarse manualmente.');
  }
  if (provider.registrationStatus === PROVIDER_STATUS.PENDING) {
    warnings.push('Grupo Santis debe validar primero el alta del proveedor.');
  }
  if (provider.registrationStatus === PROVIDER_STATUS.APPROVED) {
    warnings.push('Si necesitas cambiar tu correo, la actualizacion solo puede hacerla Grupo Santis.');
  }
  return warnings;
}

function findProvider_(criteria) {
  criteria = criteria || {};
  var providers = getSheetData_(APP_DEFAULTS.sheets.providers);
  return providers.find(function(row) {
    if (criteria.providerId && sameText_(row.providerId, criteria.providerId)) {
      return true;
    }
    if (criteria.vendorCode && criteria.email) {
      return sameText_(row.vendorCode, criteria.vendorCode) && sameText_(row.email, criteria.email);
    }
    if (criteria.taxId && digitsOnly_(row.taxId) === digitsOnly_(criteria.taxId)) {
      return true;
    }
    if (criteria.vendorCode && sameText_(row.vendorCode, criteria.vendorCode)) {
      return true;
    }
    if (criteria.email && sameText_(row.email, criteria.email)) {
      return true;
    }
    return false;
  });
}

function cleanRow_(row) {
  var copy = {};
  Object.keys(row).forEach(function(key) {
    if (key.indexOf('_') === 0 || SENSITIVE_FIELDS[key]) {
      return;
    }
    copy[key] = row[key];
  });
  return copy;
}

function validatePasswordStrength_(password) {
  if (String(password || '').length < 8) {
    throw new Error('La contrasena debe tener al menos 8 caracteres.');
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new Error('La contrasena debe incluir letras y numeros.');
  }
}

function generateSalt_() {
  return Utilities.getUuid().replace(/-/g, '');
}

function hashSecret_(value, salt) {
  return hashPlain_(String(salt || '') + '::' + String(value || ''));
}

function hashPlain_(value) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value || ''), Utilities.Charset.UTF_8);
  return digest.map(function(byte) {
    var normalized = byte < 0 ? byte + 256 : byte;
    return ('0' + normalized.toString(16)).slice(-2);
  }).join('');
}

function verifyPassword_(password, salt, storedHash) {
  return hashSecret_(password, salt) === storedHash;
}

function generateRecoveryCode_() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function maskEmail_(email) {
  var value = String(email || '').trim().toLowerCase();
  var parts = value.split('@');
  if (parts.length !== 2) {
    return value;
  }
  var local = parts[0];
  var domain = parts[1];
  var visible = local.slice(0, 2);
  return visible + '***@' + domain;
}

function sendPasswordResetEmail_(provider, recoveryCode) {
  if (!provider.email) {
    return;
  }
  var subject = 'Recuperacion de contrasena - Portal de proveedores';
  var body = [
    '<p>Hola ' + escapeHtml_(provider.contactName || provider.vendorName) + ',</p>',
    '<p>Recibimos una solicitud para restablecer tu contrasena del portal de proveedores.</p>',
    '<p>Usa este codigo de recuperacion: <strong style="font-size:20px;">' + escapeHtml_(recoveryCode) + '</strong></p>',
    '<p>El codigo vence en 30 minutos.</p>',
    '<p>Si no reconoces esta solicitud, ignora este correo.</p>'
  ].join('');
  MailApp.sendEmail({
    to: provider.email,
    subject: subject,
    htmlBody: body
  });
}

function sendProviderApprovalEmail_(provider) {
  if (!provider.email) {
    return;
  }
  var subject = 'Proveedor aprobado para solicitar citas';
  var body = [
    '<p>Hola ' + escapeHtml_(provider.contactName || provider.vendorName) + ',</p>',
    '<p>Tu cuenta fue aprobada por Grupo Santis.</p>',
    '<p>Desde este momento ya puedes ingresar al portal del proveedor con tu correo y tu contrasena para solicitar una cita disponible.</p>',
    '<p>Proveedor: <strong>' + escapeHtml_(provider.vendorName) + '</strong><br>',
    'Codigo de proveedor: <strong>' + escapeHtml_(provider.vendorCode) + '</strong></p>'
  ].join('');
  MailApp.sendEmail({
    to: provider.email,
    subject: subject,
    htmlBody: body
  });
}
