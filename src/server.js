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
import { buildAgentCard, buildOpenApiSpec, buildManifest, buildInstructionsMarkdown, getHomepagePrompts } from './protocol.js';
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
import { solanaConfig, getPublicChainConfig } from './blockchain/config.js';
import { WalletAuthService } from './blockchain/wallet-auth.js';
import { TreasuryService } from './blockchain/treasury.js';
import { createLandAssetProvider } from './blockchain/nft-service.js';
import { OwnershipSyncService } from './blockchain/ownership-sync.js';
import { GridRegistry as GridRegistryService } from './land/grid-registry.js';
import { GridPurchaseService } from './land/grid-purchase.js';
import { EvidenceService, HypothesisService, RumorRepository } from './epistemics/index.js';
import { ResearchTelemetryService } from './research-telemetry.js';
import { settleAbandonedAttempts } from './domain/shrine/attempts.js';

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
const Evidence = new EvidenceService({ db, eventLedger });
const Hypotheses = new HypothesisService({ db, eventLedger });
constќ[[ЬњИH™]Иќ[[Ь”™\ЬЪ]ЬћJИ€JNВЫЫњЭ™\ЩX\Ъ[[Y]ћHH™]И™\ЩX\Ъ[[Y]ћTЩ\ќљXЩJИ€JNВ‚ЫЫњЭЩ\ќљXЩ\ИHВ€‹€ЫЭYЭЬYЩK€]]Щ\ќљXЩK€XZ[\‹€ЬЫњЫЬ‘ЫXZ[ђ[ЭЩY€ЫXZ[њР[ЭЩY€ЫЬ›€›Ш\™Щ\ќљXЩK€XЫЫ›Ы^SX[YЩ\‹€™\ЪY[ќX[YЩ\‹€\Ф™]\™Y™\ЪY[ќ€‘UT‘QФ‘TТQS•ФФS€›Ъ™XЭX[YЩ\‹€ТSQWУР’‘PХТQ€]™[ќYЩ\‹€ЫШЪX[Ю\Э[K€XZ[›ЮЩ\ќљXЩK€ќZ[YЩ[ќШ\™€ќZ[Ь[ђ\TЬXЛ€ќZ[X[љY™\Э€ќZ[[њЭќXЭ[ЫњУX\љЩЭЫ‹€Щ]ЫY\YЩT›Ы\Л€\™UЩP[Ы™T]Y\Э€љ\њЭ›[YT]Y\Э€ЫЫ[PЫЫ™љYЛ€Щ]X›XРЪZ[ђЫЫ™љYЛ€Ш[]]]€™X\Э\ћK€[™\ЬЩ]›ЭљY\‹€ЭЫ™\њЪ\Ю[Л€ЬљY™YЪ\ЭћK€ЬљY\Ъ\ЩK€]љY[ЩK€\Э\Щ\Л€ќ[[ЬњЛ€™\ЩX\Ъ[[Y]ћBџNВ‚ЫЫњЭ[Z]ИHИЪXЪФ]S[Z]ЪXЪСЭY\ЭЬ™X][Ы“[Z]ЪXЪХЪ\Ь\“[Z]NВЫЫњЭY™XЮXЫHHЬ™X]SY™XЮXЫJИЫЬ›™\ЪY[ќX[YЩ\€JNВЫЫњЭ™\]Y\Э[™\€HЬ™X]T™\]Y\Э[™\ЉИЩ\ќљXЩ\Лќ[ќ[YN€Y™XЮXЫK[Z]ЛX›XС\Ћ€P“PЧСT€JNВЫЫњЭЩ\ќ™\€HЬ™X]TЩ\ќ™\Љ™\]Y\Э[™\ЉNВЫЫњЭ™X[[YQШ]]Ш^HH]XЪЫЬ›ЩX”ЫШЪЩ]
ИЩ\ќ™\‹ЫЬ›‹Y™XЮXЫHJNВ›Y™XЮXЫKњЩ]™X[[YQШ]]Ш^J™X[[YQШ]]Ш^JNВ‚њ›ШЩ\ЬЛ›ЫЉ	Э[Ш]YЪ^Щ\[Ы‰Л\њ€O€В€ЫЫњЫЫK™\њ›ЬЉ	ЦФЩ\ќ™\€[Ш]YЪ^Щ\[Ы—IЛ\њЉNВџJNВ‚њ›ШЩ\ЬЛ›ЫЉ	Э[љ[™Y™Z™XЭ[Ы‰Л™X\ЫЫ€O€В€ЫЫњЫЫK™\њ›ЬЉ	ЦФЩ\ќ™\€[љ[™Y™Z™XЭ[Ы—IЛ™X\ЫЫЉNВџJNВ‚љY€
ЫЭYЭЬYЩKљ\С[X›Y

JHВ€]ШZ]ЫЭYЭЬYЩKњ™\ЭЬ™Qњ›ЫPЫЭY

NВ‚€Щ][ќ\ќ[


HO€В€ЫЭYЭЬYЩKњ\ЪРЫЭY

KШ]Ъ
\њ€O€ЫЫњЫЫK™\њ›ЬЉ	ЦС]X\ЩNђЫЭYH\љ[ЩXИ\Ъ\њ›ЬЋ‰Л\њ‹›Y\ЬШYЩJJNВ€KЊ
€L
NВ‚€›ШЩ\ЬЛ›ЫЉ	ФТQТS•	Л\Ю[И

HO€В€ЫЫњЫЫK›ЩК	ЦС]X\ЩNђЫЭYHТQТS•™XЩZ]™Y\Ъ[™Иљ[[Э]HИ\њЫЛ‹‹‰КNВ€]ШZ]ЫЭYЭЬYЩKњ\ЪРЫЭY

NВ€›ШЩ\ЬЛ™^]

NВ€JNВ€›ШЩ\ЬЛ›ЫЉ	ФТQХT“IЛ\Ю[И

HO€В€ЫЫњЫЫK›ЩК	ЦС]X\ЩNђЫЭYHТQХT“H™XЩZ]™Y\Ъ[™Иљ[[Э]HИ\њЫЛ‹‹‰КNВ€]ШZ]ЫЭYЭЬYЩKњ\ЪРЫЭY

NВ€›ШЩ\ЬЛ™^]

NВ€JNВџB‚‘ЬљY™YЪ\ЭћKњЩYY[љ]X[™YЪ[ЫЉ
NВ‘ЬљY\Ъ\ЩKњ™XЫЭ™\”ЭXЪК
KШ]Ъ
\њ€O€ЫЫњЫЫK™\њ›ЬЉ	ЦУ[™”™XЫЭ™\ћWHЭ\ќ\™XЫЫЪ[X][Ы€Z[Y‰Л\њ‹›Y\ЬШYЩJJNВњЩ][ќ\ќ[


HO€В€ЬљY\Ъ\ЩKњ™XЫЭ™\”ЭXЪК
KШ]Ъ
\њ€O€ЫЫњЫЫK™\њ›ЬЉ	ЦУ[™”™XЫЭ™\ћWH\љ[ЩXИ™XЫЫЪ[X][Ы€Z[Y‰Л\њ‹›Y\ЬШYЩJJNВџKH
€Њ
€L
Kќ[њ™YЉ
NВњЩ][ќ\ќ[


HO€Ш[]]]њќ[™Q^\™YЪ[[™Щ\К
KL
€Њ
€L
Kќ[њ™YЉ
NВ‚ЫЫњЭЪљ[™PX[™Ы›Y[ќYЩS\ИHќ[X™\Љ›ШЩ\ЬЛ™[ќ‹”Т’S‘WРPђS‘У‘QРQ•T—УTКHЌ
€Њ
€Њ
€LВ\Ю[Иќ[Э[Ы€Щ]PX[™Ы™YЪљ[™P][\К
HВ€ЫЫњЭ™\Э[HЩ]PX[™Ы™Y][\КИX^YЩS\О€Ъљ[™PX[™Ы›Y[ќYЩS\ИJNВ€Y€
™\Э[њЩ]Y€
HВ€ЫЫњЫЫK›ЩКФЪљ[™WHЩ]Y	Ь™\Э[њЩ]YHX[™Ы™Y][\
КH\И[ќ\њќ\Y
NВ€Y€
ЫЭYЭЬYЩKљ\С[X›Y

JH]ШZ]ЫЭYЭЬYЩKњ\ЪРЫЭY

NВ€BџBњЩ]PX[™Ы™YЪљ[™P][\К
KШ]Ъ
\њ€O€ЫЫњЫЫK™\њ›ЬЉ	ЦФЪљ[™WHX[™Ы™YX][\Щ][Y[ќZ[Y‰Л\њ‹›Y\ЬШYЩJJNВњЩ][ќ\ќ[


HO€В€Щ]PX[™Ы™YЪљ[™P][\К
KШ]Ъ
\њ€O€ЫЫњЫЫK™\њ›ЬЉ	ЦФЪљ[™WH\љ[ЩXИX[™Ы™YX][\Щ][Y[ќZ[Y‰Л\њ‹›Y\ЬШYЩJJNВџKH
€Њ
€L
Kќ[њ™YЉ
NВ‚ђ]]Щ\ќљXЩKњ\™ЩP[ЭY\ЭК
NВњЩ][ќ\ќ[


HO€XZ[›ЮЩ\ќљXЩKњќ[™Q^\™Y

KL
€Њ
€L
Kќ[њ™YЉ
NВ‚”›Ъ™XЭX[YЩ\‹љ[љ]

NВњ™\ЪY[ќX[YЩ\‹љ[љ]
ЫЬ›
NВ™]™[ќYЩ\‹љ[љ]
]ќO€ЫЬ›њ›ШYШ\Э
]ќ
JNВ‚›Y™XЮXЫKњЭ\ќ

NВ‚љY€
ЫЫ[PЫЫ™љYЛ›™]ЫЬљИOOH	Щ]›™]	КHВ€ЫЫњЫЫK›ЩК	ь'жЄФУУSђWH‘UУФ’ИH	И
ИЫЫ[PЫЫ™љYЛ›™]ЫЬљЛќХ\\ђШ\ЩJ
H
И	И
“ХU“‘U
K€‘PSQ•S‘И’TТИPХU‘K‰КNВ€ЫЫњЫЫK›ЩК	ь'жЄФУУSђWHЫЫ™љ\›HУУSђWХ‘PTХT–WРQ‘TФИ\ИHP“PИЫЫФ[ќЫKЫ][\ЪYИY™\ЬИ
›ИЩ\ќ™\€Щ^JK‰КNВ€ЫЫњЫЫK›ЩК	ь'жЄФУУSђWHЫЫ™љ\›HУУSђWУ‘•ТTФХQT—ФСPФ‘U\ИHQPРUQќ[™Y•T“‘T€
Ш\ИЫ›HЊЊё $МЊHУУЫZ[ќ
K™]™\€H\њЫЫ[Ш[]‰КNВ€ЫЫњЫЫK›ЩК	ь'жЄФУУSђWHЫЫ™љ\›HУУSђWУS‘РУУPХSУ—РQ‘TФИ\ИHЫЫXЭ[Ы€Ь™X]YЫ€	И
ИЫЫ[PЫЫ™љYЛ›™]ЫЬљИ
И	И
›ЭH]›™]ЫЫXЭ[ЫЉK‰КNВџB‚њЩ\ќ™\‹›\Э[ЉФ•

HO€В€ЫЫњЫЫK›ЩК	Ч‰И
И	ПIЛњ™\X]
Ћ
JNВ€ЫЫњЫЫK›ЩК<'г.X\Э\›€\Y\ЩHЩ\ќ™\€ќ[›љ[™ИЫ€‹ЛЫШШ[ЬЭ‰ФФ•X
NВ€ЫЫњЫЫK›ЩК<'дзYЩ[ќ[њЭќXЭ[ЫњИ]Z[X›H]€‹ЛЫШШ[ЬЭ‰ФФ•KЪ[њЭќXЭ[ЫњШ
NВ€ЫЫњЫЫK›ЩК<'д`{о#И]™H[X[€ЬXЭ]Ь€RH]€‹ЛЫШШ[ЬЭ‰ФФ•X
NВ€ЫЫњЫЫK›ЩК8¦ЁHYK\ЫY\XЭ]™N€XЪЬИ]\ЩHЪ[€љ\Ъ]ЬњЛЬЬXЭ]ЬњИ›Ь€МШ
NВ€Y€
ЫЭYЭЬYЩKљ\С[X›Y

JHВ€ЫЫњЫЫK›ЩК8¦ {о#ИЫЭY\њЪ\Э[ЩN€PХU‘HљXH\њЫИX”ФS
NВ€H[ЩHВ€ЫЫњЫЫK›ЩК<'дЇ€ШШ[ФS]N€]KЬ\Y\ЩK™€
Щ]T”УЧСUPђTСWХT“И\њЪ\Э[€ЫЭY
X
NВ€B€ЫЫњЫЫK›ЩК	ПIЛњ™\X]
Ћ
H
И	Ч‰КNВџJNВ