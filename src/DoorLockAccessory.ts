import {
  Service,
  PlatformAccessory,
  CharacteristicValue,
  CharacteristicEventTypes,
  CharacteristicGetCallback,
  CharacteristicSetCallback,
  Characteristic,
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

  private ContactSensorState: typeof Characteristic.ContactSensorState;
  private LockCurrentState: typeof Characteristic.LockCurrentState;
  private LockTargetState: typeof Characteristic.LockTargetState;

  private Service: typeof Service;
  private Characteristic: typeof Characteristic;

  private accessToken: string;
  private deviceId: string;
  private url: string = 'https://api.particle.io/v1/';
  private doorEventName: string;
  private lockEventName: string;
  private lockToggleFunctionName: string;
  private lockVariableName: string;
  private doorPositionUrl: string;

  private most_recent_target_lock_state;

  private requestTimeout = 7000;

  constructor(
    private readonly platform: ParticleHomebridgePlatform,
    private readonly accessory: PlatformAccessory
  ) {
    this.Service = this.platform.Service;
    this.Characteristic = this.platform.Characteristic;
    this.LockCurrentState = this.Characteristic.LockCurrentState;
    this.LockTargetState = this.Characteristic.LockTargetState;
    this.ContactSensorState = this.Characteristic.ContactSensorState;

    this.most_recent_target_lock_state = this.LockTargetState.SECURED;

    const config = this.accessory.context.device;

    this.accessToken = config['access_token'];
    this.deviceId = config['device_id'];
    this.doorPositionUrl = config['doorPositionUrl'];
    this.doorEventName = config['doorStateChangedEventName'];
    this.lockEventName = config['lockStateChangedEventName'];
    this.lockToggleFunctionName = config['lockToggleFunctionName'];
    this.lockVariableName = config['lockPositionVariableName'];

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
    this.door_service.setCharacteristic(this.Characteristic.Name, 'Contact Sensor');

    this.lock_service
      .getCharacteristic(this.LockTargetState)
      .on(CharacteristicEventTypes.SET, this.handleTargetLockStateSet.bind(this))
      .on(CharacteristicEventTypes.GET, this.handleTargetLockStateGet.bind(this));

    this.lock_service
      .getCharacteristic(this.LockCurrentState)
      .on(CharacteristicEventTypes.GET, this.handleCurrentLockStateGet.bind(this));

    this.door_service
      .getCharacteristic(this.ContactSensorState)
      .on(CharacteristicEventTypes.GET, this.handleCurrentDoorStateGet.bind(this));

    const particleAuthHeader = { headers: { Authorization: `Bearer ${this.accessToken}` } };
    this.setupDoorStateListener(particleAuthHeader);
    this.setupLockStateListener(particleAuthHeader);
  }

  private setupDoorStateListener(headers) {
    const eventUrl = this.url + 'events/' + this.doorEventName;
    const es = new eventSource(eventUrl, headers);
    es.onerror = function () {
      console.error('ERROR!');
    };
    es.addEventListener(this.doorEventName, this.doorStateDidChange.bind(this), false);
  }

  private setupLockStateListener(headers) {
    const eventUrl = this.url + 'events/' + this.lockEventName;
    const es = new eventSource(eventUrl, headers);
    es.onerror = function () {
      console.error('ERROR!');
    };
    es.addEventListener(this.lockEventName, this.lockStateDidChange.bind(this), false);
  }

  private doorStateDidChange(e) {
    var data = JSON.parse(e.data);
    if (data.coreid === this.deviceId) {
      this.platform.log.debug('doorStateDidChange: ' + data.data);

      if (data.data == 'opened') {
        this.door_service.updateCharacteristic(
          this.ContactSensorState,
          this.ContactSensorState.CONTACT_NOT_DETECTED
        );
      } else if (data.data == 'closed') {
        this.door_service.updateCharacteristic(
          this.ContactSensorState,
          this.ContactSensorState.CONTACT_DETECTED
        );
      }
    }
  }

  private lockStateDidChange(e) {
    var data = JSON.parse(e.data);
    if (data.coreid === this.deviceId) {
      this.platform.log.debug('lockStateDidChange: ' + data.data);

      if (data.data == 'unlocked') {
        this.lock_service.updateCharacteristic(this.LockCurrentState, this.LockCurrentState.UNSECURED);
        this.lock_service.updateCharacteristic(this.LockTargetState, this.LockTargetState.UNSECURED);
        this.most_recent_target_lock_state = this.LockTargetState.UNSECURED;
      } else if (data.data == 'locked') {
        this.lock_service.updateCharacteristic(this.LockCurrentState, this.LockCurrentState.SECURED);
        this.lock_service.updateCharacteristic(this.LockTargetState, this.LockTargetState.SECURED);
        this.most_recent_target_lock_state = this.LockTargetState.SECURED;
      }
    }
  }

  private handleTargetLockStateSet(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    this.platform.log.debug('Triggered SET LockTargetState:', value);
    //call particle set lock state
    this.most_recent_target_lock_state = value;

    const toggleLockUrl = this.url + 'devices/' + this.deviceId + '/' + this.lockToggleFunctionName;

    const params = new URLSearchParams();
    params.append('access_token', this.accessToken);
    params.append('args', value == this.LockTargetState.SECURED ? 'lock' : 'unlock');

    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), this.requestTimeout);

    fetch(toggleLockUrl, {
      method: 'POST',
      body: params,
      signal: controller.signal,
    })
      .then((response) => {
        clearTimeout(id);
        if (response.ok) {
          callback();
        } else {
          throw new this.platform.api.hap.HapStatusError(
            this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
          );
        }
      })
      .catch((error) => {
        this.platform.log.error(error);
        callback(error);
      });

    //wait 1 sec then call particle to get lock state
    //updateCharacteristic with new lock state
    setTimeout(this.fetchCurrentLockState.bind(this, this.updateLockStates.bind(this)), 1000);
  }

  private handleTargetLockStateGet(callback: CharacteristicGetCallback) {
    this.platform.log.debug('handleTargetLockStateGet() ->', this.most_recent_target_lock_state);
    callback(null, this.most_recent_target_lock_state);
  }

  private handleCurrentLockStateGet(callback: CharacteristicGetCallback) {
    this.platform.log.debug('handleCurrentLockStateGet() -> ');
    this.fetchCurrentLockState(callback);
  }

  private handleCurrentDoorStateGet(callback: CharacteristicGetCallback) {
    this.platform.log.debug('handleCurrentDoorStateGet() -> ');
    this.fetchCurrentDoorState(callback);
  }

  private fetchCurrentLockState(callback: Function): any {
    const isClosedUrl =
      this.url +
      'devices/' +
      this.deviceId +
      '/' +
      this.lockVariableName +
      '?access_token=' +
      this.accessToken;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), this.requestTimeout);
    fetch(isClosedUrl, { signal: controller.signal })
      .then((response) => {
        clearTimeout(id);
        // this.platform.log.debug('response', response);
        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }
        return response.json();
      })
      .then((data) => {
        const result = data['result'];
        this.platform.log.debug('current lock state: ' + (result === 0 ? 'locked' : 'unlocked'));
        if (result == 0) {
          // 0 from Particle means locked
          callback(null, this.LockCurrentState.SECURED);
        } else if (result == 1) {
          callback(null, this.LockCurrentState.UNSECURED);
        } else {
          this.platform.log.error(`Cannot get ${this.lockVariableName}`);
          callback(new Error(`Cannot get ${this.lockVariableName}`), null);
        }
      })
      .catch((error) => {
        this.platform.log.error(error);
        callback(error, null);
      });
  }

  private updateLockStates(error, state) {
    // this.platform.log.debug('Updating states: isClosed=', state == this.CurrentDoorState.CLOSED);
    if (!error) {
      const isLocked = state == this.LockCurrentState.SECURED;
      this.most_recent_target_lock_state = isLocked
        ? this.LockTargetState.SECURED
        : this.LockTargetState.UNSECURED;

      this.lock_service.updateCharacteristic(this.LockTargetState, this.most_recent_target_lock_state);
      this.lock_service.updateCharacteristic(this.LockCurrentState, state);
    } else {
      this.lock_service.updateCharacteristic(this.LockCurrentState, error);
    }
  }

  private fetchCurrentDoorState(callback: Function): any {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), this.requestTimeout);
    fetch(this.doorPositionUrl, { signal: controller.signal })
      .then((response) => {
        clearTimeout(id);
        // this.platform.log.debug('response', response);
        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }
        return response.json();
      })
      .then((data) => {
        const result = data['state'];
        this.platform.log.debug('current state: ' + result);
        if (result == 'closed') {
          callback(null, this.ContactSensorState.CONTACT_DETECTED);
        } else if (result == 'open') {
          callback(null, this.ContactSensorState.CONTACT_NOT_DETECTED);
        } else {
          this.platform.log.error(`Cannot get current door position from ${this.doorPositionUrl}`);
          callback(new Error(`Cannot get current door position from ${this.doorPositionUrl}`), null);
        }
      })
      .catch((error) => {
        this.platform.log.error(error);
        callback(error, null);
      });
  }
}
