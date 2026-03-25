# Proveedor en Cloudflare

Esta carpeta deja la vista del proveedor lista para salir primero en Cloudflare Pages.

## Estructura

- `public/`: frontend estatico del proveedor
- `functions/api/[action].js`: proxy serverless hacia Apps Script
- `wrangler.toml`: configuracion base de Cloudflare Pages

## Flujo

1. El navegador consume `POST /api/providerBootstrap`
2. Cloudflare Pages Function recibe la solicitud
3. El proxy reenvia la accion al Web App de Apps Script
4. Apps Script responde JSON
5. Cloudflare devuelve la respuesta al frontend

## Despliegue

1. Crear proyecto en Cloudflare Pages apuntando a esta carpeta.
2. Build command: vacio
3. Output directory: `cloudflare/provider/public`
4. Variables:
   - `APPS_SCRIPT_PROVIDER_API_URL`
5. Publicar.

## Acciones disponibles

- `providerBootstrap`
- `providerDashboard`
- `registerProvider`
- `requestAppointment`
