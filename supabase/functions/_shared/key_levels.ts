import type { ClusterLevel } from "./types.ts";

export interface CausalLevelBar {
  openedAt: string;
  closedAt: string;
  isClosed: boolean;
  high: number;
  low: number;
  /** Bar-level trade count; must equal the sum of footprint level ticks. */
  ticks: number;
  tradingDay: string;
  sessionTags: string[];
  /** null means the footprint is unavailable; [] is a known zero-volume footprint. */
  levels: ClusterLevel[] | null;
}

export type ProfileStatus =
  | "complete"
  | "no_session_bars"
  | "missing_footprint"
  | "invalid_footprint_levels"
  | "footprint_tick_mismatch"
  | "zero_volume";

export interface KeyLevelResult {
  decisionAt: string;
  tradingDay: string;
  profileSessionTag: string;
  profileStatus: ProfileStatus;
  vwap: number | null;
  vah: number | null;
  val: number | null;
  sessionPoc: number | null;
  previousDayHigh: number | null;
  previousDayLow: number | null;
  sessionHigh: number | null;
  sessionLow: number | null;
  initialBalanceHigh: number | null;
  initialBalanceLow: number | null;
  diagnostics: {
    causalBarCount: number;
    profileBarCount: number;
    profileLevelCount: number;
    previousTradingDay: string | null;
    rejectedProfileBars: Record<
      Exclude<ProfileStatus, "complete" | "no_session_bars" | "zero_volume">,
      number
    >;
  };
}

export interface KeyLevelOptions {
  profileSessionTag: string;
  initialBalanceTag: string;
  valueAreaFraction?: number;
}

interface Profile {
  vwap: number;
  vah: number;
  val: number;
  poc: number;
  levelCount: number;
}

function extrema(bars: CausalLevelBar[]): { high: number | null; low: number | null } {
  if (bars.length === 0) return { high: null, low: null };
  return {
    high: Math.max(...bars.map((bar) => bar.high)),
    low: Math.min(...bars.map((bar) => bar.low)),
  };
}

function profile(levels: ClusterLevel[], fraction: number): Profile | null {
  const volumes = new Map<number, number>();
  let weighted = 0;
  let total = 0;
  for (const level of levels) {
    volumes.set(level.price, (volumes.get(level.price) ?? 0) + level.volume);
    weighted += level.price * level.volume;
    total += level.volume;
  }
  if (total <= 0) return null;

  const rows = [...volumes.entries()].sort(([a], [b]) => a - b);
  const maxVolume = Math.max(...rows.map(([, volume]) => volume));
  // A lower-price tie break is deterministic and part of the Phase 1 contract.
  const pocIndex = rows.findIndex(([, volume]) => volume === maxVolume);
  let left = pocIndex - 1;
  let right = pocIndex + 1;
  let includedLow = pocIndex;
  let includedHigh = pocIndex;
  let included = rows[pocIndex][1];
  const target = total * fraction;

  while (included < target && (left >= 0 || right < rows.length)) {
    const leftVolume = left >= 0 ? rows[left][1] : -1;
    const rightVolume = right < rows.length ? rows[right][1] : -1;
    if (leftVolume === rightVolume && leftVolume >= 0) {
      included += leftVolume + rightVolume;
      includedLow = left--;
      includedHigh = right++;
    } else if (leftVolume > rightVolume) {
      included += leftVolume;
      includedLow = left--;
    } else {
      included += rightVolume;
      includedHigh = right++;
    }
  }

  return {
    vwap: weighted / total,
    val: rows[includedLow][0],
    vah: rows[includedHigh][0],
    poc: rows[pocIndex][0],
    levelCount: rows.length,
  };
}

type FootprintRejection = Exclude<
  ProfileStatus,
  "complete" | "no_session_bars" | "zero_volume"
>;

function footprintRejection(bar: CausalLevelBar): FootprintRejection | null {
  if (bar.levels === null) return "missing_footprint";

  const invalidLevel = bar.levels.some((level) =>
    !Number.isFinite(level.price) ||
    level.price < bar.low ||
    level.price > bar.high ||
    !Number.isFinite(level.ask) ||
    level.ask < 0 ||
    !Number.isFinite(level.bid) ||
    level.bid < 0 ||
    !Number.isFinite(level.between) ||
    level.between < 0 ||
    !Number.isFinite(level.volume) ||
    level.volume < 0 ||
    !Number.isSafeInteger(level.ticks) ||
    level.ticks < 0
  );
  if (invalidLevel) return "invalid_footprint_levels";

  const levelTicks = bar.levels.reduce((sum, level) => sum + level.ticks, 0);
  if (!Number.isSafeInteger(bar.ticks) || bar.ticks < 0 || levelTicks !== bar.ticks) {
    return "footprint_tick_mismatch";
  }
  return null;
}

/** Computes only from bars whose close is at or before decisionAt. Future input fails closed. */
export function computeKeyLevels(
  bars: CausalLevelBar[],
  decisionAt: string,
  tradingDay: string,
  options: KeyLevelOptions,
): KeyLevelResult {
  const decisionMs = Date.parse(decisionAt);
  if (!Number.isFinite(decisionMs)) {
    throw new Error("decisionAt must be an ISO timestamp");
  }
  if (!options.profileSessionTag.trim() || !options.initialBalanceTag.trim()) {
    throw new Error("profileSessionTag and initialBalanceTag are required");
  }
  const fraction = options.valueAreaFraction ?? 0.7;
  if (!(fraction > 0 && fraction <= 1)) {
    throw new Error("valueAreaFraction must be in (0, 1]");
  }

  for (const bar of bars) {
    const openedMs = Date.parse(bar.openedAt);
    const closedMs = Date.parse(bar.closedAt);
    if (
      !Number.isFinite(openedMs) || !Number.isFinite(closedMs) || closedMs <= openedMs
    ) {
      throw new Error("bar timestamps must describe a positive closed interval");
    }
    if (!bar.isClosed) {
      throw new Error("unclosed bar supplied to causal key-level engine");
    }
    if (closedMs > decisionMs) {
      throw new Error("future bar supplied to causal key-level engine");
    }
    if (!Number.isFinite(bar.high) || !Number.isFinite(bar.low) || bar.high < bar.low) {
      throw new Error("bar high/low are invalid");
    }
  }

  const currentDay = bars.filter((bar) => bar.tradingDay === tradingDay);
  const profileBars = currentDay.filter((bar) =>
    bar.sessionTags.includes(options.profileSessionTag)
  );
  const initialBalanceBars = currentDay.filter((bar) =>
    bar.sessionTags.includes(options.initialBalanceTag)
  );
  const priorDays = [
    ...new Set(bars.map((bar) => bar.tradingDay).filter((day) => day < tradingDay)),
  ]
    .sort();
  const previousTradingDay = priorDays.at(-1) ?? null;
  const previousBars = previousTradingDay
    ? bars.filter((bar) => bar.tradingDay === previousTradingDay)
    : [];

  const rejectedProfileBars: KeyLevelResult["diagnostics"]["rejectedProfileBars"] = {
    missing_footprint: 0,
    invalid_footprint_levels: 0,
    footprint_tick_mismatch: 0,
  };
  for (const bar of profileBars) {
    const rejection = footprintRejection(bar);
    if (rejection) rejectedProfileBars[rejection] += 1;
  }

  let profileStatus: ProfileStatus = "complete";
  let computedProfile: Profile | null = null;
  if (profileBars.length === 0) {
    profileStatus = "no_session_bars";
  } else if (rejectedProfileBars.missing_footprint > 0) {
    profileStatus = "missing_footprint";
  } else if (rejectedProfileBars.invalid_footprint_levels > 0) {
    profileStatus = "invalid_footprint_levels";
  } else if (rejectedProfileBars.footprint_tick_mismatch > 0) {
    profileStatus = "footprint_tick_mismatch";
  } else {
    computedProfile = profile(profileBars.flatMap((bar) => bar.levels ?? []), fraction);
    if (!computedProfile) profileStatus = "zero_volume";
  }

  const sessionRange = extrema(profileBars);
  const priorRange = extrema(previousBars);
  const initialBalanceRange = extrema(initialBalanceBars);

  return {
    decisionAt,
    tradingDay,
    profileSessionTag: options.profileSessionTag,
    profileStatus,
    vwap: computedProfile?.vwap ?? null,
    vah: computedProfile?.vah ?? null,
    val: computedProfile?.val ?? null,
    sessionPoc: computedProfile?.poc ?? null,
    previousDayHigh: priorRange.high,
    previousDayLow: priorRange.low,
    sessionHigh: sessionRange.high,
    sessionLow: sessionRange.low,
    initialBalanceHigh: initialBalanceRange.high,
    initialBalanceLow: initialBalanceRange.low,
    diagnostics: {
      causalBarCount: bars.length,
      profileBarCount: profileBars.length,
      profileLevelCount: computedProfile?.levelCount ?? 0,
      previousTradingDay,
      rejectedProfileBars,
    },
  };
}
