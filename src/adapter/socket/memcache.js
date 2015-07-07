'use strict';

import net from 'net';
import {EventEmitter} from 'events';

let CRLF = '\r\n'; //line break
let CRLF_LENGTH = CRLF.length;
let ERRORS = ['ERROR', 'NOT_FOUND', 'CLIENT_ERROR', 'SERVER_ERROR']; //error message
let ERRORS_LENGTH = ERRORS.length;

//read line data
let readLine = string => {
  let pos = string.indexOf(CRLF);
  if (pos > -1) {
    return string.substr(0, pos);
  }
  return string;
};

/**
 * memcache socket class
 * @type {Class}
 */
module.exports = class extends EventEmitter {
  /**
   * constructor
   * @param  {} args []
   * @return {}         []
   */
  constructor(...args){
    super(...args);
    this.init(...args);
  }
  /**
   * init
   * @param  {Number} port     [memcache port]
   * @param  {String} hostname [memcache hostname]
   * @return {}          []
   */
  init(port, hostname){
    EventEmitter.call(this);
    this.port = port || 11211;
    this.hostname = hostname || '127.0.0.1';
    this.buffer = '';
    this.callbacks = []; 
    this.handle = null; 
  }
  /**
   * connect memcache
   * @return {} []
   */
  connect(){
    if (this.handle) {
      return this;
    }
    let deferred = think.defer();
    this.handle = net.createConnection(this.port, this.host);
    this.handle.on('connect', () => {
      this.setTimeout(0);
      this.setNoDelay();
      this.emit('connect');
      deferred.resolve();
    });
    this.handle.on('data', data => {
      this.buffer += data.toString();
      this.handleData();
    });
    this.handle.on('end', () => {
      while(this.callbacks.length > 0){
        let callback = this.callbacks.shift();
        if (callback && callback.callback) {
          callback.callback('CONNECTION_CLOSED');
        }
      }
      this.handle = null;
    });
    this.handle.on('close', () => {
      this.handle = null;
      this.emit('close');
    });
    this.handle.on('timeout', () => {
      if (this.callbacks.length > 0) {
        let callback = this.callbacks.shift();
        if (callback && callback.callback) {
          callback.callback('TIMEOUT');
        }
      }
      this.emit('timeout');
    });
    this.handle.on('error', error => {
      while(this.callbacks.length > 0){
        let callback = this.callbacks.shift();
        if (callback && callback.callback) {
          callback.callback('ERROR');
        }
      }
      this.handle = null;
      this.emit('clienterror', error);
    });
    this.promise = deferred.promise;
    return this;
  }
  /**
   * parse data
   * @return {} []
   */
  handleData(){
    while(this.buffer.length > 0){
      let result = this.getHandleResult(this.buffer);
      if(result === false){
        break;
      }
      let value = result[0];
      let pos = result[1];
      let error = result[2];
      if (pos > this.buffer.length) {
        break;
      }
      this.buffer = this.buffer.substring(pos);
      let callback = this.callbacks.shift();
      if (callback && callback.callback) {
        callback.callback(error, value);
      }
    }
  }
  /**
   * get handle result
   * @param  {String} buffer []
   * @return {}        []
   */
  getHandleResult(buffer){
    if (buffer.indexOf(CRLF) === -1) {
      return false;
    }
    for(let i = 0; i < ERRORS_LENGTH; i++){
      let item = ERRORS[i];
      if (buffer.indexOf(item) > -1) {
        return this.handleError(buffer);
      }
    }
    let callback = this.callbacks[0];
    if (callback && callback.type) {
      let ucfirst = callback.type[0].toUpperCase() + callback.type.slice(1).toLowerCase();
      return this['handle' + ucfirst](buffer);
    }
    return false;
  }
  /**
   * handle error
   * @param  {String} buffer []
   * @return {Array}        []
   */
  handleError(buffer){
    let line = readLine(buffer);
    return [null, line.length + CRLF_LENGTH, line];
  }
  /**
   * handle get
   * @param  {String} buffer []
   * @return {Array}        []
   */
  handleGet(buffer){
    let value = null;
    let end = 3;
    let resultLen = 0;
    let firstPos;
    if (buffer.indexOf('END') === 0) {
      return [value, end + CRLF_LENGTH];
    }else if (buffer.indexOf('VALUE') === 0 && buffer.indexOf('END') > -1) {
      firstPos = buffer.indexOf(CRLF) + CRLF_LENGTH;
      let endPos = buffer.indexOf('END');
      resultLen = endPos - firstPos - CRLF_LENGTH;
      value = buffer.substr(firstPos, resultLen);
      return [value, firstPos + parseInt(resultLen, 10) + CRLF_LENGTH + end + CRLF_LENGTH];
    }else{
      firstPos = buffer.indexOf(CRLF) + CRLF_LENGTH;
      resultLen = buffer.substr(0, firstPos).split(' ')[3];
      value = buffer.substr(firstPos, resultLen);
      return [value, firstPos + parseInt(resultLen) + CRLF_LENGTH + end + CRLF_LENGTH];
    }
  }
  /**
   * handle simple data
   * @param  {String} buffer []
   * @return {Array}        []
   */
  handleSimple(buffer){
    let line = readLine(buffer);
    return [line, line.length + CRLF_LENGTH, null];
  }
  /**
   * handle version
   * @param  {String} buffer []
   * @return {Array}        []
   */
  handleVersion(buffer){
    let pos = buffer.indexOf(CRLF);
    //8 is length of 'VERSION '
    let value = buffer.substr(8, pos - 8);
    return [value, pos + CRLF_LENGTH, null];
  }
  /**
   * exec command
   * @param  {String} query []
   * @param  {String} type  []
   * @return {Promise}       []
   */
  query(query, type){
    this.connect();
    let deferred = think.defer();
    let callback = (error, value) => {
      return error ? deferred.reject(error) : deferred.resolve(value);
    };
    this.promise.then(() => {
      this.callbacks.push({type: type, callback: callback});
      this.handle.write(query + CRLF);
    });
    return deferred.promise;
  }
  /**
   * get data
   * @param  {String} key []
   * @return {Promise}     []
   */
  get(key){
    return this.query('get ' + key, 'get');
  }
  /**
   * store data
   * @param  {String} key      []
   * @param  {Mixed} value    []
   * @param  {Number} lifetime []
   * @param  {} flags    []
   * @return {Promise}          []
   */
  store(key, value, type, lifetime, flags){
    lifetime = lifetime || 0;
    flags = flags || 0;
    let length = Buffer.byteLength(value.toString());
    let query = [type, key, flags, lifetime, length].join(' ') + CRLF + value;
    return this.query(query, 'simple');
  }
  /**
   * delete data
   * @param  {String} key []
   * @return {Promise}     []
   */
  delete(key){
    return this.query('delete ' + key, 'simple');
  }
  /**
   * get version
   * @return {Promise} []
   */
  version(){
    return this.query('version', 'version');
  }
  /**
   * increment value
   * @param  {String} key  []
   * @param  {Number} step []
   * @return {Promise}      []
   */
  increment(key, step = 1){
    return this.query('incr ' + key + ' ' + step, 'simple');
  }
  /**
   * decrement value
   * @param  {String} key  []
   * @param  {Number} step []
   * @return {Promise}      []
   */
  decrement(key, step = 1){
    return this.query('decr ' + key + ' ' + step, 'simple');
  }
  /**
   * set data
   * @param  {String} key      []
   * @param  {Mixed} value    []
   * @param  {Number} lifetime []
   * @param  {} flags    []
   * @return {Promise}          []
   */
  set(key, value, lifetime, flags){
    return this.store(key, value, 'set', lifetime, flags);
  }
  /**
   * add
   * @param  {String} key      []
   * @param  {Mixed} value    []
   * @param  {Number} lifetime []
   * @param  {} flags    []
   * @return {Promise}          []
   */
  add(key, value, lifetime, flags){
    return this.store(key, value, 'add', lifetime, flags);
  }
  /**
   * replace
   * @param  {String} key      []
   * @param  {Mixed} value    []
   * @param  {Number} lifetime []
   * @param  {} flags    []
   * @return {Promise}          []
   */
  replace(key, value, lifetime, flags){
    return this.store(key, value, 'replace', lifetime, flags);
  }
  /**
   * append
   * @param  {String} key      []
   * @param  {Mixed} value    []
   * @param  {Number} lifetime []
   * @param  {} flags    []
   * @return {Promise}          []
   */
  append(key, value, lifetime, flags){
    return this.store(key, value, 'append', lifetime, flags);
  }
  /**
   * prepend
   * @param  {String} key      []
   * @param  {Mixed} value    []
   * @param  {Number} lifetime []
   * @param  {} flags    []
   * @return {Promise}          []
   */
  prepend(key, value, lifetime, flags){
    return this.store(key, value, 'prepend', lifetime, flags);
  }
  /**
   * close connect
   * @return {} []
   */
  close(){
    if (this.handle && this.handle.readyState === 'open') {
      this.handle.end();
      this.handle = null;
    }
  }
};