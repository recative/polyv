/* eslint-disable no-undef */
import OSS from "ali-oss";
import md5 from "md5";
import fetch from "node-fetch";

export interface IPlvNodeUploaderConfig {
  region?: string;
}

export interface IUserData {
  userid: string;
  ptime: number;
  sign: string;
  hash: string;
  appId?: string;
  timestamp?: number;
  region?: string;
}

export interface IFileSetting {
  desc: string;
  cataid: number;
  tag: string;
  luping: number;
  keepsource: number;
  title: string;
  state: unknown;
}

export interface IFileData {
  id: string;
  desc: string;
  cataid: number;
  tag: string;
  luping: number;
  keepsource: number;
  buffer: Buffer;
  title: string;
  mime: string;
  vid: string;
  state: unknown;
}

interface IParsedCallback {
  callbackUrl: string;
  callbackBody: string;
  callbackHost: string;
}

export interface IUploadInitData {
  remainSpace: number;
  vid: string;
  accessId: string;
  bucketName: string;
  validityTime: number;
  endpoint: string;
  encodedCallback: string;
  accessKey: string;
  domain: string;
  Expiration: Date;
  host: string;
  callback: string;
  dir: string;
  token: string;
}

export interface IPolyVRequest<T> {
  code: number;
  status: string;
  message: string;
  data: T;
}

const cleanupFileName = (x: string) => {
  return x.trim().replace(/<.+?>/g, "");
};

const DEFAULT_FILE_DATA = {
  desc: "",
  cataid: 1,
  tag: "",
  luping: 0,
  keepsource: 0,
  title: "",
  filename: "",
  vid: "",
  id: "",
};

export class PlvNodeVideoUpload {
  config: IPlvNodeUploaderConfig;
  userData: IUserData = {
    userid: "",
    ptime: Date.now(),
    sign: "",
    hash: "",
  };

  constructor(config: IPlvNodeUploaderConfig = {}) {
    this.config = {
      region: config.region || "line1", // 上传线路, 默认line1, 华南
    };
  }

  static generateFingerprint = (fileData: IFileData, userData: IUserData) => {
    const { cataid, title, mime } = fileData;
    return md5(
      `polyv-${userData.userid}-${cataid}-${title}-${mime}-${md5(
        fileData.buffer
      )}`
    );
  };

  static generateFileData(
    buffer: Buffer,
    filename: string,
    mime: string,
    userData: IUserData
  ) {
    const fileData: IFileData = Object.assign({}, DEFAULT_FILE_DATA, {
      title: cleanupFileName(filename),
      buffer,
      filename,
      mime,
      state: {},
    });

    fileData.id = PlvNodeVideoUpload.generateFingerprint(fileData, userData);

    return fileData;
  }

  static generateOssConfig(data: any) {
    return {
      endpoint: `https://${data.domain}`,
      bucket: data.bucketName,
      accessKeyId: data.accessId,
      accessKeySecret: data.accessKey,
      stsToken: data.token,
      secure: true,
      cname: true,
    };
  }

  updateUserData(userData: IUserData) {
    this.userData = Object.assign({}, this.userData, userData);
  }

  /**
   * Upload directly, skip all the fashion things.
   */
  async upload(buffer: Buffer, filename: string, mime: string) {
    const fileData = PlvNodeVideoUpload.generateFileData(
      buffer,
      filename,
      mime,
      this.userData
    );

    const response = await this.initUpload(this.userData, fileData);
    const body = (await response.json()) as IPolyVRequest<IUploadInitData>;
    const data = body.data;

    if (body.status === 'error') {
      console.error("Unable to initialize the uploading task", data);
      const error = new Error(body.message);
      error.name = `E${body.code}`;
      throw error;
    }

    const vid = data.vid;
    const callback = JSON.parse(data.callback || "null") as IParsedCallback | null;

    if (callback === null) {
      throw new Error(`Unable to get callback url`);
    }

    const callbackBody = {
      url: callback.callbackUrl,
      body: callback.callbackBody,
      host: callback.callbackHost,
    };

    const ossConfig = PlvNodeVideoUpload.generateOssConfig(data);

    // The file name on the OSS
    const filenameOss =
      data.dir + data.vid + filename.substring(filename.lastIndexOf("."));

    const ossClient = new OSS(ossConfig);

    await ossClient.multipartUpload(filenameOss, buffer, {
      callback: callbackBody,
    });

    return { ...fileData, vid };
  }

  initUpload = async (userData: IUserData, fileData: IFileData) => {
    if (userData.appId) {
      const data = {
        appId: userData.appId,
        timestamp: userData.timestamp,
        sign: userData.sign,
        title: fileData.title,
        description: fileData.desc,
        cateId: fileData.cataid,
        tag: fileData.tag,
        luping: fileData.luping,
        filename: fileData.title,
        size: fileData.buffer.byteLength,
        keepSource: fileData.keepsource,
        autoid: 1,
        isSts: "Y",
        uploadType: "js_sdk_chunk_v1",
      };
      const url =
        "https://api.polyv.net/inner/v3/upload/video/create-upload-task";
      const postData = new URLSearchParams();

      Object.entries(data).forEach(([key, value]) => {
        value && postData.append(key, `${value}`);
      });

      return fetch(url, {
        method: "POST",
        body: postData,
      });
    }

    const data = {
      ptime: userData.ptime,
      sign: userData.sign,
      hash: userData.hash,

      title: fileData.title,
      describ: fileData.desc,
      cataid: fileData.cataid,
      tag: fileData.tag,
      luping: fileData.luping,
      keepsource: fileData.keepsource,
      filesize: fileData.buffer.byteLength,
      state: fileData.state,

      autoid: 1,
      uploadType: "js_sdk_chunk_v1",
      compatible: 1,

      uploadLine: userData.region || "line1",
    };
    const url = `https://api.polyv.net/v2/uploadvideo/${userData.userid}/init`;
    const postData = new URLSearchParams();

    Object.entries(data).forEach(([key, value]) => {
      postData.append(key, `${value}`);
    });

    return fetch(url, {
      method: "POST",
      body: postData,
    });
  };
}
