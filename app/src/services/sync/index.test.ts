import { makeMultiDeviceTestFactory } from 'src/index.tests'
import {
    insertIntegrationTestData,
    checkIntegrationTestData,
} from 'src/tests/shared-fixtures/integration'

describe('SyncService', () => {
    const it = makeMultiDeviceTestFactory()

    it('should be able to do an initial sync', async ({ createDevice }) => {
        const devices = [await createDevice(), await createDevice()]

        await insertIntegrationTestData(devices[0])

        const {
            initialMessage,
        } = await devices[0].services.sync.initialSync.requestInitialSync()
        await devices[1].services.sync.initialSync.answerInitialSync({
            initialMessage,
        })
        await Promise.all(
            devices.map(device =>
                device.services.sync.initialSync.waitForInitialSync(),
            ),
        )

        await checkIntegrationTestData(devices[1])
    })

    it('should be able to do an incremental sync', async ({ createDevice }) => {
        const devices = [await createDevice(), await createDevice()]

        const {
            initialMessage,
        } = await devices[0].services.sync.initialSync.requestInitialSync()
        await devices[1].services.sync.initialSync.answerInitialSync({
            initialMessage,
        })
        await Promise.all(
            devices.map(device =>
                device.services.sync.initialSync.waitForInitialSync(),
            ),
        )

        devices[0].auth.setUser({ id: 666 })
        devices[1].auth.setUser({ id: 666 })

        await devices[0].services.sync.continuousSync.initDevice()
        await devices[1].services.sync.continuousSync.initDevice()

        await devices[0].services.sync.continuousSync.enableContinuousSync()
        await devices[1].services.sync.continuousSync.enableContinuousSync()

        await insertIntegrationTestData(devices[0])
        await devices[0].services.sync.continuousSync.forceIncrementalSync()

        await devices[1].services.sync.continuousSync.forceIncrementalSync()
        await checkIntegrationTestData(devices[1])
    })

    it('should include extra info incremental sync batches', async ({
        createDevice,
    }) => {
        const devices = [await createDevice(), await createDevice()]

        const {
            initialMessage,
        } = await devices[0].services.sync.initialSync.requestInitialSync()
        await devices[1].services.sync.initialSync.answerInitialSync({
            initialMessage,
        })
        await Promise.all(
            devices.map(device =>
                device.services.sync.initialSync.waitForInitialSync(),
            ),
        )

        devices[0].auth.setUser({ id: 666 })
        devices[1].auth.setUser({ id: 666 })

        await devices[0].services.sync.continuousSync.initDevice()
        await devices[1].services.sync.continuousSync.initDevice()

        await devices[0].services.sync.continuousSync.enableContinuousSync()
        await devices[1].services.sync.continuousSync.enableContinuousSync()

        const sentExtraInfo: any[] = []
        const firstContinuousSync = devices[0].services.sync.continuousSync
        const origGetOptions = firstContinuousSync.getSyncOptions.bind(
            firstContinuousSync,
        )
        firstContinuousSync.getSyncOptions = async () => {
            const options = await origGetOptions()
            sentExtraInfo.push(options.extraSentInfo)
            return options
        }

        await insertIntegrationTestData(devices[0])
        await devices[0].services.sync.continuousSync.forceIncrementalSync()

        expect(sentExtraInfo).toEqual([
            {
                pt: 'app',
                pv: expect.stringMatching(/[\d+]\.[\d+]\.[\d+]/),
                sv: expect.any(Number),
            },
        ])
    })
})
