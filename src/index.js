import PubSub from 'jraiser/pubsub/1.2/pubsub';

import UploadManager from './upload';
import { Queue } from './queue';
import { Pool } from './pool';
import {
  generateFileData,
  isContainFileMimeType
} from './utils';

// 队列的上传状态
const STATUS = {
  NOT_STARTED: 'notStarted',
  UPLOADING: 'uploading',
};

class PlvVideoUpload extends PubSub {
  /**
   * 封装一个上传视频文件到polyv云空间的插件
   * @example
   * const videoUpload = new PlvVideoUpload({
   *  events: {
   *    Error: (err) => { console.log(err); },
   *    UploadComplete: () => {}
   *  }
   * });
   * // 更新用户数据（由于sign等用户信息有效期为3分钟，需要每隔3分钟更新一次）
   * videoUpload.updateUserData({
   *  userid: data.userid,
   *  ptime: data.ts,
   *  sign: data.sign,
   *  hash: data.hash
   * });
   * // 开始上传所有文件
   * videoUpload.startAll();
   * // 添加文件到上传列表
   * const uploader = videoUpload.addFile(file, {
   *  FileStarted: () => {},
   *  FileStopped: () => {}
   * }, fileSetting);
   * // 暂停上传指定文件
   * videoUpload.stopFile(uploader.id);
   * @param {Object} [config] 用户设置
   * @param {Object} config.events 事件回调。包括Error、UploadComplete
   */
  constructor(config = {}) {
    super(config.events);

    this.config = {
      partSize: config.partSize, // 分片大小，不能小于100k。单位为Bytes。默认按文件大小自动分片
      threadCount: config.threadCount, // 上传并发线程数
      retryCount: config.retryCount, // 网络原因失败时，重新上传次数
      acceptedMimeType: config.acceptedMimeType, // 用户自定义在一定范围内允许上传的文件类型
      region: config.region || 'line1' // 上传线路, 默认line1, 华南
    };

    let parallelFileLimit = config.parallelFileLimit || 5; // 并行上传的文件数目；最大5个
    if (parallelFileLimit < 0 || parallelFileLimit > 5) {
      parallelFileLimit = 5;
    }

    // 文件队列
    this.fileQueue = new Queue();

    // 已添加但未允许开始上传的队列（未点击开始按钮或是暂停状态）
    this.waitQueue = new Queue();

    // 上传队列
    this.uploadPool = new Pool(uploader => uploader._start(), parallelFileLimit);

    this.userData = {};

    // 未添加then的promise数组，监控各视频文件的上传情况
    this.newUploadPromiseList = [];

    // 整个文件队列的上传状态
    this.status = STATUS.NOT_STARTED;
  }

  /**
   * 更新sign、ptime等授权验证信息，授权验证信息3分钟内有效
   * @param {UserData} userData
   */
  updateUserData(userData) {
    // 通过不改变对象的地址来保证可以同时更新所有UploadManager实例里面的userData属性
    for (const key in userData) {
      this.userData[key] = userData[key];
    }
  }

  /**
   * 修改指定文件的文件信息
   * @param {String} uploaderid UploadManager实例的id
   * @param {FileData} fileData 文件信息
   */
  updateFileData(uploaderid, fileData) {
    if (typeof fileData !== 'object') {
      return;
    }

    // 文件已经开始上传或已上传完毕，禁止修改文件信息
    const uploader = this.waitQueue.find(uploaderid);
    if (!uploader || uploader.statusCode !== 1) {
      this._emitError({
        code: 112,
        message: '文件已经开始上传或已上传完毕，禁止修改文件信息',
        data: {
          uploaderid
        }
      });
      return;
    }

    uploader.updateFileData(fileData);
  }

  /**
   * 添加文件到文件列表
   * @param {File} file 文件对象
   * @param {
     Object
   } [events] 事件回调。 包括FileStarted、 FileStopped、 FileSucceed、 FileProgress、 FileFailed
   * @param {Object} [fileSetting] 针对该文件的设置
   * @param {String} fileSetting.desc 文件描述
   * @param {Number} fileSetting.cataid=1 分类目录id
   * @param {String} fileSetting.tag 文件标签，不同标签之间使用英文逗号分隔
   * @param {Number} fileSetting.luping=0 开启视频课件优化处理，对于上传录屏类视频清晰度有所优化：0为不开启，1为开启
   * @param {Number} fileSetting.keepsource=0 源文件播放（不对源文件进行编码）：0为编码，1为不编码
   * @param {String} fileSetting.title=file.name 文件名称
   * @param {} fileSetting.state 自定义信息，会在上传完成的回调中返回
   * @return {UploadManager}
   */
  addFile(file, events = {}, fileSetting = {}) {
    const fileData = generateFileData(file, fileSetting, this.userData);

    // 拦截重复文件
    if (this.fileQueue.find(fileData.id)) {
      this._emitError({
        code: 110,
        message: '文件重复',
        data: {
          filename: fileData.title,
        }
      });
      throw new Error('Uploading duplicate file');
    }

    // 拦截文件类型不在acceptedMimeType中的文件
    if (!isContainFileMimeType(file, this.config.acceptedMimeType)) {
      this._emitError({
        code: 111,
        message: '文件类型错误',
        data: {
          filename: fileData.title
        }
      });
      throw new TypeError('Unacceptable file type');
    }

    this.fileQueue.enqueue(fileData);
    const uploader = new UploadManager(this.userData, fileData, events, this.config);

    if (this.status === STATUS.NOT_STARTED) {
      this.waitQueue.enqueue(uploader);
    } else {
      this.newUploadPromiseList.push(this.uploadPool.enqueue(uploader));
    }
    /** @type {UploadManager} */
    return uploader;
  }

  /**
   * 删除指定文件
   * @param {String} id 文件id，和对应的UploadManager实例的id一致
   */
  removeFile(id) {
    const uploader = this.uploadPool.remove(id);
    if (uploader) {
      uploader.isDeleted = true;
      uploader._stop();
    } else {
      // 同一个文件不能同时存在于waitQueue和uploadPool
      this.waitQueue.remove(id);
    }
    this.fileQueue.remove(id);
  }

  /**
   * 开始/继续上传指定文件
   * @param {String} id 文件id，和对应的UploadManager实例的id一致
   */
  resumeFile(id) {
    const uploader = this.waitQueue.remove(id);
    if (!uploader) {
      return;
    }
    this.newUploadPromiseList.push(this.uploadPool.enqueue(uploader));
    if (this.status === STATUS.NOT_STARTED) {
      this._onPromiseEnd();
    }
  }

  /**
   * 暂停上传指定文件
   * @param {String} id 文件id
   */
  stopFile(id) {
    const uploader = this.uploadPool.remove(id);
    if (uploader) {
      uploader._stop();
      this.waitQueue.enqueue(uploader);
    }
  }

  /**
   * 清空文件列表
   */
  clearAll() {
    this._stopAll(true); // 此时已清空uploadPool
    this.waitQueue.clear();
    this.fileQueue.clear();
  }

  /**
   * 开始上传所有文件
   */
  startAll() {
    while (this.waitQueue.size > 0) {
      const uploader = this.waitQueue.dequeue();
      if (uploader.statusCode !== -1) {
        this.newUploadPromiseList.push(this.uploadPool.enqueue(uploader));
      }
    }
    this.status = STATUS.UPLOADING;
    this._onPromiseEnd();
  }

  /**
   * 停止上传所有文件
   */
  stopAll() {
    this._stopAll();
  }

  // 停止上传，根据参数决定是否删除该文件
  _stopAll(isDeleted = false) {
    while (this.uploadPool.size > 0) {
      const uploader = this.uploadPool.dequeue();
      if (isDeleted) {
        uploader.isDeleted = true;
      }
      uploader._stop();
      // 未开始上传的文件按原顺序放到waitQueue
      if (uploader.statusCode === 1) {
        this.waitQueue.enqueue(uploader);
      }
    }
    this.status = STATUS.NOT_STARTED;
  }

  // 监听所有上传promise
  _onPromiseEnd() {
    const uploadPromiseList = [...this.newUploadPromiseList];
    this.newUploadPromiseList = [];

    // 判断所有文件上传是否结束
    Promise.all(uploadPromiseList)
      .then(() => {
        if (this.newUploadPromiseList.length > 0) { // 还有未监听到的promise
          this._onPromiseEnd();
        } else if (this.uploadPool.size === 0) {
          this.status = STATUS.NOT_STARTED;

          if (this.waitQueue.size === 0 && this.fileQueue.size !== 0) {

            /**
             * 所有文件上传结束
             * @fires PlvVideoUpload#UploadComplete
             */
            this.trigger('UploadComplete');
          }
        }
      });

    // 处理文件上传状态发生改变或上传报错的情况
    for (let i = 0; i < uploadPromiseList.length; i++) {
      uploadPromiseList[i]
        .then(res => {
          if (!res || !res.status) {
            return;
          }
          this._handleUploadStatusChange(res);
        })
        .catch(err => {
          this._emitError(err);
        });
    }
  }

  // 文件上传状态发生改变
  _handleUploadStatusChange(res) {
    const data = res.json();
    switch (res.status) {
      case 100: { // 完成上传
        this.waitQueue.remove(data.id);
        break;
      }
      case 102: { // 用户剩余空间不足
        this.waitQueue.unshift(data.uploader);
        this._emitError(res);
        break;
      }
      case 101: // init请求失败，或，multipartUpload上传失败
      case 104: // 暂停上传
      case 105: { // Multipart Upload ID 不存在
        if (data.uploader && !data.uploader.isDeleted) {
          this.waitQueue.unshift(data.uploader);
        }
        break;
      }
      case 106: // token过期，正在重试
      case 107: { // 上传错误，正在重试
        this.newUploadPromiseList.push(this.uploadPool.enqueue(data.uploader));
        if (this.status === STATUS.NOT_STARTED) {
          this._onPromiseEnd();
        }
        break;
      }
      default:
        break;
    }
  }

  _emitError(err) {
    /**
     * 文件上传出错
     * @fires PlvVideoUpload#Error
     */
    this.trigger('Error', err);
  }

  /**
   * 获取上传文件列表
   * @type {FileData[]}
   */
  get files() {
    return this.fileQueue.list;
  }
}

/**
 * @typedef {Object} ErrorData
 * @property {String} type - 错误类型
 * @property {String} message - 错误信息
 * @property {Number} code - 错误代码
 */

/**
 * @typedef {Object} FileData
 * @property {String} desc - 视频文件的描述内容
 * @property {Number} cataid=1 - 上传目录id
 * @property {String} tag - 指定视频文件的标签
 * @property {Number} luping=0 - 开启视频课件优化处理，对于上传录屏类视频清晰度有所优化：0为不开启，1为开启
 * @property {Number} keepsource=0 - 源文件播放（不对源文件进行编码）：0为编码，1为不编码
 * @property {file} file - 文件对象（只读）
 * @property {String} title - 文件名称
 * @property {Number} size - 文件大小，单位Bytes（只读）
 * @property {Number} filesize - 文件大小，单位Bytes（只读）
 * @property {String} vid - vid（只读）
 * @property {} state - 自定义信息，会在上传完成的回调中返回
 */

/**
 * @typedef {Object} UserData
 * @property {String} userid - [主账号]userid。需要在点播后台中获取。
 * @property {Number} ptime - [主账号]13位的毫秒级时间戳
 * @property {String} sign - [主账号]校验值其一，计算方式：md5(`${secretkey}${ptime}`)。secretkey需要在点播后台中获取。
 * @property {String} hash - [主账号]校验值其二，计算方式：md5(`${ptime}${writeToken}`)。writeToken需要在点播后台中获取。
 * @property {String} appId - [子账号]appId。需要在点播后台中获取。
 * @property {Number} timestamp - [子账号]13位的毫秒级时间戳
 * @property {String} sign - [子账号]校验值，计算方式：md5(`${secretkey}appId${appId}timestamp${timestamp}${secretkey}`).toUpperCase()。secretkey和appId需要在点播后台中获取。
 * @description 主账号/子账号的用户信息及校验值。这里的校验值有一定的时间期限，需要使用{@link PlvVideoUpload#updateUserData}方法每隔3分钟更新一次所有参数。
 */

/**
 * @typedef {Object} UploadManager
 * @property {String} id - 每个上传实例的唯一标识
 */

/**
 * 所有文件上传完成时触发。
 * @event PlvVideoUpload#UploadComplete
 */

/**
 * 上传过程出错时触发。
 * @event PlvVideoUpload#Error
 * @type {Object}
 * @property {Number} code 错误代码(110：文件重复，111：拦截文件类型不在acceptedMimeType中的文件，112：文件已经开始上传或已上传完毕，禁止修改文件信息，102：用户剩余空间不足)
 * @property {String} message 错误信息
 * @property {Object} data
 */

/**
 * 文件开始上传时触发。
 * @event PlvVideoUpload#FileStarted
 * @type {Object}
 * @property {String} uploaderid 触发事件的UploadManager的id
 * @property {FileData} fileData 文件信息
 */

/**
 * 文件暂停上传时触发。
 * @event PlvVideoUpload#FileStopped
 * @type {Object}
 * @property {String} uploaderid 触发事件的UploadManager的id
 * @property {FileData} fileData 文件信息
 */

/**
 * 文件上传过程返回上传进度信息时触发。
 * @event PlvVideoUpload#FileProgress
 * @type {Object}
 * @property {String} uploaderid 触发事件的UploadManager的id
 * @property {FileData} fileData 文件信息
 * @property {Number} progress 上传进度，范围为0~1
 */

/**
 * 文件上传成功时触发。
 * @event PlvVideoUpload#FileSucceed
 * @type {Object}
 * @property {String} uploaderid 触发事件的UploadManager的id
 * @property {FileData} fileData 文件信息
 */

/**
 * 文件上传失败时触发。
 * @event PlvVideoUpload#FileFailed
 * @property {String} uploaderid 触发事件的UploadManager的id
 * @property {FileData} fileData 文件信息
 * @property {ErrorData} errData 报错信息
 */

export default PlvVideoUpload;
