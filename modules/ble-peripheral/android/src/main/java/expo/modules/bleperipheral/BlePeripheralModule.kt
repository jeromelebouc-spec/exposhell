package expo.modules.bleperipheral

import android.bluetooth.*
import android.bluetooth.le.*
import android.content.Context
import android.os.ParcelUuid
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.UUID

private const val RSC_SERVICE         = "00001814-0000-1000-8000-00805f9b34fb"
private const val RSC_MEASUREMENT     = "00002a53-0000-1000-8000-00805f9b34fb"
private const val RSC_FEATURE         = "00002a54-0000-1000-8000-00805f9b34fb"
private const val SENSOR_LOCATION     = "00002a5d-0000-1000-8000-00805f9b34fb"
private const val CCCD                = "00002902-0000-1000-8000-00805f9b34fb"

class BlePeripheralModule : Module() {

  private var gattServer: BluetoothGattServer? = null
  private var advertiser: BluetoothLeAdvertiser? = null
  private val subscribedDevices = mutableSetOf<BluetoothDevice>()

  private val context: Context
    get() = appContext.reactContext!!

  override fun definition() = ModuleDefinition {
    Name("BlePeripheral")

    // ── Start GATT server and register RSC service ──────────────────────────
    AsyncFunction("startGattServer") {
      val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager

      val rscService = BluetoothGattService(
        UUID.fromString(RSC_SERVICE),
        BluetoothGattService.SERVICE_TYPE_PRIMARY
      )

      // RSC Measurement — notify only, no read permission
      val measurement = BluetoothGattCharacteristic(
        UUID.fromString(RSC_MEASUREMENT),
        BluetoothGattCharacteristic.PROPERTY_NOTIFY,
        0
      )
      val cccd = BluetoothGattDescriptor(
        UUID.fromString(CCCD),
        BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE
      )
      cccd.value = BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE
      measurement.addDescriptor(cccd)

      // RSC Feature — mandatory readable characteristic
      val feature = BluetoothGattCharacteristic(
        UUID.fromString(RSC_FEATURE),
        BluetoothGattCharacteristic.PROPERTY_READ,
        BluetoothGattCharacteristic.PERMISSION_READ
      )
      feature.value = byteArrayOf(0x03, 0x00) // bits 0+1: instantaneous stride + cadence supported

      // Sensor Location — mandatory readable characteristic
      val location = BluetoothGattCharacteristic(
        UUID.fromString(SENSOR_LOCATION),
        BluetoothGattCharacteristic.PROPERTY_READ,
        BluetoothGattCharacteristic.PERMISSION_READ
      )
      location.value = byteArrayOf(0x06) // 0x06 = Foot

      rscService.addCharacteristic(measurement)
      rscService.addCharacteristic(feature)
      rscService.addCharacteristic(location)

      gattServer = manager.openGattServer(context, gattServerCallback)
      gattServer?.addService(rscService)
    }

    // ── Start BLE advertising ───────────────────────────────────────────────
    AsyncFunction("startAdvertising") {
      val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
      advertiser = manager.adapter.bluetoothLeAdvertiser

      val settings = AdvertiseSettings.Builder()
        .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
        .setConnectable(true)
        .setTimeout(0) // advertise indefinitely
        .build()

      val data = AdvertiseData.Builder()
        .setIncludeDeviceName(true)
        .addServiceUuid(ParcelUuid.fromString(RSC_SERVICE))
        .build()

      advertiser?.startAdvertising(settings, data, advertiseCallback)
    }

    // ── Push RSC measurement to all subscribed Garmin devices ───────────────
    AsyncFunction("notifyRSC") { speed: Double, cadence: Int? ->
      val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
      val characteristic = gattServer
        ?.getService(UUID.fromString(RSC_SERVICE))
        ?.getCharacteristic(UUID.fromString(RSC_MEASUREMENT))
        ?: return@AsyncFunction

      val speedFixed = (speed * 256).toInt() // units: 1/256 m/s

      characteristic.value = if (cadence != null) {
        byteArrayOf(
          0x03,                                    // flags: running + cadence present
          (speedFixed and 0xFF).toByte(),
          ((speedFixed shr 8) and 0xFF).toByte(),
          cadence.toByte()
        )
      } else {
        byteArrayOf(
          0x00,                                    // flags: speed only
          (speedFixed and 0xFF).toByte(),
          ((speedFixed shr 8) and 0xFF).toByte()
        )
      }

      // Only notify devices that have subscribed via CCCD
      subscribedDevices.forEach { device ->
        gattServer?.notifyCharacteristicChanged(device, characteristic, false)
      }
    }

    // ── Stop everything ─────────────────────────────────────────────────────
    AsyncFunction("stop") {
      advertiser?.stopAdvertising(advertiseCallback)
      gattServer?.close()
      gattServer = null
      subscribedDevices.clear()
    }
  }

  // ── GATT server callbacks ─────────────────────────────────────────────────
  private val gattServerCallback = object : BluetoothGattServerCallback() {

    override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
      if (newState == BluetoothProfile.STATE_DISCONNECTED) {
        subscribedDevices.remove(device)
      }
    }

    override fun onCharacteristicReadRequest(
      device: BluetoothDevice, requestId: Int, offset: Int,
      characteristic: BluetoothGattCharacteristic
    ) {
      gattServer?.sendResponse(
        device, requestId, BluetoothGatt.GATT_SUCCESS, 0, characteristic.value
      )
    }

    override fun onDescriptorWriteRequest(
      device: BluetoothDevice, requestId: Int,
      descriptor: BluetoothGattDescriptor,
      preparedWrite: Boolean, responseNeeded: Boolean,
      offset: Int, value: ByteArray
    ) {
      descriptor.value = value

      // Track which devices have enabled notifications
      if (descriptor.uuid == UUID.fromString(CCCD)) {
        if (value.contentEquals(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)) {
          subscribedDevices.add(device)
        } else {
          subscribedDevices.remove(device)
        }
      }

      if (responseNeeded) {
        gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
      }
    }

    override fun onDescriptorReadRequest(
      device: BluetoothDevice, requestId: Int, offset: Int,
      descriptor: BluetoothGattDescriptor
    ) {
      gattServer?.sendResponse(
        device, requestId, BluetoothGatt.GATT_SUCCESS, 0, descriptor.value
      )
    }
  }

  private val advertiseCallback = object : AdvertiseCallback() {
    override fun onStartFailure(errorCode: Int) {
      // errorCode 3 = ADVERTISE_FAILED_ALREADY_STARTED (safe to ignore)
    }
  }
}
