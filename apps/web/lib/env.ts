export const PHONER_URL = process.env.NEXT_PUBLIC_PHONER_URL ?? "http://localhost:4000";
export const INTEGRATOR_URL = process.env.NEXT_PUBLIC_INTEGRATOR_URL ?? "http://localhost:4001";
export const PHONER_WS_URL = `${PHONER_URL.replace(/^http/, "ws")}/call`;
