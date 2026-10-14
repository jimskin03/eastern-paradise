import { wipeNonAiliciaLogs } from './maintenance.js';
import { pushToCloud } from './push.js';
import { restoreFromCloud } from './restore.js';

export function createCloudStorage({ db, cloudClient }) {
  let pushQueue = Promise.resolve();
  return {
    isEnabled() {
      return cloudClient !== null;
    },

    async restoreFromCloud() {
      return restoreFromCloud({ db, cloudClient });
    },

    pushToCloud() {
      // Serialize periodic and durable flushes without sharing an older flush
      // that may not include a newly committed mutation.
      const push = pushQueue.then(() => pushToCloud({ db, cloudClient }));
      pushQueue = push.catch(() => {});
      return push;
    },

    async wipeNonAiliciaLogs() {
      return wipeNonAiliciaLogs({ db, cloudClient });
    }
  };
}
