import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { db, CloudStorage } from './db.js';
import { AuthService } from './auth.js';
import { Mailer, sponsorDomainAllowed, domainsAllowed } from './mailer.js';
import { world } from './world.js';
import { BoardService } from './board.js';
import { EconomyManager } from './economy.js';
import { residentManager } from './residents.js';
import { isRetiredResident, RETIRED_RESIDENT_SQL } from './resident-policy.js';
import { ProjectManager, CHIME_OBJECT_ID } from './projects.js';
import { eventLedger } from './events.js';
import { SocialSystem } from './social.js';
import { MailboxService } from './mailbox.js';
import { buildOpenApiSpec, buildManifest, buildInstructionsMarkdown, getHomepagePrompts } from './protocol.js';
import { createRequestHandler } from './http/router.js';
import {
  checkRateLimit,
  checkGuestCreationLimit,
  resetGuestCreationLimits,
  checkWhisperLimit,
  resetWhisperLimits
} from './http/middleware/rate-limit.js';
import { sendApiError } from './http/helpers/response.js';
import { attachWorldWebSocket } from './realtime/world-websocket.js';
import { createLifecycle } from './runtime/lifecycle.js';
import { areWeAloneQuest } from './quests/are-we-alone.js';
import { firstFlameQuest } from './quests/first-flame.js';
import { solanaConfig } from './blockchain/config.js';
import { WalletAuthService } from './blockchain/wallet-auth.js';
import { TreasuryService } from './blockchain/treasury.js';
import { createLandAssetProvider } from './blockchain/nft-service.js';
import { OwnershipSyncService } from './blockchain/ownership-sync.js';
import { GridRegistry as GridRegistryService } from './land/grid-registry.js';
import { GridPurchaseService } from './land/grid-purchase.js';

export {
  sendApiError,
  checkGuestCreationLimit,
  resetGuestCreationLimits,
  checkWhisperLimit,
  resetWhisperLimits
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, 'public');
const PORT = process.env.PORT || 3000;

const WalletAuth = new WalletAuthService({ db });
const LandAssetProvider = createLandAssetProvider(solanaConfig);
const GridRegistry = new GridRegistryService({ db, world });
const GridPurchase = new GridPurchaseService({
  db,
  assetProvider: LandAssetProvider,
  metadataBaseUrl: solanaConfig.metadataBaseUrl,
  collectionAddress: solanaConfig.collectionAddress || null
});
const OwnershipSync = new OwnershipSyncService({
  db,
  assetProvider: LandAssetProvider,
  collectionAddress: solanaConfig.collectionAddress || null
});
const Treasury = new TreasuryService({
  config: solanaConfig,
  supplyProvider: () => ({
    ...EconomyManager.getSupplyStats(),
    land: {
      available: db.prepare("SELECT COUNT(*) AS count FROM land_grids WHERE status = 'available'").get()?.count || 0,
      owned: db.prepare("SELECT COUNT(*) AS count FROM land_grids WHERE status = 'owned'").get()?.count || 0
    }
  })
});

const services = {
  db,
  CloudStorage,
  AuthService,
  Mailer,
  sponsorDomainAllowed,
  domainsAllowed,
  world,
  BoardService,
  EconomyManager,
  residentManager,
  isRetiredResident,
  RETIRED_RESIDENT_SQL,
  ProjectManager,
  CHIME_OBJECT_ID,
  eventLedger,
  SocialSystem,
  MailboxService,
  buildOpenApiSpec,
  buildManifest,
  buildInstructionsMarkdown,
  getHomepagePrompts,
  areWeAloneQuest,
  firstFlameQuest,
  solanaConfig,
  WalletAuth,
  Treasury,
  LandAssetProvider,
  OwnershipSync,
  GridRegistry,
  GridPurchase
};

const limits = { checkRateLimit, checkGuestCreationLimit, checkWhisperLimit };
const lifecycle = createLifecycle({ world, residentManager });
const requestHandler = createRequestHandler({ services, runtime: lifecycle, limits, publicDir: PUBLIC_DIR });
const server = http.createServer(requestHandler);
const realtimeGateway = attachWorldWebSocket({ server, world, db, lifecycle });
lifecycle.setRealtimeGateway(realtimeGateway);

process.on('uncaughtException', err => {
  console.error('[Server UncaughtException]', err);
});

process.on('unhandledRejection', reason => {
  console.error('[Server UnhandledRejection]', reason);
});

if (CloudStorage.isEnabled()) {
  await CloudStorage.restoreFromCloud();

  setInterval(() => {
    CloudStorage.pushToCloud().catch(err => console.error('[Database:Cloud] Periodic push error:', err.message));
  }, 60 * 1000);

  process.on('SIGINT', async () => {
    console.log('[Database:Cloud] SIGINT received, pushing final state to Turso...');
    await CloudStorage.pushToCloud();
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    console.log('[Database:Cloud] SIGTERM received, pushing final state to Turso...');
    await CloudStorage.pushToCloud();
    process.exit(0);
  });
}

GridRegistry.seedInitialRegion();
GridPurchase.recoverStuck().catch(err => console.error('[Land:Recovery] Startup reconciliation failed:', err.message));
setInterval(() => {
  GridPurchase.recoverStuck().catch(err => console.error('[Land:Recovery] Periodic reconciliation failed:', err.message));
}, 5 * 60 * 1000).unref();
setInterval(() => WalletAuth.pruneExpiredChallenges(), 10 * 60 * 1000).unref();

AuthService.purgeAllGuests();
setInterval(() => MailboxService.pruneExpired(), 10 * 60 * 1000).unref();

ProjectManager.init();
residentManager.init(world);
eventLedger.init(evt => world.broadcast(evt));

lifecycle.start();

server.listen(PORT, () => {
  console.log('\n' + '='.repeat(68));
  console.log(`🌸 Eastern Paradise Server running on http://localhost:${PORT}`);
  console.log(`📜 Agent instructions available at: http://localhost:${PORT}/instructions`);
  console.log(`👁️ Live human spectator UI at: http://localhost:${PORT}`);
  console.log(`⚡ Idle-sleep active: ticks pause when 0 visitors/spectators for 30s`);
  if (CloudStorage.isEnabled()) {
    console.log(`☁️ Cloud Persistence: ACTIVE via Turso LibSQL`);
  } else {
    console.log(`💾 Local SQLite: data/paradise.db (set TURSO_DATABASE_URL to persist in cloud)`);
  }
  console.log('='.repeat(68) + '\n');
});
