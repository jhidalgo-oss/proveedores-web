const DEFAULT_APPS_SCRIPT_PROVIDER_API_URL = "https://script.google.com/macros/s/AKfycbzlNaVtfP3dmrqrL_oLeqvxCFJGxNhdhqzNs5ZWHU7zM79qabOfd7hiYR6OCmEhpALw/exec";

export async function onRequest(context) {
  const { request, env, params } = context;
  const action = params.action;

  if (!action) {
    return json({
      ok: false,
      error: "Falta la accion API."
    }, 400);
  }

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204 });
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
  const upstreamResponse = await fetch(`${upstreamUrl}?action=${encodeURIComponent(action)}`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      action,
      ...payload
    })
  });

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
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store"
    }
  });
}

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status: status,
    headers: {
      "content-type": "application/json; charset=UTF-8"
    }
  });
}

function errorForAction(action) {
  switch (action) {
    case "providerBootstrap":
    case "providerDashboard":
      return "No pudimos cargar la disponibilidad en este momento. Intenta nuevamente en unos minutos.";
    case "lookupRegistrationByTaxId":
      return "No pudimos validar la OC en este momento. Intenta nuevamente en unos minutos.";
    case "lookupProviderReference":
      return "No pudimos validar la referencia en este momento. Intenta nuevamente en unos minutos.";
    case "registerProvider":
      return "No pudimos completar tu registro en este momento. Intenta nuevamente en unos minutos.";
    case "providerLogin":
      return "No pudimos iniciar sesión en este momento. Intenta nuevamente en unos minutos.";
    case "requestAppointment":
      return "No pudimos registrar tu solicitud en este momento. Intenta nuevamente en unos minutos.";
    default:
      return "No se pudo completar la operación. Intenta nuevamente en unos minutos.";
  }
}
