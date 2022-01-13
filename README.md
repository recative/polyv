# POLYV SDK for Node.js

This is a refactored SDK with TypeScript that removes all fancy features and
keeps only the basic upload functionality.

If you need the queue functionality, please use the [`queue-promise`](https://www.npmjs.com/package/queue-promise) package.

## Example

```
import { readFile } from 'fs/promises';

import md5 from 'md5';
import PlvNodeVideoUpload from '@recative/polyv';

const main = async () => {
  const userId = '__YOUR_USER_ID__';
  const now = Date.now();
  const sign = md5(`${this.config.secretKey}${now}`);
  const userData = {
    userid: userId,
    ptime: now,
    sign,
    hash: md5(`${now}${this.config.writeToken}`),
  };

  const polyV = new PlvVideoUpload();
  await polyV.updateUserData(userData);

  const file = await polyV.upload(
    Buffer.from(await fs.readFile('__YOUR_FILE_PATH__')),
    '__YOUR_FILE_NAME__',
    '__YOUR_FILE_MIME__',
  );
}

```
