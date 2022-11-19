import {
  Characteristic,
  CharacteristicEventTypes,
  CharacteristicGetCallback,
  CharacteristicSetCallback,
  CharacteristicValue,
  PlatformAccessory,
  Service,
} from 'homebridge';
import { ParticleHomebridgePlatform } from './platform';

const fetch = require('node-fetch');

export class TemperatureAccessory {
  private temp_sensor_service: Service;
  private Service: typeof Service;
  private Characteristic: typeof Characteristic;

  constructor(
    private readonly platform: ParticleHomebridgePlatform,
    private readonly accessory: PlatformAccessory
  ) {
    this.Service = this.platform.Service;
    this.Characteristic = this.platform.Characteristic;

    // set accessory information
    this.accessory
      .getService(this.Service.AccessoryInformation)!
      .setCharacteristic(this.Characteristic.Manufacturer, 'Zigbee')
      .setCharacteristic(this.Characteristic.Model, 'Temp Sensor');

    this.temp_sensor_service =
      this.accessory.getService(this.Service.TemperatureSensor) ||
      this.accessory.addService(this.Service.TemperatureSensor);

    this.temp_sensor_service.setCharacteristic(this.Characteristic.Name, 'Indoor Temperature');

    this.temp_sensor_service
      .getCharacteristic(this.Characteristic.CurrentTemperature)
      .on(CharacteristicEventTypes.GET, this.handleOnGet.bind(this));
  }

  private handleOnGet(callback: CharacteristicGetCallback) {
    fetch(this.accessory.context.device.currTempUrl)
      .then((response) => {
        return response.json();
      })
      .then((data) => {
        const temp = data['currTemp'];
        callback(null, temp);
      })
      .catch((error) => {
        this.platform.log.error(error);
        callback(error, null);
      });
  }
}
