/**
 * lib/constants.ts — App-wide constants.
 * Matches CHART_GOV / VEHICLE_CLASSES used throughout the vanilla codebase.
 */

export const VEHICLE_CLASSES = ["car", "truck", "bus", "motorcycle"] as const;
export type VehicleClass = typeof VEHICLE_CLASSES[number];

export const CLS_COLORS: Record<VehicleClass, string> = {
  car:        "#29B6F6",  // --cls-car
  truck:      "#FF7043",  // --cls-truck
  bus:        "#AB47BC",  // --cls-bus
  motorcycle: "#FFD600",  // --cls-moto
};

export const CLS_LABELS: Record<VehicleClass, string> = {
  car:        "Cars",
  truck:      "Trucks",
  bus:        "Buses",
  motorcycle: "Motorcycles",
};

/** WebSocket event types broadcast by /ws/live */
export const WS_EVENTS = {
  COUNT_UPDATE:  "count:update",
  ROUND_UPDATE:  "round:update",
  DEMO_MODE:     "demo_mode",
  SESSION_GUEST: "session:guest",
  BET_PLACED:    "bet:placed",
  BET_RESOLVED:  "bet:resolved",
  BALANCE_UPDATE:"balance:update",
} as const;

/** App-wide timing constants */
export const TIMING = {
  WS_TOKEN_TTL_MS:     4 * 60 * 1000,  // 4 min — token cache
  ROUND_CACHE_TTL_MS:  30 * 1000,      // 30 s  — round cache
  LB_CACHE_TTL_MS:     30 * 1000,      // 30 s  — leaderboard cache
  ANALYTICS_CACHE_MS:  2  * 60 * 1000, // 2 min — analytics cache
  WS_BACKOFF_INITIAL:  2000,
  WS_BACKOFF_MAX:      30000,
} as const;

/** Sidebar width + header height to match CSS */
export const LAYOUT = {
  SIDEBAR_W:  380,
  HEADER_H:   56,
} as const;
