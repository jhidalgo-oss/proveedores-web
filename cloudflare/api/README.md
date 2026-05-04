# Portal de Proveedores API

Backend paralelo para migrar el Portal de Proveedores desde Apps Script/Sheets a Cloudflare Workers + D1.

## Endpoints iniciales

- `POST /auth/login`
- `GET /auth/validate`
- `GET /delivery-points`
- `GET /provider/my-appointments`
- `POST /provider/request-appointment`
- `GET /supervisor/appointments`
- `POST /supervisor/approve`
- `POST /supervisor/reassign`
- `POST /sap/sync`

## Identidad

El proveedor usa `sessionToken` como identidad principal.

Enviar token como:

```http
Authorization: Bearer <sessionToken>
```

## Cita

`POST /provider/request-appointment` requiere:

```json
{
  "date": "2026-05-03",
  "startTime": "08:00",
  "durationMinutes": 30,
  "deliveryPointId": "GENERAL",
  "poNumber": "2682579",
  "notes": ""
}
```

`poNumber` y `notes` son opcionales. La disponibilidad se valida por `date + deliveryPointId + rango horario`.

## D1

Crear base:

```powershell
cd C:\Users\supply13\Desktop\Proveedores\cloudflare\api
npx.cmd wrangler d1 create proveedores_db
```

Actualizar `database_id` en `wrangler.toml`.

Aplicar migraciones:

```powershell
npx.cmd wrangler d1 migrations apply proveedores_db --remote
```

## Secrets

```powershell
npx.cmd wrangler secret put SUPERVISOR_ACCESS_KEY
npx.cmd wrangler secret put SAP_SYNC_KEY
```

## Deploy

```powershell
npx.cmd wrangler deploy
```

Ruta objetivo: `https://api.santis.space`.
