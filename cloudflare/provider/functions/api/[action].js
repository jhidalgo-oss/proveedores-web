const DEFAULT_APPS_SCRIPT_PROVIDER_API_URL = "https://script.google.com/macros/s/AKfycbyvppyJJ0grbQwp29YATDuu5bgj8WI7V22nVAi-JzYd9yh0bLexFnQyQrTr61PdXsf_/exec";

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
    return json({
      ok: false,
      error: "El backend de Apps Script no est\u00e1 devolviendo JSON. Revisa que el Web App est\u00e9 publicado para acceso p\u00fablico.",
      debug: {
        action,
        upstreamStatus: upstreamResponse.status
      }
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
