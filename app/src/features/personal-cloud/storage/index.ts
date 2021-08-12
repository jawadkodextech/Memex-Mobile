import StorageManager from '@worldbrain/storex'
import { getObjectWhereByPk, getObjectByPk } from '@worldbrain/storex/lib/utils'
import ActionQueue from '@worldbrain/memex-common/lib/action-queue'
import { StorageOperationEvent } from '@worldbrain/storex-middleware-change-watcher/lib/types'
import {
    ActionExecutor,
    ActionPreprocessor,
} from '@worldbrain/memex-common/lib/action-queue/types'
import { preprocessPulledObject } from '@worldbrain/memex-common/lib/personal-cloud/utils'
import { AsyncMutex } from '@worldbrain/memex-common/lib/utils/async-mutex'
import { STORAGE_VERSIONS } from '@worldbrain/memex-common/lib/browser-extension/storage/versions'
import {
    PersonalCloudBackend,
    PersonalCloudUpdateType,
    PersonalCloudUpdateBatch,
    PersonalCloudClientStorageType,
} from '@worldbrain/memex-common/lib/personal-cloud/backend/types'
import { getCurrentSchemaVersion } from '@worldbrain/memex-common/lib/storage/utils'

import {
    PersonalCloudAction,
    PersonalCloudActionType,
    UpdateIntegrationResult,
} from './types'
import { PERSONAL_CLOUD_ACTION_RETRY_INTERVAL } from './constants'
import type { AuthenticatedUser } from '@worldbrain/memex-common/lib/authentication/types'

export interface Dependencies {
    backend: PersonalCloudBackend
    storageManager: StorageManager
    getUserId(): Promise<string | number | null>
    userIdChanges(): AsyncIterableIterator<AuthenticatedUser | null>
    createDeviceId(userId: number | string): Promise<string | number>
    getDeviceId(): Promise<string | number>
    setDeviceId(deviceId: string | number): Promise<void>
    writeIncomingData(params: {
        storageType: PersonalCloudClientStorageType
        collection: string
        where?: { [key: string]: any }
        updates: { [key: string]: any }
    }): Promise<void>
}

export class PersonalCloudStorage {
    currentSchemaVersion?: Date
    actionQueue: ActionQueue<PersonalCloudAction>
    pushMutex = new AsyncMutex()
    pullMutex = new AsyncMutex()
    deviceId?: string | number

    constructor(private dependencies: Dependencies) {
        this.actionQueue = new ActionQueue({
            storageManager: dependencies.storageManager,
            collectionName: 'personalCloudAction',
            versions: { initial: STORAGE_VERSIONS[25].version },
            retryIntervalInMs: PERSONAL_CLOUD_ACTION_RETRY_INTERVAL,
            executeAction: this.executeAction,
            preprocessAction: this.preprocessAction,
        })
    }

    async setup() {
        this.currentSchemaVersion = getCurrentSchemaVersion(
            this.dependencies.storageManager,
        )
        await this.actionQueue.setup({ paused: true })
        await this.loadDeviceId()
    }

    async observeAuthChanges() {
        for await (const _ of this.dependencies.userIdChanges()) {
            await this.loadDeviceId()
        }
    }

    async loadDeviceId() {
        const userId = await this.dependencies.getUserId()
        if (userId) {
            this.deviceId = await this.dependencies.getDeviceId()
            if (!this.deviceId) {
                this.deviceId = await this.dependencies.createDeviceId(userId)
                await this.dependencies.setDeviceId(this.deviceId!)
            }
            this.actionQueue.unpause()
        } else {
            this.actionQueue.pause()
            delete this.deviceId
        }
    }

    async integrateContinuously(): Promise<UpdateIntegrationResult> {
        let updatesIntegratedCount = 0

        for await (const updates of this.dependencies.backend.streamUpdates()) {
            const { updatesIntegrated } = await this.integrateUpdates(updates)
            updatesIntegratedCount += updatesIntegrated
        }

        return { updatesIntegrated: updatesIntegratedCount }
    }

    async integrateAllUpdates(): Promise<UpdateIntegrationResult> {
        const updateBatch = await this.dependencies.backend.bulkDownloadUpdates()
        return this.integrateUpdates(updateBatch)
    }

    private async integrateUpdates(
        updates: PersonalCloudUpdateBatch,
    ): Promise<UpdateIntegrationResult> {
        const { releaseMutex } = await this.pullMutex.lock()
        const { storageManager } = this.dependencies
        let updatesIntegrated = 0

        for (const update of updates) {
            if (update.type === PersonalCloudUpdateType.Overwrite) {
                const object = update.object
                preprocessPulledObject({
                    storageRegistry: storageManager.registry,
                    collection: update.collection,
                    object,
                })
                if (update.media) {
                    await Promise.all(
                        Object.entries(update.media).map(
                            async ([key, path]) => {
                                object[
                                    key
                                ] = await this.dependencies.backend.downloadFromMedia(
                                    { path: path.path },
                                )
                            },
                        ),
                    )
                }

                await this.dependencies.writeIncomingData({
                    storageType:
                        update.storage ?? PersonalCloudClientStorageType.Normal,
                    collection: update.collection,
                    updates: update.object,
                    where: update.where,
                })
                updatesIntegrated++
            } else if (update.type === PersonalCloudUpdateType.Delete) {
                await storageManager.backend.operation(
                    'deleteObjects',
                    update.collection,
                    update.where,
                )
                updatesIntegrated++
            }
        }

        releaseMutex()
        return { updatesIntegrated }
    }

    executeAction: ActionExecutor<PersonalCloudAction> = async ({ action }) => {
        if (!this.deviceId) {
            return { pauseAndRetry: true }
        }

        if (action.type === PersonalCloudActionType.PushObject) {
            await this.dependencies.backend.pushUpdates(
                action.updates.map((update) => ({
                    ...update,
                    deviceId: update.deviceId ?? this.deviceId,
                })),
            )
            // Currently unsupported:
            // await this.actionQueue.scheduleAction(
            //     {
            //         type: PersonalCloudActionType.ExecuteClientInstructions,
            //         clientInstructions,
            //     },
            //     { queueInteraction: 'queue-and-return' },
            // )
        } else if (
            action.type === PersonalCloudActionType.ExecuteClientInstructions
        ) {
            // Currently unsupported
        }
    }

    async handlePostStorageChange(event: StorageOperationEvent<'post'>) {
        if (!this.deviceId) {
            return
        }

        const { releaseMutex } = await this.pushMutex.lock()

        for (const change of event.info.changes) {
            if (change.type === 'create') {
                const object = await getObjectByPk(
                    this.dependencies.storageManager,
                    change.collection,
                    change.pk,
                )
                if (!object) {
                    // Here we assume the object is already deleted again before
                    // we got the change to look at it, so just ignore the create
                    continue
                }
                await this.actionQueue.scheduleAction(
                    {
                        type: PersonalCloudActionType.PushObject,
                        updates: [
                            {
                                type: PersonalCloudUpdateType.Overwrite,
                                schemaVersion: this.currentSchemaVersion!,
                                deviceId: this.deviceId!,
                                collection: change.collection,
                                object,
                            },
                        ],
                    },
                    { queueInteraction: 'queue-and-return' },
                )
            } else if (change.type === 'modify') {
                const objects = await Promise.all(
                    change.pks.map((pk) =>
                        getObjectByPk(
                            this.dependencies.storageManager,
                            change.collection,
                            pk,
                        ),
                    ),
                )
                await this.actionQueue.scheduleAction(
                    {
                        type: PersonalCloudActionType.PushObject,
                        updates: objects
                            .filter((object) => !!object)
                            .map((object) => ({
                                type: PersonalCloudUpdateType.Overwrite,
                                schemaVersion: this.currentSchemaVersion!,
                                deviceId: this.deviceId!,
                                collection: change.collection,
                                object,
                            })),
                    },
                    { queueInteraction: 'queue-and-return' },
                )
            } else if (change.type === 'delete') {
                const wheres = await Promise.all(
                    change.pks.map((pk) =>
                        getObjectWhereByPk(
                            this.dependencies.storageManager.registry,
                            change.collection,
                            pk,
                        ),
                    ),
                )
                await this.actionQueue.scheduleAction(
                    {
                        type: PersonalCloudActionType.PushObject,
                        updates: wheres.map((where) => ({
                            type: PersonalCloudUpdateType.Delete,
                            schemaVersion: this.currentSchemaVersion!,
                            deviceId: this.deviceId!,
                            collection: change.collection,
                            where,
                        })),
                    },
                    { queueInteraction: 'queue-and-return' },
                )
            }
        }

        releaseMutex()
    }

    preprocessAction: ActionPreprocessor<PersonalCloudAction> = () => {
        return { valid: true }
    }
}
