globalThis.process.version = '1.1.1'

import 'react-native-gesture-handler'
import { Platform } from 'react-native'
import * as Sentry from '@sentry/react-native'
import { normalizeUrl } from '@worldbrain/memex-url-utils'
import { MemexSyncDevicePlatform } from '@worldbrain/memex-common/lib/sync/types'
import FirestorePersonalCloudBackend from '@worldbrain/memex-common/lib/personal-cloud/backend/firestore'
import type { PersonalCloudService } from '@worldbrain/memex-common/lib/personal-cloud/backend/types'
import { authChanges } from '@worldbrain/memex-common/lib/authentication/utils'
import { getCurrentSchemaVersion } from '@worldbrain/memex-common/lib/storage/utils'
import { firebaseService } from '@worldbrain/memex-common/lib/firebase-backend/services/client'
import {
    PersonalDeviceType,
    PersonalDeviceOs,
    PersonalDeviceProduct,
} from '@worldbrain/memex-common/lib/personal-cloud/storage/types'

import './polyfills'
import { sentryDsn, storageKeys } from '../app.json'
import { getFirebase, connectToEmulator } from 'src/firebase'
import {
    createStorage,
    setStorageMiddleware,
    createServerStorage,
} from './storage'
import { createServices } from './services'
import {
    setupBackgroundSync,
    setupFirebaseAuth,
    setupContinuousSync,
} from './services/setup'
import { UI } from './ui'
import { createFirebaseSignalTransport } from './services/sync/signalling'
import { ErrorTrackingService } from './services/error-tracking'
import SyncService from './services/sync'
import { MemexGoAuthService } from './services/auth'
import { MockSentry } from './services/error-tracking/index.tests'
import { KeychainPackage } from './services/keychain/keychain'
import { migrateSettings } from 'src/utils/migrate-settings-for-cloud'
import { createSelfTests } from 'src/tests/self-tests'

if (!process.nextTick) {
    process.nextTick = setImmediate
}

export async function main() {
    const ui = new UI()

    const sentry = __DEV__ ? (new MockSentry() as any) : Sentry
    const errorTracker = new ErrorTrackingService(sentry, { dsn: sentryDsn })

    if (process.env['USE_FIREBASE_EMULATOR']) {
        await connectToEmulator()
    }
    const firebase = getFirebase()

    const authService = new MemexGoAuthService(firebase as any)
    const serverStorage = await createServerStorage(firebase)
    const storage = await createStorage({
        authService,
        typeORMConnectionOpts: {
            type: 'react-native',
            location: 'Shared',
            database: 'memex',
        },
        createPersonalCloudBackend: (
            storageManager,
            { localSettings },
            getDeviceId,
        ) =>
            new FirestorePersonalCloudBackend({
                personalCloudService: firebaseService<PersonalCloudService>(
                    'personalCloud',
                    async (name, ...args) => {
                        const callable = firebase
                            .functions()
                            .httpsCallable(name)
                        const result = await callable(...args)
                        return result.data
                    },
                ),
                getCurrentSchemaVersion: () =>
                    getCurrentSchemaVersion(storageManager),
                userChanges: () => authChanges(authService),
                getUserChangesReference: async () => {
                    const currentUser = await authService.getCurrentUser()
                    if (!currentUser) {
                        return null
                    }
                    const firestore = firebase.firestore()
                    return firestore
                        .collection('personalDataChange')
                        .doc(currentUser.id)
                        .collection('objects') as any
                },
                getLastUpdateSeenTime: () =>
                    localSettings.getSetting({
                        key: storageKeys.lastSeenUpdateTime,
                    }),
                setLastUpdateSeenTime: (value) =>
                    localSettings.setSetting({
                        key: storageKeys.lastSeenUpdateTime,
                        value,
                    }),
                getDeviceId,
            }),
        createDeviceId: async (userId) => {
            const device = await serverStorage.modules.personalCloud.createDeviceInfo(
                {
                    device: {
                        os:
                            Platform.OS === 'android'
                                ? PersonalDeviceOs.Android
                                : PersonalDeviceOs.IOS,
                        type: PersonalDeviceType.Mobile,
                        product: PersonalDeviceProduct.MobileApp,
                        browser: 'NULL', // TODO: Remove this once staging is updated
                    },
                    userId,
                },
            )
            return device.id
        },
    })

    const coreServices = await createServices({
        keychain: new KeychainPackage({ server: 'worldbrain.io' }),
        storageModules: storage.modules,
        auth: authService,
        normalizeUrl,
        errorTracker,
        firebase,
    })

    const syncService = new SyncService({
        devicePlatform: Platform.OS as MemexSyncDevicePlatform,
        signalTransportFactory: createFirebaseSignalTransport,
        storageManager: storage.manager,
        clientSyncLog: storage.modules.clientSyncLog,
        syncInfoStorage: storage.modules.syncInfo,
        getSharedSyncLog: async () => serverStorage.modules.sharedSyncLog,
        errorTracker,
        localStorage: coreServices.localStorage,
        auth: coreServices.auth,
    })

    const services = {
        ...coreServices,
        sync: syncService,
    }

    const dependencies = { storage, services }

    await setStorageMiddleware(dependencies)
    await setupBackgroundSync(dependencies)
    await setupFirebaseAuth(dependencies)
    await setupContinuousSync(dependencies)

    await storage.modules.personalCloud.setup()

    await migrateSettings(services)

    ui.initialize({ dependencies })
    const selfTests = createSelfTests({
        storageManager: storage.manager,
        storageModules: storage.modules,
        services,
        getServerStorageManager: async () => serverStorage.manager,
    })

    // await selfTests.ensureTestUser()
    // await authService.signOut()
    Object.assign(globalThis, {
        ...dependencies,
        selfTests,
    })
}
