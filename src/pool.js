// 列表类型
const LIST_TYPE = {
  WAITING_LIST: 'waitingList',
  PROCESSING_LIST: 'processingList'
};

export class Pool {
  /**
   * 实现一个控制多个任务同时执行的pool。
   * @ignore
   * @param {function} runTask 运行任务
   * @param {Number} limit 允许同时运行的最大任务数量
   */
  constructor(runTask, limit) {
    this._runTask = runTask;
    this._limit = limit;
    this._waitingList = []; // 等待执行的列表
    this._processingList = []; // 执行列表
  }

  /**
   * 获取pool的长度
   * @returns {Number}
   */
  get size() {
    return this._waitingList.length + this._processingList.length;
  }

  /**
   * 将任务添加到等待列表的末尾，并检查是否可以立刻执行
   * @param {Object} task 执行任务的主体
   * @return {Promise}
   */
  enqueue(task) {
    return new Promise((resolve, reject) => {
      this._waitingList.push({
        id: task.id,
        task,
        resolve,
        reject
      });
      task.addRejectListener(reject);
      task.addResolveListener(resolve);
      this._check();
    });
  }

  /**
   * 任务出列
   * @return {Object}
   */
  dequeue() {
    if (this._processingList.length > 0) {
      return this._processingList.shift().task;
    }
    return this._waitingList.shift().task;
  }

  /**
   * 移除指定任务
   * @param {String} id 任务的唯一标识
   * @returns {Object}
   */
  remove(id) {
    let chosenItem = this._processingListRemove(id);
    if (!chosenItem) {
      chosenItem = this._waitingListRemove(id);
    }
    return chosenItem ? chosenItem.task : null;
  }

  // 从指定列表中移除元素
  _removeItem(id, listType) {
    const isProcessingList = listType === LIST_TYPE.PROCESSING_LIST;
    const list = isProcessingList ? this._processingList : this._waitingList;

    let chosenIndex = -1;
    let chosenItem = null;
    const queueLen = list.length;
    for (let i = 0; i < queueLen; i++) {
      if (id === list[i].id) {
        chosenIndex = i;
        break;
      }
    }
    if (chosenIndex > -1) {
      chosenItem = list.splice(chosenIndex, 1)[0];

      // 如果是执行列表，移除后需要检查是否可以执行下一个任务
      if (isProcessingList) {
        this._check();
      }
    }
    return chosenItem;
  }

  // 从等待列表中移除元素
  _waitingListRemove(id) {
    return this._removeItem(id, LIST_TYPE.WAITING_LIST);
  }

  // 从执行列表中移除元素
  _processingListRemove(id) {
    return this._removeItem(id, LIST_TYPE.PROCESSING_LIST);
  }

  // 执行任务
  _run(item) {
    this._runTask(item.task)
      .then((data) => {
        this._processingListRemove(item.id);
        item.resolve(data);
      })
      .catch((err) => item.reject(err))
      .finally(() => {
        this._check();
      });
  }

  // 检查是否还有下一个任务可以执行
  _check() {
    const processingNum = this._processingList.length;
    const availableNum = this._limit - processingNum;

    // 如果上传队列还有剩余位置，将任务从等待队列出列到上传队列
    this._waitingList.slice(0, availableNum).forEach((item) => {
      this._waitingListRemove(item.id);
      this._processingList.push(item);
      this._run(item);
    });
  }
}
