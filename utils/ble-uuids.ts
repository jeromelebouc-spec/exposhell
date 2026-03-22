// Official Bluetooth SIG Service UUIDs
// Mapped from their 16-bit hex representation (e.g. 0x180D -> "Heart Rate")

export const BLE_SERVICES: Record<string, string> = {
  "1800": "Generic Access",
  "1801": "Generic Attribute",
  "1802": "Immediate Alert",
  "1803": "Link Loss",
  "1804": "Tx Power",
  "1805": "Current Time",
  "1806": "Reference Time Update",
  "1807": "Next DST Change",
  "1808": "Glucose",
  "1809": "Health Thermometer",
  "180a": "Device Information",
  "180d": "Heart Rate",
  "180e": "Phone Alert Status",
  "180f": "Battery Service",
  "1810": "Blood Pressure",
  "1811": "Alert Notification",
  "1812": "Human Interface Device (HID)",
  "1813": "Scan Parameters",
  "1814": "Running Speed and Cadence",
  "1815": "Automation IO",
  "1816": "Cycling Speed and Cadence",
  "1818": "Cycling Power",
  "1819": "Location and Navigation",
  "181a": "Environmental Sensing",
  "181b": "Body Composition",
  "181c": "User Data",
  "181d": "Weight Scale",
  "181e": "Bond Management",
  "181f": "Continuous Glucose Monitoring",
  "1820": "Internet Protocol Support",
  "1821": "Indoor Positioning",
  "1822": "Pulse Oximeter",
  "1823": "HTTP Proxy",
  "1824": "Transport Discovery",
  "1825": "Object Transfer",
  "1826": "Fitness Machine (FTMS)",
  "1827": "Mesh Provisioning",
  "1828": "Mesh Proxy",
  "1829": "Reconnection Configuration",
  "183a": "Audio Stream Control",
  "183b": "Broadcast Audio Scan",
  "183c": "Published Audio Capabilities",
  "1843": "Audio Input Control",
  "1844": "Volume Control",
  "1845": "Volume Offset Control",
  "1846": "Microphone Control",
  "1858": "Gaming Audio",
  
  // Custom & Apple / Google / Vendor specific
  "fef5": "Dialog Semiconductor",
  "fd6f": "Contact Tracing (COVID-19)",
  "fe9f": "Google",
  "fe9e": "Dialog Semiconductor",
  "fef3": "Apple Inc.",
  "feda": "Mac Address String",
  "fed9": "Pebble Technology",
  "fee7": "Tencent Holdings",
  "fe59": "Nordic UART Service",
  "1530": "Nordic Device Firmware Update",
};

export function getServiceNameFromUUID(uuid: string): string {
  const lower = uuid.toLowerCase();
  
  // If it's a 16-bit UUID mapped into the standard 128-bit base UUID space
  // Base UUID: 0000XXXX-0000-1000-8000-00805f9b34fb
  if (lower.startsWith("0000") && lower.endsWith("-0000-1000-8000-00805f9b34fb")) {
    const shortHex = lower.substring(4, 8); // e.g. "180d"
    if (BLE_SERVICES[shortHex]) {
      return BLE_SERVICES[shortHex];
    }
    return `Unknown 16-bit UUID (0x${shortHex})`;
  }

  // If it was already passed as a 4-char string
  if (lower.length === 4 && BLE_SERVICES[lower]) {
    return BLE_SERVICES[lower];
  }

  return uuid;
}

// Common Bluetooth SIG Company Identifiers (First 2 bytes of Manufacturer Data)
export const COMPANY_IDENTIFIERS: Record<number, string> = {
  0x0006: "Microsoft",
  0x000f: "Broadcom",
  0x004c: "Apple, Inc.",
  0x0059: "Nordic Semiconductor ASA",
  0x0075: "Samsung Electronics Co. Ltd.",
  0x0078: "Nike, Inc.",
  0x0087: "Garmin International, Inc.",
  0x00d2: "Dialog Semiconductor",
  0x00e0: "Google",
  0x0118: "Wahoo Fitness, LLC",
  0x0157: "Xiaomi Inc.",
  0x0177: "Bose Corporation",
  0x0211: "Peloton Interactive Inc.",
  0x02e5: "Polar Electro Oy",
  0x0001: "Nokia",
  0x0002: "Intel",
};

export function getCompanyName(id: number): string {
  if (COMPANY_IDENTIFIERS[id]) {
    return COMPANY_IDENTIFIERS[id];
  }
  return `Unknown Company (0x${id.toString(16).padStart(4, "0")})`;
}
