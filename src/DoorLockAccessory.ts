import {
  Service,
  PlatformAccessory,
  CharacteristicValue,
  CharacteristicEventTypes,
  CharacteristicGetCallback,
  CharacteristicSetCallback,
  Characteristic,
  HAPStatus,
} from 'homebridge';
import { URLSearchParams } from 'url';
import AbortController from 'abort-controller';

import { ParticleHomebridgePlatform } from './platform';

const fetch = require('node-fetch');
const eventSource = require('eventsource');

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class DoorLockPlatformAccessory {
  private door_service: Service;
  private lock_service: Service;

  private CurrentDoorState: typeof Characteristic.CurrentDoorState;
  private TargetDoorState: typeof Characteristic.TargetDoorState;

  private Service: typeof Service;
  private Characteristic: typeof Characteristic;

  private accessToken: string;
  private deviceId: string;
  private url: string = 'https://api.particle.io/v1/';
  private doorOpensInSeconds: number;
  private eventName: string;
  private functionName: string;
  private variableName: string;
  private x = 1;
  private isClosed: boolean = false;

  private most_recent_target_door_state;

  private requestTimeout = 7000;

  constructor(
    private readonly platform: ParticleHomebridgePlatform,
    private readonly accessory: PlatformAccessory
  ) {
    this.Service = this.platform.Service;
    this.Characteristic = this.platform.Characteristic;
    this.TargetDoorState = this.Characteristic.TargetDoorState;
    this.CurrentDoorState = this.Characteristic.CurrentDoorState;

    this.most_recent_target_door_state = this.TargetDoorState.CLOSED;

    const config = this.accessory.context.device;

    this.accessToken = config['access_token'];
    this.deviceId = config['device_id'];
    // this.url = config['url'];
    this.doorOpensInSeconds = config['doorOpensInSeconds'];
    this.eventName = config['doorStateChangedEventName'];
    this.functionName = config['doorOpenCloseFunctionName'];
    this.variableName = config['doorOpenSensorVariableName'];

    // set accessory information
    this.accessory
      .getService(this.Service.AccessoryInformation)!
      .setCharacteristic(this.Characteristic.Manufacturer, 'Particle.io')
      .setCharacteristic(this.Characteristic.Model, 'Photon')
      .setCharacteristic(this.Characteristic.SerialNumber, this.deviceId);

    this.door_service =
      this.accessory.getService(this.Service.ContactSensor) ||
      this.accessory.addService(this.Service.ContactSensor);

    this.lock_service =
      this.accessory.getService(this.Service.LockMechanism) ||
      this.accessory.addService(this.Service.LockMechanism);

    // set the service name, this is what is displayed as the default name on the Home app
    this.lock_service.setCharacteristic(this.Characteristic.Name, accessory.context.device.name);
    // this.lock_service.setCharacteristic(this.Characteristic.Name, accessory.context.device.name);

    this.lock_service
      .getCharacteristic(this.Characteristic.LockTargetState)
      .on(CharacteristicEventTypes.SET, this.handleTargetLockStateSet.bind(this))
      .on(CharacteristicEventTypes.GET, this.handleTargetLockStateGet.bind(this));

    this.lock_service
      .getCharacteristic(this.Characteristic.LockCurrentState)
      .on(CharacteristicEventTypes.GET, this.handleCurrentLockStateGet.bind(this));

    this.door_service
      .getCharacteristic(this.Characteristic.ContactSensorState)
      .on(CharacteristicEventTypes.GET, this.handleCurrentDoorStateGet.bind(this));
  }

  private handleTargetLockStateSet(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    this.platform.log.debug('Triggered SET LockTargetState:', value);
    callback();
  }

  private handleTargetLockStateGet(callback: CharacteristicGetCallback) {
    this.platform.log.debug('handleTargetLockStateGet() ->', this.Characteristic.LockCurrentState.UNSECURED);
    callback(HAPStatus.SUCCESS, this.Characteristic.LockCurrentState.UNSECURED);
  }

  private handleCurrentLockStateGet(callback: CharacteristicGetCallback) {
    this.platform.log.debug('handleCurrentLockStateGet() -> ');
    // this.fetchCurrentState(this.updateStates.bind(this));
    callback(HAPStatus.SUCCESS, this.Characteristic.LockCurrentState.UNSECURED);
  }

  private handleCurrentDoorStateGet(callback: CharacteristicGetCallback) {
    this.platform.log.debug(
      'handleCurrentDoorStateGet() -> ',
      this.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
    );
    // this.fetchCurrentState(this.updateStates.bind(this));
    callback(HAPStatus.SUCCESS, this.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED);
  }

  private throwNotRespondingError() {
    throw new this.platform.api.hap.HapStatusError(
      this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
    );
  }
}
