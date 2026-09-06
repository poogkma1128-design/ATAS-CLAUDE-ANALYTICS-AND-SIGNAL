export type SessionKey =
  | "asia"
  | "europe"
  | "us_premarket"
  | "us_open"
  | "us_regular"
  | "power_hour"
  | "initial_balance"
  | (string & Record<never, never>);

export interface SessionWindow {
  key: SessionKey;
  /** IANA time zone for the market named by this window. */
  timeZone: string;
  /** Inclusive window-local minute, 0..1439. */
  startMinute: number;
  /** Exclusive window-local minute, 0..1439. May wrap midnight. */
  endMinute: number;
}

export interface SessionDefinition {
  version: string;
  /** IANA time zone used only to name the instrument's trading day. */
  tradingDayTimeZone: string;
  /** Local minute in tradingDayTimeZone at which the next trading day begins. */
  tradingDayRolloverMinute: number;
  windows: SessionWindow[];
}

export interface SessionStamp {
  definitionVersion: string;
  tradingDayTimeZone: string;
  tradingDayLocalDate: string;
  tradingDayLocalMinute: number;
  tradingDay: string;
  sessionTags: SessionKey[];
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let value = formatters.get(timeZone);
  if (!value) {
    value = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, value);
  }
  return value;
}

function localParts(instant: Date, timeZone: string) {
  const parts = Object.fromEntries(
    formatter(timeZone).formatToParts(instant).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function isoDate(year: number, month: number, day: number, addDays = 0): string {
  return new Date(Date.UTC(year, month - 1, day + addDays)).toISOString().slice(0, 10);
}

function inWindow(minute: number, window: SessionWindow): boolean {
  if (window.startMinute < window.endMinute) {
    return minute >= window.startMinute && minute < window.endMinute;
  }
  return minute >= window.startMinute || minute < window.endMinute;
}

export function validateSessionDefinition(definition: SessionDefinition): void {
  if (!definition.version.trim()) {
    throw new Error("session definition version is required");
  }
  if (
    !Number.isInteger(definition.tradingDayRolloverMinute) ||
    definition.tradingDayRolloverMinute < 0 ||
    definition.tradingDayRolloverMinute > 1439
  ) {
    throw new Error("tradingDayRolloverMinute must be an integer from 0 to 1439");
  }

  // Construction validates the IANA identifier on every supported runtime.
  formatter(definition.tradingDayTimeZone).format(new Date(0));

  const keys = new Set<string>();
  for (const window of definition.windows) {
    if (!window.key.trim()) throw new Error("session window key is required");
    if (keys.has(window.key)) throw new Error(`duplicate session window: ${window.key}`);
    keys.add(window.key);
    if (!window.timeZone.trim()) {
      throw new Error(`${window.key}.timeZone is required`);
    }
    formatter(window.timeZone).format(new Date(0));
    for (
      const [name, value] of [
        ["startMinute", window.startMinute],
        ["endMinute", window.endMinute],
      ] as const
    ) {
      if (!Number.isInteger(value) || value < 0 || value > 1439) {
        throw new Error(`${window.key}.${name} must be an integer from 0 to 1439`);
      }
    }
    if (window.startMinute === window.endMinute) {
      throw new Error(`${window.key} cannot be a zero-length/full-day window`);
    }
  }
}

/**
 * Names the trading day in the instrument's time zone, then evaluates every
 * session window in that window's own IANA time zone.
 */
export function stampSession(
  instantIso: string,
  definition: SessionDefinition,
): SessionStamp {
  validateSessionDefinition(definition);
  const instant = new Date(instantIso);
  if (Number.isNaN(instant.getTime())) {
    throw new Error("instantIso must be an ISO timestamp");
  }

  const local = localParts(instant, definition.tradingDayTimeZone);
  const minute = local.hour * 60 + local.minute;
  const localDate = isoDate(local.year, local.month, local.day);
  const tradingDay = isoDate(
    local.year,
    local.month,
    local.day,
    definition.tradingDayRolloverMinute > 0 &&
      minute >= definition.tradingDayRolloverMinute
      ? 1
      : 0,
  );

  return {
    definitionVersion: definition.version,
    tradingDayTimeZone: definition.tradingDayTimeZone,
    tradingDayLocalDate: localDate,
    tradingDayLocalMinute: minute,
    tradingDay,
    sessionTags: definition.windows.filter((window) => {
      const windowLocal = localParts(instant, window.timeZone);
      return inWindow(windowLocal.hour * 60 + windowLocal.minute, window);
    }).map((window) => window.key),
  };
}
