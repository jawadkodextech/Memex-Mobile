import { generateSecureRandom } from 'react-native-securerandom'
import { COLLECTION_NAMES as PAGES_COLLECTION_NAMES } from '@worldbrain/memex-storage/lib/pages/constants'
import StorageManager from '@worldbrain/storex'
import some from 'lodash/some'
import { SharedSyncLog } from '@worldbrain/storex-sync/lib/shared-sync-log'
import { SyncSettingsStore } from '@worldbrain/storex-sync/lib/integration/settings'
import SyncService, {
    SignalTransportFactory,
} from '@worldbrain/memex-common/lib/sync'
import {
    MemexSyncSetting,
    MemexSyncDevicePlatform,
} from '@worldbrain/memex-common/lib/sync/types'
import { TweetNaclSyncEncryption } from '@worldbrain/memex-common/lib/sync/secrets/tweetnacl'
import { StorageOperationEvent } from '@worldbrain/storex-middleware-change-watcher/lib/types'
import { AuthService } from '@worldbrain/memex-common/lib/authentication/types'
const WebRTC = require('react-native-webrtc')
const Peer = require('simple-peer')

import { LocalStorageService } from '../local-storage'
import {
    MemexClientSyncLogStorage,
    MemexSyncInfoStorage,
} from 'src/features/sync/storage'
import { PRODUCT_VERSION } from 'src/constants'
import { AUTO_SYNC_TIMEOUT, AUTO_SYNC_COLLECTIONS } from './constants'
import { ErrorTracker } from '../error-tracking/types'

export default class AppSyncService extends SyncService {
    static DEF_CONTINUOUS_SYNC_BATCH_SIZE = 15

    autoSyncTimeout: ReturnType<typeof setTimeout> | null = null

    constructor(options: {
        auth: AuthService
        storageManager: StorageManager
        signalTransportFactory: SignalTransportFactory
        localStorage: LocalStorageService
        clientSyncLog: MemexClientSyncLogStorage
        syncInfoStorage: MemexSyncInfoStorage
        devicePlatform: MemexSyncDevicePlatform
        getSharedSyncLog: () => Promise<SharedSyncLog>
        errorTracker: ErrorTracker
        disableEncryption?: boolean
        continuousSyncBatchSize?: number
    }) {
        super({
            ...options,
            settingStore: new MemexSyncSettingStore(options),
            productType: 'app',
            productVersion: PRODUCT_VERSION,
            disableEncryption: !!options.disableEncryption,
            syncEncryption: options.disableEncryption
                ? undefined
                : new TweetNaclSyncEncryption({
                      randomBytes: (n) => generateSecureRandom(n),
                  }),
        })

        this.initialSync.wrtc = WebRTC
        this.initialSync.processCreationConstraintError = (error) => {
            options.errorTracker.track(error)
        }
        this.initialSync.getPeer = async ({ initiator }) => {
            const params =
                options.devicePlatform !== 'integration-tests'
                    ? {
                          id: (await generateSecureRandom(8)).toString(),
                          channelName: (
                              await generateSecureRandom(40)
                          ).toString(),
                      }
                    : {}

            return new Peer({
                initiator,
                wrtc: this.initialSync.wrtc,
                reconnectTimer: 1000,
                ...params,
            })
        }

        this.executeReconciliationOperation = async (
            name: string,
            ...args: any[]
        ) => {
            // If incoming create op is for pages and `page.fullUrl` is missing,
            //  fill it in with `page.url`
            if (
                name === 'createObject' &&
                args[0] === PAGES_COLLECTION_NAMES.page &&
                args[1].fullUrl == null &&
                args[1].url != null
            ) {
                args[1].fullUrl = args[1].url
            }

            return super.executeReconciliationOperation
                ? super.executeReconciliationOperation(name, ...args)
                : options.storageManager.backend.operation(name, ...args)
        }
    }

    handleStorageChange({ info }: StorageOperationEvent<'post'>) {
        if (
            !some(
                info.changes,
                (change) => AUTO_SYNC_COLLECTIONS[change.collection],
            )
        ) {
            return
        }

        this._scheduleAutoSync()
    }

    _scheduleAutoSync() {
        if (this.autoSyncTimeout) {
            clearTimeout(this.autoSyncTimeout)
        }

        this.autoSyncTimeout = setTimeout(async () => {
            this.autoSyncTimeout = null

            if (this.continuousSync.runningSync) {
                return this._scheduleAutoSync()
            }

            await this.continuousSync.forceIncrementalSync()
        }, AUTO_SYNC_TIMEOUT)
    }
}

class MemexSyncSettingStore implements SyncSettingsStore {
    constructor(private options: { localStorage: LocalStorageService }) {}

    async retrieveSetting(key: MemexSyncSetting) {
        return this.options.localStorage.get(key)
    }
    async storeSetting(
        key: MemexSyncSetting,
        value: boolean | number | string | null,
    ) {
        await this.options.localStorage.set(key, value)
    }
}
