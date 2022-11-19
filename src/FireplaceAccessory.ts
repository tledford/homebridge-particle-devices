import {
  Characteristic,
  CharacteristicEventTypes,
  CharacteristicGetCallback,
  CharacteristicSetCallback,
  CharacteristicValue,
  PlatformAccessory,
  Service,
} from 'homebridge';
import { callbackify } from 'util';
import { ParticleHomebridgePlatform } from './platform';

const fetch = require('node-fetch');

export class FireplaceAccessory {
  private fireplace_service: Service;
  private Service: typeof Service;
  private Characteristic: typeof Characteristic;
  private current_state: boolean;

  constructor(
    private readonly platform: ParticleHomebridgePlatform,
    private readonly accessory: PlatformAccessory
  ) {
    this.current_state = false;
    this.Service = this.platform.Service;
    this.Characteristic = this.platform.Characteristic;

    // set accessory information
    this.accessory
      .getService(this.Service.AccessoryInformation)!
      .setCharacteristic(this.Characteristic.Manufacturer, 'NodeMCU')
      .setCharacteristic(this.Characteristic.Model, 'Fireplace');

    this.fireplace_service =
      this.accessory.getService(this.Service.Switch) || this.accessory.addService(this.Service.Switch);

    this.fireplace_service.setCharacteristic(this.Characteristic.Name, 'Fireplace');

    this.fireplace_service
      .getCharacteristic(this.Characteristic.On)
      .on(CharacteristicEventTypes.SET, this.handleOnSet.bind(this))
      .on(CharacteristicEventTypes.GET, this.handleOnGet.bind(this));
  }

  private handleOnGet(callback: CharacteristicGetCallback) {
    callback(null, this.current_state);
  }

  private handleOnSet(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    fetch(this.accessory.context.device.fireplaceUrl)
      .then((response) => {
        this.current_state = !this.current_state;
        callback();
        this.fireplace_service.updateCharacteristic(this.Characteristic.On, this.current_state);
      })
      .catch((error) => {
        this.platform.log.error(error);
        callback(error, null);
      });
  }
}
