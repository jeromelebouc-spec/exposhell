export type TelemetryData = {
  speed: number | null;
  cadence: number | null;
  heartRate: number | null;
  power: number | null;
  rmssd: number | null;
  incline: number | null;
  distance: number | null;
};

export type MetricKey = keyof TelemetryData;

export function base64ToBytes(base64: string) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const lookup = new Uint8Array(256);
  for (let i = 0; i < chars.length; i += 1) {
    lookup[chars.charCodeAt(i)] = i;
  }

  const len = base64.length;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const bytes = new Uint8Array(((len * 3) / 4) - padding);

  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const encoded1 = lookup[base64.charCodeAt(i)];
    const encoded2 = lookup[base64.charCodeAt(i + 1)];
    const encoded3 = lookup[base64.charCodeAt(i + 2)];
    const encoded4 = lookup[base64.charCodeAt(i + 3)];

    const byte1 = (encoded1 << 2) | (encoded2 >> 4);
    bytes[p++] = byte1;

    if (p < bytes.length) {
      const byte2 = ((encoded2 & 15) << 4) | (encoded3 >> 2);
      bytes[p++] = byte2;
    }

    if (p < bytes.length) {
      const byte3 = ((encoded3 & 3) << 6) | encoded4;
      bytes[p++] = byte3;
    }
  }

  return bytes;
}

export function parseRSCMeasurement(base64: string) {
  const bytes = base64ToBytes(base64);
  const speed = (bytes[1] | (bytes[2] << 8)) / 256;
  const cadence = bytes[3];
  return { speed, cadence };
}

export function parseCSCMeasurement(
  base64: string,
  prev?: {
    wheelRev: number;
    wheelTime: number;
    crankRev: number;
    crankTime: number;
  }
) {
  const bytes = base64ToBytes(base64);
  const flags = bytes[0];
  let offset = 1;

  let speed: number | null = null;
  let cadence: number | null = null;

  let currentWheelRev = 0;
  let currentWheelTime = 0;
  let currentCrankRev = 0;
  let currentCrankTime = 0;

  const hasWheel = (flags & 0x01) !== 0;
  const hasCrank = (flags & 0x02) !== 0;

  if (hasWheel) {
    currentWheelRev =
      (bytes[offset] |
        (bytes[offset + 1] << 8) |
        (bytes[offset + 2] << 16) |
        (bytes[offset + 3] << 24)) >>> 0;
    currentWheelTime = (bytes[offset + 4] | (bytes[offset + 5] << 8)) >>> 0;
    offset += 6;

    if (prev && prev.wheelTime !== currentWheelTime) {
      const revDiff = (currentWheelRev - prev.wheelRev) >>> 0;
      let timeDiff = (currentWheelTime - prev.wheelTime) & 0xffff;
      if (timeDiff < 0) timeDiff += 0x10000;

      if (timeDiff > 0 && revDiff >= 0) {
        const timeSec = timeDiff / 1024;
        const circumference = 2.096; // 700x23c default
        speed = (revDiff * circumference) / timeSec;
      }
    }
  }

  if (hasCrank) {
    currentCrankRev = (bytes[offset] | (bytes[offset + 1] << 8)) >>> 0;
    currentCrankTime = (bytes[offset + 2] | (bytes[offset + 3] << 8)) >>> 0;
    offset += 4;

    if (prev && prev.crankTime !== currentCrankTime) {
      const revDiff = (currentCrankRev - prev.crankRev) & 0xffff;
      let timeDiff = (currentCrankTime - prev.crankTime) & 0xffff;
      if (timeDiff < 0) timeDiff += 0x10000;

      if (timeDiff > 0 && revDiff >= 0) {
        const timeSec = timeDiff / 1024;
        cadence = (revDiff / timeSec) * 60;
      }
    }
  }

  return {
    speed,
    cadence,
    data: {
      wheelRev: currentWheelRev,
      wheelTime: currentWheelTime,
      crankRev: currentCrankRev,
      crankTime: currentCrankTime,
    },
  };
}

export function parseHeartRateMeasurement(base64: string) {
  const bytes = base64ToBytes(base64);
  const flags = bytes[0];
  const formatUint16 = (flags & 0x01) !== 0;
  let offset = 1;
  const heartRate = formatUint16
    ? bytes[offset] | (bytes[offset + 1] << 8)
    : bytes[offset];
  offset += formatUint16 ? 2 : 1;

  const hasRr = (flags & 0x10) !== 0;
  const rrIntervals: number[] = [];
  if (hasRr) {
    while (offset + 1 < bytes.length) {
      const raw = bytes[offset] | (bytes[offset + 1] << 8);
      const ms = (raw * 1000) / 1024;
      rrIntervals.push(ms);
      offset += 2;
    }
  }

  return { heartRate, rrIntervals };
}

export function parseCyclingPowerMeasurement(base64: string) {
  const bytes = base64ToBytes(base64);
  const power = (bytes[2] | (bytes[3] << 8));
  return { power };
}

// FTMS treadmill data (0x2ACD).
export function parseFTMSMeasurement(base64: string) {
  const bytes = base64ToBytes(base64);
  const flags = bytes[0];
  let offset = 1;

  const rawSpeed = bytes[offset] | (bytes[offset + 1] << 8);
  const speed = (rawSpeed / 100) / 3.6; // km/h → m/s
  offset += 2;

  let incline: number | null = null;
  if (flags & 0x02) {
    const rawIncline = bytes[offset] | (bytes[offset + 1] << 8);
    incline = rawIncline / 100;
    offset += 2;
  }

  let distance: number | null = null;
  if (flags & 0x04) {
    distance =
      (bytes[offset] |
        (bytes[offset + 1] << 8) |
        (bytes[offset + 2] << 16)) / 10; // 0.1m units
    offset += 3;
  }

  return { speed, incline, distance };
}

export function computeRmssd(rrIntervals: number[]) {
  if (rrIntervals.length < 2) return null;
  const diffs = rrIntervals
    .slice(1)
    .map((v, i) => v - rrIntervals[i])
    .map((d) => d * d);
  const mean = diffs.reduce((sum, v) => sum + v, 0) / diffs.length;
  return Math.sqrt(mean);
}
