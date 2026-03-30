const DEFAULT_APPS_SCRIPT_PROVIDER_API_URL = "https://script.google.com/macros/s/AKfycbzz7emGORk7cndKMSIAsOICyZ9ROyDBX9SkXM4iVm02KA0KAIePqJjXrDqs9u_V8imA/exec";

export async function proxyAction(context, forcedAction) {
  const { request, env, params } = context;
  const action = forcedAction || (params && params.action) || "";

  if (!action) {
    return json({
      ok: false,
      error: "Falta la accion API."
    }, 400);
  }

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  let payload = {};
  if (request.method !== "GET") {
    try {
      payload = await request.json();
    } catch (error) {
      payload = {};
    }
  }

  const upstreamUrl = env.APPS_SCRIPT_PROVIDER_API_URL || DEFAULT_APPS_SCRIPT_PROVIDER_API_URL;
  let upstreamResponse = await fetch(`${upstreamUrl}?action=${encodeURIComponent(action)}`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      action,
      ...payload
    }),
    redirect: "manual"
  });

  if (isRedirectStatus(upstreamResponse.status)) {
    const redirectUrl = upstreamResponse.headers.get("location");
    if (redirectUrl) {
      upstreamResponse = await fetch(redirectUrl, {
        method: "GET",
        headers: {
          "accept": "application/json"
        },
        redirect: "follow"
      });
    }
  }

  const text = await upstreamResponse.text();
  const contentType = upstreamResponse.headers.get("content-type") || "";

  if (!contentType.includes("application/json")) {
    console.warn("Apps Script upstream did not return JSON", {
      action,
      upstreamStatus: upstreamResponse.status,
      contentType
    });

    return json({
      ok: false,
      error: errorForAction(action)
    }, 502);
  }

  return new Response(text, {
    status: upstreamResponse.ok ? 200 : 502,
    headers: {
      ...corsHeaders(),
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store"
    }
  });
}

function isRedirectStatus(status) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders(),
      "content-type": "application/json; charset=UTF-8"
    }
  });
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type"
  };
}

function errorForAction(action) {
  switch (action) {
    case "providerBootstrap":
    case "providerDashboard":
      return "No pudimos cargar la disponibilidad en este momento. Intenta nuevamente en unos minutos.";
    case "supervisorBootstrap":
    case "supervisorDashboard":
      return "No pudimos cargar el panel interno en este momento. Intenta nuevamente en unos minutos.";
    case "lookupRegistrationByTaxId":
      return "No pudimos validar la OC en este momento. Intenta nuevamente en unos minutos.";
    case "lookupProviderReference":
      return "No pudimos validar la referencia en este momento. Intenta nuevamente en unos minutos.";
    case "registerProvider":
      return "No pudimos completar tu registro en este momento. Intenta nuevamente en unos minutos.";
    case "providerLogin":
    case "providerAccess":
      return "No pudimos iniciar sesi\u00f3n en este momento. Intenta nuevamente en unos minutos.";
    case "requestAppointment":
      return "No pudimos registrar tu solicitud en este momento. Intenta nuevamente en unos minutos.";
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
