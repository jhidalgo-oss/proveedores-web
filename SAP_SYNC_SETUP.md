# Integracion SAP para Proveedores

## Objetivo

Actualizar automaticamente cada 3 horas:

- `SAP_PROVEEDORES`
- `SAP_OC_PENDIENTES`

desde una fuente SAP o middleware publicada por HTTPS.

## Lo que ya soporta el portal

El backend en Apps Script ya puede consumir:

- `JSON`
- `CSV`

y reconoce respuestas tipo:

- arreglo directo
- `{ "value": [...] }`
- `{ "d": { "results": [...] } }`
- `{ "results": [...] }`
- `{ "items": [...] }`
- `{ "data": [...] }`

Tambien soporta:

- `Authorization: Bearer ...`
- `Authorization: Basic ...`
- headers personalizados en JSON

## Opcion recomendada

Publicar 2 endpoints HTTPS desde SAP, SAP Gateway, SAP BTP, SAP CPI o middleware interno:

1. Proveedores activos
2. OCs pendientes por proveedor

## Estructura recomendada para proveedores

Campos minimos:

- `vendorCode`
- `vendorName`
- `taxId`
- `active`
- `lastSync`

Campos utiles:

- `email`
- `phone`
- `companyCode`
- `purchasingOrg`
- `blockedForPurchasing`
- `notes`

Ejemplo JSON:

```json
[
  {
    "vendorCode": "100245",
    "vendorName": "Proveedor Demo SAC",
    "taxId": "20123456789",
    "email": "compras@proveedor.com",
    "phone": "999888777",
    "companyCode": "1000",
    "purchasingOrg": "1000",
    "blockedForPurchasing": false,
    "active": true,
    "lastSync": "2026-03-25T15:00:00"
  }
]
```

## Estructura recomendada para OCs pendientes

Campos minimos:

- `poNumber`
- `poItem`
- `vendorCode`
- `openQty`
- `status`
- `lastSync`

Campos utiles:

- `vendorName`
- `taxId`
- `documentDate`
- `deliveryDate`
- `materialCode`
- `materialDescription`
- `plant`
- `storageLocation`
- `orderedQty`
- `receivedQty`
- `uom`
- `buyer`
- `companyCode`
- `purchasingOrg`
- `notes`

Ejemplo JSON:

```json
[
  {
    "poNumber": "4500123456",
    "poItem": "00010",
    "vendorCode": "100245",
    "vendorName": "Proveedor Demo SAC",
    "taxId": "20123456789",
    "documentDate": "2026-03-25",
    "deliveryDate": "2026-03-28",
    "materialCode": "MAT-100",
    "materialDescription": "Harina de trigo",
    "plant": "1000",
    "storageLocation": "AL01",
    "orderedQty": 100,
    "receivedQty": 40,
    "openQty": 60,
    "uom": "KG",
    "status": "ABIERTA",
    "buyer": "COMPRAS01",
    "companyCode": "1000",
    "purchasingOrg": "1000",
    "lastSync": "2026-03-25T15:00:00"
  }
]
```

## Configuracion en Apps Script

En la hoja `CONFIG` llena estos valores:

- `SAP_SYNC_ENABLED`
- `SAP_SYNC_INTERVAL_HOURS`
- `SAP_PROVIDER_SOURCE_URL`
- `SAP_PROVIDER_SOURCE_FORMAT`
- `SAP_PROVIDER_ARRAY_PATH`
- `SAP_OPEN_ORDERS_SOURCE_URL`
- `SAP_OPEN_ORDERS_SOURCE_FORMAT`
- `SAP_OPEN_ORDERS_ARRAY_PATH`
- `SAP_SOURCE_AUTH_HEADER`
- `SAP_SOURCE_AUTH_TOKEN`
- `SAP_SOURCE_HEADERS_JSON`

## Activacion

1. Abre el proyecto Apps Script.
2. Ejecuta `activateSapSyncFromConfig`.
3. Acepta permisos.

Eso hace dos cosas:

- copia la configuracion desde la hoja `CONFIG` a `Script Properties`
- instala el trigger `runSapSync` cada 3 horas

## Funciones disponibles

- `runSapSync`: ejecuta una sincronizacion inmediata
- `installSapSyncTrigger`: instala el trigger recurrente
- `removeSapSyncTrigger`: elimina el trigger
- `getSapSyncStatus`: muestra configuracion y estado del trigger
- `applyConfigSheetToScriptProperties`: pasa valores de `CONFIG` a `Script Properties`
- `activateSapSyncFromConfig`: aplica configuracion e instala el trigger
