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
export class GarageOpenerPlatformAccessory {
  private garage_service: Service;

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
  private moving = false;

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

    // get the LightBulb service if it exists, otherwise create a new LightBulb service
    // you can create multiple services for each accessory
    this.garage_service =
      this.accessory.getService(this.Service.GarageDoorOpener) ||
      this.accessory.addService(this.Service.GarageDoorOpener);

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.garage_service.setCharacteristic(this.Characteristic.Name, accessory.context.device.name);

    this.garage_service
      .getCharacteristic(this.TargetDoorState)
      .on(CharacteristicEventTypes.SET, this.handleTargetDoorStateSet.bind(this))
      .on(CharacteristicEventTypes.GET, this.handleTargetDoorStateGet.bind(this));

    this.garage_service
      .getCharacteristic(this.CurrentDoorState)
      .on(CharacteristicEventTypes.GET, this.handleCurrentDoorStateGet.bind(this));
    // .onGet(this.handleCurrentDoorStateGet.bind(this));

    var eventUrl = this.url + 'events/' + this.eventName;
    const particleAuthHeader = { headers: { Authorization: `Bearer ${this.accessToken}` } };
    const es = new eventSource(eventUrl, particleAuthHeader);

    this.platform.log.debug('registering event: ' + eventUrl);

    es.onerror = function () {
      console.error('ERROR!');
    };

    es.addEventListener(this.eventName, this.doorStateDidChange.bind(this), false);

    this.fetchCurrentState(this.updateStates.bind(this));

    // setInterval(this.fetchCurrentState.bind(this, this.updateStates.bind(this)), 1 * 60 * 1000);

    // this.fetchCurrentState(this.updateStates.bind(this));
    // setInterval(this.doThings.bind(this), 10000);
  }

  private doorStateDidChange(e) {
    if (this.moving) {
      setTimeout(this.handleDoorStateChanged.bind(this, e), 2000);
    } else {
      this.handleDoorStateChanged(e);
    }
  }

  private handleDoorStateChanged(e) {
    var data = JSON.parse(e.data);
    if (data.coreid === this.deviceId) {
      this.moving = false;

      this.platform.log.debug('doorStateDidChange: ' + data.data);

      if (data.data == 'door-opened') {
        this.updateStates(null, this.CurrentDoorState.OPEN);
      } else if (data.data == 'door-closed') {
        this.updateStates(null, this.CurrentDoorState.CLOSED);
      }
    }
  }

  private fetchCurrentState(callback?: Function): any {
    const isClosedUrl =
      this.url + 'devices/' + this.deviceId + '/' + this.variableName + '?access_token=' + this.accessToken;
    // this.platform.log.debug('URL: ', isClosedUrl);
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), this.requestTimeout);
    fetch(isClosedUrl, { signal: controller.signal })
      .then((response) => {
        clearTimeout(id);
        // this.platform.log.debug('response', response);
        // indicates whether the response is successful (status code 200-299) or not
        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }
        return response.json();
      })
      .then((data) => {
        const result = data['result'];
        this.platform.log.debug('current state: ' + (result === 0 ? 'closed' : 'open'));
        if (result == 0) {
          // 0 from Particle means closed
          if (callback) callback(null, this.CurrentDoorState.CLOSED);
          else return this.CurrentDoorState.CLOSED;
        } else if (result == 1) {
          if (callback) callback(null, this.CurrentDoorState.OPEN);
          else return this.CurrentDoorState.OPEN;
        } else {
          this.platform.log.error(`Cannot get ${this.variableName}`);
          if (callback) callback(new Error(`Cannot get ${this.variableName}`), null);
          else return new Error(`Cannot get ${this.variableName}`);
        }
      })
      .catch((error) => {
        this.platform.log.error(error);
        // if (error instanceof Error && error.name === 'AbortError') {
        //   this.platform.log.error(`Timeout while retrieving ${this.variableName}`);
        //   callback(new Error(`Timeout while retrieving ${this.variableName}`), null);
        // }
        if (callback) callback(error, null);
        else return error;
      });
  }

  private updateStates(error, state) {
    // this.platform.log.debug('Updating states: isClosed=', state == this.CurrentDoorState.CLOSED);
    if (!error) {
      this.isClosed = state == this.CurrentDoorState.CLOSED;
      this.most_recent_target_door_state = this.isClosed
        ? this.TargetDoorState.CLOSED
        : this.TargetDoorState.OPEN;

      this.garage_service.updateCharacteristic(this.TargetDoorState, this.most_recent_target_door_state);
      this.garage_service.updateCharacteristic(this.CurrentDoorState, state);
    } else {
      // this.garage_service.updateCharacteristic(this.TargetDoorState, error);
      this.garage_service.updateCharacteristic(this.CurrentDoorState, error);
    }
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, turning on a Light bulb.
   */
  private handleTargetDoorStateSet(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    this.moving = true;
    this.platform.log.debug('handleTargetDoorStateSet() ->', value);
    this.most_recent_target_door_state = value;

    const newCurrentState =
      value == this.TargetDoorState.OPEN ? this.CurrentDoorState.OPENING : this.CurrentDoorState.CLOSING;
    this.garage_service.updateCharacteristic(this.CurrentDoorState, newCurrentState);
    this.platform.log.debug('setting currentDoorState to ->', newCurrentState);

    const openCloseUrl = this.url + 'devices/' + this.deviceId + '/' + this.functionName;

    const params = new URLSearchParams();
    params.append('access_token', this.accessToken);
    params.append('args', value == this.TargetDoorState.OPEN ? 'open' : 'close');

    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), this.requestTimeout);

    fetch(openCloseUrl, {
      method: 'POST',
      body: params,
      signal: controller.signal,
    })
      .then((response) => {
        clearTimeout(id);
        if (response.ok) {
          callback();
        } else {
          this.throwNotRespondingError();
        }
      })
      .catch((error) => {
        this.platform.log.error(error);
        callback(error);
      });

    setTimeout(() => {
      this.moving = false;
    }, 3000);

    setTimeout(
      this.fetchCurrentState.bind(this, this.updateStates.bind(this)),
      (this.doorOpensInSeconds || 20) * 1000
    );
  }

  private handleTargetDoorStateGet(callback: CharacteristicGetCallback) {
    this.platform.log.debug('handleTargetDoorStateGet() ->', this.most_recent_target_door_state);
    callback(null, this.most_recent_target_door_state);
  }

  private handleCurrentDoorStateGet(callback: CharacteristicGetCallback) {
    this.platform.log.debug('handleCurrentDoorStateGet() -> ');
    this.fetchCurrentState(callback);
    // this.platform.log.debug('done');
    // if (stateOrError instanceof Error) {
    //   this.updateStates(stateOrError, null);
    //   callback(HAPStatus.SERVICE_COMMUNICATION_FAILURE, null);
    // } else {
    //   this.updateStates(null, stateOrError);
    //   callback(null, stateOrError);
    // }
  }

  // private handleCurrentDoorStateGet(): Promise<CharacteristicValue> {
  //   this.platform.log.debug('handleCurrentDoorStateGet() -> ');

  //   return new Promise((resv, rejt) => {
  //     const state = this.fetchCurrentState();
  //     if (state instanceof Error) {
  //       rejt(state);
  //     } else {
  //       resv(state);
  //     }
  //   });
  // callback(HAPStatus.SUCCESS, null);
  // }

  private throwNotRespondingError() {
    throw new this.platform.api.hap.HapStatusError(
      this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
    );
  }
}
