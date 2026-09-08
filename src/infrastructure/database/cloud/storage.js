import { wipeNonAiliciaLogs } from './maintenance.js';
import { pushToCloud } from './push.js';
import { restoreFromCloud } from './restore.js';

export function createCloudStorage({ db, cloudClient }) {
  return {
    isEnabled() {
      return cloudClient !== null;
    },

    async restoreFromCloud() {
      return restoreFromCloud({ db, cloudClient });
    },

    async pushToCloud() {
      return pushToCloud({ db, cloudClient });
    },

    async wipeNonAiliciaLogs() {
      return wipeNonAiliciaLogs({ db, cloudClient });
    }
  };
}
