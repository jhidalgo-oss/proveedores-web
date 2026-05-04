const APPOINTMENT_ACTIVE_STATUSES = ["SOLICITADA", "APROBADA", "REASIGNADA"];
const APPOINTMENT_STATUSES = ["SOLICITADA", "APROBADA", "RECHAZADA", "REASIGNADA", "CANCELADA"];
const PROVIDER_STATUS_APPROVED = "APROBADO";

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (error) {
      console.error("Unhandled API error", error);
      return json({ ok: false, error: "Error interno del servidor." }, 500, request, env);
    }
  }
};

async function route(request, env) {
  const url = new URL(request.url);
  const path = normalizePath(url.pathname);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  }

  if (request.method === "GET" && path === "/health") {
    return json({ ok: true, service: "proveedores-api", timestamp: nowIso() }, 200, request, env);
  }

  if (request.method === "POST" && path === "/auth/login") {
    return login(request, env);
  }
  if (request.method === "GET" && path === "/auth/validate") {
    return validateSession(request, env);
  }
  if (request.method === "GET" && path === "/delivery-points") {
    return listDeliveryPoints(request, env);
  }
  if (request.method === "GET" && path === "/provider/my-appointments") {
    return listProviderAppointments(request, env);
  }
  if (request.method === "POST" && path === "/provider/request-appointment") {
    return requestAppointment(request, env);
  }
  if (request.method === "GET" && path === "/supervisor/appointments") {
    return listSupervisorAppointments(request, env);
  }
  if (request.method === "POST" && path === "/supervisor/approve") {
    return approveAppointment(request, env);
  }
  if (request.method === "POST" && path === "/supervisor/reassign") {
    return reassignAppointment(request, env);
  }
  if (request.method === "POST" && path === "/sap/sync") {
    return syncSapPurchaseOrders(request, env);
  }

  return json({ ok: false, error: "Ruta no encontrada." }, 404, request, env);
}

async function login(request, env) {
  const body = await readJson(request);
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");

  if (!isValidEmail(email) || !password) {
    return json({ ok: false, error: "Correo o contraseña inválidos." }, 400, request, env);
  }

  const provider = await env.DB.prepare(
    `SELECT * FROM providers WHERE lower(email) = ? LIMIT 1`
  ).bind(email).first();

  if (!provider || provider.status !== PROVIDER_STATUS_APPROVED) {
    return json({ ok: false, error: "No encontramos una cuenta activa con esos datos." }, 401, request, env);
  }

  const computedHash = await sha256Hex(`${provider.password_salt || ""}::${password}`);
  if (computedHash !== provider.password_hash) {
    return json({ ok: false, error: "No encontramos una cuenta activa con esos datos." }, 401, request, env);
  }

  const session = await createSession(env, provider.id);
  await audit(env, "LOGIN", provider.id, provider.email, "Inicio de sesión proveedor.");

  return json({
    ok: true,
    sessionToken: session.token,
    sessionExpiresAt: session.expiresAt,
    provider: publicProvider(provider)
  }, 200, request, env);
}

async function validateSession(request, env) {
  const auth = await requireProviderSession(request, env);
  if (auth.response) {
    return auth.response;
  }
  return json({ ok: true, provider: publicProvider(auth.provider) }, 200, request, env);
}

async function listDeliveryPoints(request, env) {
  const rows = await env.DB.prepare(
    `SELECT id, name, description, active, sort_order
     FROM delivery_points
     WHERE active = 1
     ORDER BY sort_order ASC, name ASC`
  ).all();
  return json({ ok: true, deliveryPoints: rows.results || [] }, 200, request, env);
}

async function listProviderAppointments(request, env) {
  const auth = await requireProviderSession(request, env);
  if (auth.response) {
    return auth.response;
  }

  const rows = await env.DB.prepare(
    `SELECT a.*, dp.name AS delivery_point_name
     FROM appointments a
     LEFT JOIN delivery_points dp ON dp.id = a.delivery_point_id
     WHERE a.provider_id = ?
     ORDER BY a.date DESC, a.start_time DESC
     LIMIT 100`
  ).bind(auth.provider.id).all();

  return json({ ok: true, appointments: rows.results || [] }, 200, request, env);
}

async function requestAppointment(request, env) {
  const auth = await requireProviderSession(request, env);
  if (auth.response) {
    return auth.response;
  }

  const body = await readJson(request);
  const date = normalizeDate(body.date || body.fecha || dateFromStartIso(body.startIso));
  const startTime = normalizeTime(body.startTime || body.hora || timeFromStartIso(body.startIso));
  const durationMinutes = normalizeDuration(body.durationMinutes || body.duracion || body.duration);
  const deliveryPointId = String(body.deliveryPointId || body.punto_entrega || body.delivery_point_id || "").trim();
  const poNumber = String(body.poNumber || body.ocNumber || body.oc_number || "").trim();
  const notes = String(body.notes || body.notas || "").trim();

  if (!date || !startTime || !durationMinutes || !deliveryPointId) {
    return json({
      ok: false,
      error: "Faltan datos para registrar la cita.",
      required: ["sessionToken", "fecha", "hora", "duracion", "punto_entrega"]
    }, 400, request, env);
  }

  const deliveryPoint = await env.DB.prepare(
    `SELECT id, name FROM delivery_points WHERE id = ? AND active = 1 LIMIT 1`
  ).bind(deliveryPointId).first();
  if (!deliveryPoint) {
    return json({ ok: false, error: "Punto de entrega no disponible." }, 400, request, env);
  }

  const endTime = addMinutesToTime(startTime, durationMinutes);
  const conflict = await findAppointmentConflict(env, {
    date,
    deliveryPointId,
    startTime,
    endTime
  });
  if (conflict) {
    return json({ ok: false, error: "Ese horario ya está ocupado para el punto de entrega seleccionado." }, 409, request, env);
  }

  const id = `CIT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const timestamp = nowIso();

  await env.DB.prepare(
    `INSERT INTO appointments (
      id, provider_id, vendor_code, vendor_name, email, delivery_point_id, po_number,
      date, start_time, end_time, duration_minutes, status, requested_at, updated_at, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SOLICITADA', ?, ?, ?)`
  ).bind(
    id,
    auth.provider.id,
    auth.provider.vendor_code,
    auth.provider.vendor_name,
    auth.provider.email,
    deliveryPointId,
    poNumber,
    date,
    startTime,
    endTime,
    durationMinutes,
    timestamp,
    timestamp,
    notes
  ).run();

  const appointment = await getAppointment(env, id);
  await audit(env, "CITA_SOLICITADA", id, auth.provider.email, `${date} ${startTime}-${endTime}`);

  return json({
    ok: true,
    message: "Cita registrada.",
    appointment
  }, 201, request, env);
}

async function listSupervisorAppointments(request, env) {
  const guard = requireSupervisor(request, env);
  if (guard) {
    return guard;
  }

  const url = new URL(request.url);
  const status = String(url.searchParams.get("status") || "").trim().toUpperCase();
  const date = normalizeDate(url.searchParams.get("date"));
  const clauses = [];
  const binds = [];

  if (status) {
    if (!APPOINTMENT_STATUSES.includes(status)) {
      return json({ ok: false, error: "Estado inválido." }, 400, request, env);
    }
    clauses.push("a.status = ?");
    binds.push(status);
  }
  if (date) {
    clauses.push("a.date = ?");
    binds.push(date);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await env.DB.prepare(
    `SELECT a.*, dp.name AS delivery_point_name
     FROM appointments a
     LEFT JOIN delivery_points dp ON dp.id = a.delivery_point_id
     ${where}
     ORDER BY a.date ASC, a.start_time ASC
     LIMIT 500`
  ).bind(...binds).all();

  return json({ ok: true, appointments: rows.results || [] }, 200, request, env);
}

async function approveAppointment(request, env) {
  const guard = requireSupervisor(request, env);
  if (guard) {
    return guard;
  }
  const body = await readJson(request);
  const appointmentId = String(body.appointmentId || body.id || "").trim();
  if (!appointmentId) {
    return json({ ok: false, error: "Falta appointmentId." }, 400, request, env);
  }

  const timestamp = nowIso();
  const result = await env.DB.prepare(
    `UPDATE appointments
     SET status = 'APROBADA', approved_at = ?, approved_by = ?, updated_at = ?
     WHERE id = ?`
  ).bind(timestamp, String(body.approvedBy || "Supervisor").trim(), timestamp, appointmentId).run();

  if (!result.meta || result.meta.changes === 0) {
    return json({ ok: false, error: "Cita no encontrada." }, 404, request, env);
  }

  const appointment = await getAppointment(env, appointmentId);
  await audit(env, "CITA_APROBADA", appointmentId, "supervisor", "");
  return json({ ok: true, appointment }, 200, request, env);
}

async function reassignAppointment(request, env) {
  const guard = requireSupervisor(request, env);
  if (guard) {
    return guard;
  }

  const body = await readJson(request);
  const appointmentId = String(body.appointmentId || body.id || "").trim();
  const date = normalizeDate(body.date || body.fecha || dateFromStartIso(body.startIso));
  const startTime = normalizeTime(body.startTime || body.hora || timeFromStartIso(body.startIso));
  const durationMinutes = normalizeDuration(body.durationMinutes || body.duracion || body.duration);
  const deliveryPointId = String(body.deliveryPointId || body.punto_entrega || body.delivery_point_id || "").trim();
  const supervisorNotes = String(body.supervisorNotes || body.notes || "").trim();

  if (!appointmentId || !date || !startTime || !durationMinutes || !deliveryPointId) {
    return json({ ok: false, error: "Faltan datos para reasignar la cita." }, 400, request, env);
  }

  const endTime = addMinutesToTime(startTime, durationMinutes);
  const conflict = await findAppointmentConflict(env, {
    date,
    deliveryPointId,
    startTime,
    endTime,
    excludeAppointmentId: appointmentId
  });
  if (conflict) {
    return json({ ok: false, error: "El nuevo horario cruza con otra cita." }, 409, request, env);
  }

  const timestamp = nowIso();
  const result = await env.DB.prepare(
    `UPDATE appointments
     SET status = 'REASIGNADA', date = ?, start_time = ?, end_time = ?, duration_minutes = ?,
         delivery_point_id = ?, supervisor_notes = ?, updated_at = ?
     WHERE id = ?`
  ).bind(date, startTime, endTime, durationMinutes, deliveryPointId, supervisorNotes, timestamp, appointmentId).run();

  if (!result.meta || result.meta.changes === 0) {
    return json({ ok: false, error: "Cita no encontrada." }, 404, request, env);
  }

  const appointment = await getAppointment(env, appointmentId);
  await audit(env, "CITA_REASIGNADA", appointmentId, "supervisor", `${date} ${startTime}-${endTime}`);
  return json({ ok: true, appointment }, 200, request, env);
}

async function syncSapPurchaseOrders(request, env) {
  const configuredKey = String(env.SAP_SYNC_KEY || "").trim();
  const providedKey = String(request.headers.get("x-sync-key") || "").trim();
  if (configuredKey && providedKey !== configuredKey) {
    return json({ ok: false, error: "No autorizado." }, 401, request, env);
  }

  const body = await readJson(request);
  const rows = Array.isArray(body.purchaseOrders) ? body.purchaseOrders : Array.isArray(body.rows) ? body.rows : [];
  const timestamp = nowIso();

  if (!rows.length) {
    return json({ ok: false, error: "No se recibieron OCs para sincronizar." }, 400, request, env);
  }

  const statements = rows.map((row) => {
    const poNumber = String(row.poNumber || row.DocNum || "").trim();
    const poItem = String(row.poItem || row.LineNum || "").trim();
    if (!poNumber) {
      return null;
    }
    return env.DB.prepare(
      `INSERT INTO purchase_orders (
        po_number, po_item, vendor_code, vendor_name, tax_id, delivery_date, buyer_name,
        item_group_name, material_code, material_description, storage_location,
        ordered_qty, delivered_qty, open_qty, uom, status, last_sync
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(po_number, po_item) DO UPDATE SET
        vendor_code = excluded.vendor_code,
        vendor_name = excluded.vendor_name,
        tax_id = excluded.tax_id,
        delivery_date = excluded.delivery_date,
        buyer_name = excluded.buyer_name,
        item_group_name = excluded.item_group_name,
        material_code = excluded.material_code,
        material_description = excluded.material_description,
        storage_location = excluded.storage_location,
        ordered_qty = excluded.ordered_qty,
        delivered_qty = excluded.delivered_qty,
        open_qty = excluded.open_qty,
        uom = excluded.uom,
        status = excluded.status,
        last_sync = excluded.last_sync`
    ).bind(
      poNumber,
      poItem,
      String(row.vendorCode || row.CardCode || "").trim(),
      String(row.vendorName || row.CardName || "").trim(),
      String(row.taxId || row.RUC || "").trim(),
      normalizeDate(row.deliveryDate || row.ShipDate) || "",
      String(row.buyerName || row.U_NAME || "").trim(),
      String(row.itemGroupName || row.ItmsGrpNam || "").trim(),
      String(row.materialCode || row.ItemCode || "").trim(),
      String(row.materialDescription || row.Dscription || "").trim(),
      String(row.storageLocation || row.WhsCode || "").trim(),
      Number(row.orderedQty || row.Quantity || 0),
      Number(row.deliveredQty || row.CantidadEntregada || 0),
      Number(row.openQty || row.OpenQty || 0),
      String(row.uom || row.UomCode || "").trim(),
      String(row.status || "ABIERTA").trim().toUpperCase(),
      String(row.lastSync || timestamp)
    );
  }).filter(Boolean);

  if (statements.length) {
    await env.DB.batch(statements);
  }

  await audit(env, "SAP_SYNC_OCS", "", "sap-sync", `Filas recibidas: ${rows.length}. Filas aplicadas: ${statements.length}.`);
  return json({ ok: true, received: rows.length, upserted: statements.length, lastSync: timestamp }, 200, request, env);
}

async function requireProviderSession(request, env) {
  const token = extractSessionToken(request);
  if (!token) {
    return { response: json({ ok: false, error: "Sesión requerida." }, 401, request, env) };
  }

  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT s.token_hash, s.expires_at, p.*
     FROM sessions s
     JOIN providers p ON p.id = s.provider_id
     WHERE s.token_hash = ?
     LIMIT 1`
  ).bind(tokenHash).first();

  if (!row || !row.expires_at || row.expires_at <= nowIso()) {
    return { response: json({ ok: false, error: "Sesión vencida o inválida." }, 401, request, env) };
  }

  await env.DB.prepare(
    `UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?`
  ).bind(nowIso(), tokenHash).run();

  return { provider: row, tokenHash };
}

async function createSession(env, providerId) {
  const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const tokenHash = await sha256Hex(token);
  const createdAt = nowIso();
  const ttlHours = Math.max(1, Number(env.SESSION_TTL_HOURS || 24));
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(
    `INSERT INTO sessions (token_hash, provider_id, created_at, expires_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(tokenHash, providerId, createdAt, expiresAt, createdAt).run();
  return { token, expiresAt };
}

async function findAppointmentConflict(env, { date, deliveryPointId, startTime, endTime, excludeAppointmentId = "" }) {
  const placeholders = APPOINTMENT_ACTIVE_STATUSES.map(() => "?").join(", ");
  const binds = [date, deliveryPointId, ...APPOINTMENT_ACTIVE_STATUSES, startTime, endTime];
  let exclusion = "";
  if (excludeAppointmentId) {
    exclusion = " AND id <> ?";
    binds.push(excludeAppointmentId);
  }
  return env.DB.prepare(
    `SELECT id
     FROM appointments
     WHERE date = ?
       AND delivery_point_id = ?
       AND status IN (${placeholders})
       AND start_time < ?
       AND end_time > ?
       ${exclusion}
     LIMIT 1`
  ).bind(...binds).first();
}

async function getAppointment(env, id) {
  return env.DB.prepare(
    `SELECT a.*, dp.name AS delivery_point_name
     FROM appointments a
     LEFT JOIN delivery_points dp ON dp.id = a.delivery_point_id
     WHERE a.id = ?
     LIMIT 1`
  ).bind(id).first();
}

function requireSupervisor(request, env) {
  const expected = String(env.SUPERVISOR_ACCESS_KEY || "").trim();
  if (!expected) {
    return null;
  }
  const provided = String(request.headers.get("x-supervisor-key") || "").trim();
  if (provided !== expected) {
    return json({ ok: false, error: "No autorizado." }, 401, request, env);
  }
  return null;
}

async function audit(env, eventType, recordId, actor, details) {
  try {
    await env.DB.prepare(
      `INSERT INTO audit_logs (id, event_type, record_id, actor, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      `AUD-${crypto.randomUUID()}`,
      String(eventType || "").trim(),
      String(recordId || "").trim(),
      String(actor || "").trim(),
      String(details || "").trim(),
      nowIso()
    ).run();
  } catch (error) {
    console.warn("Audit write failed", error);
  }
}

async function readJson(request) {
  try {
    return await request.json();
  } catch (_error) {
    return {};
  }
}

function extractSessionToken(request) {
  const auth = request.headers.get("authorization") || "";
  if (/^Bearer\s+/i.test(auth)) {
    return auth.replace(/^Bearer\s+/i, "").trim();
  }
  const url = new URL(request.url);
  return String(url.searchParams.get("sessionToken") || "").trim();
}

function publicProvider(row) {
  return {
    id: row.id,
    providerId: row.id,
    vendorCode: row.vendor_code,
    sapVendorCode: row.sap_vendor_code || "",
    vendorName: row.vendor_name,
    taxId: row.tax_id || "",
    contactName: row.contact_name || "",
    email: row.email,
    phone: row.phone || "",
    status: row.status
  };
}

function normalizePath(pathname) {
  const value = String(pathname || "/").replace(/\/+$/, "");
  return value || "/";
}

function normalizeDate(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

function normalizeTime(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{2}):(\d{2})/);
  if (!match) {
    return "";
  }
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    return "";
  }
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function normalizeDuration(value) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes < 30 || minutes > 180 || minutes % 30 !== 0) {
    return 0;
  }
  return minutes;
}

function dateFromStartIso(value) {
  return String(value || "").slice(0, 10);
}

function timeFromStartIso(value) {
  return String(value || "").slice(11, 16);
}

function addMinutesToTime(time, minutes) {
  const [hh, mm] = time.split(":").map(Number);
  const total = hh * 60 + mm + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""));
}

async function sha256Hex(value) {
  const data = new TextEncoder().encode(String(value || ""));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function nowIso() {
  return new Date().toISOString();
}

function json(payload, status, request, env) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders(request, env),
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store"
    }
  });
}

function corsHeaders(request, env) {
  const allowed = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const origin = request.headers.get("origin") || "";
  const allowOrigin = allowed.includes(origin) ? origin : allowed[0] || "*";
  return {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization,x-supervisor-key,x-sync-key",
    "access-control-max-age": "86400"
  };
}
