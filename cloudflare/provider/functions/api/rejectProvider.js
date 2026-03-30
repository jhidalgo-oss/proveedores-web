import { proxyAction } from "./_proxy";

export function onRequest(context) {
  return proxyAction(context, "rejectProvider");
}
