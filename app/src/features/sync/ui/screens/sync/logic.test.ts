const MockAsyncStorage = require('mock-async-storage').default
import { storageKeys } from '../../../../../../app.json'
import { TEST_USER } from '@worldbrain/memex-common/lib/authentication/dev'
import { makeMultiDeviceTestFactory } from 'src/index.tests'
import {
    insertIntegrationTestData,
    checkIntegrationTestData,
} from 'src/tests/shared-fixtures/integration'
import { FakeNavigation } from 'src/tests/navigation'
import { LocalStorageService } from 'src/services/local-storage'
import { TestLogicContainer } from 'src/tests/ui-logic'
import SyncScreenLogic, { SyncScreenDependencies } from './logic'

const multiDeviceTest = makeMultiDeviceTestFactory()

describe('SyncScreen', () => {
    function createMockDependencies() {
        const navigation = new FakeNavigation()
        const localStorage = new LocalStorageService({
            storageAPI: new MockAsyncStorage(),
        })
        return {
            navigation: navigation as any,
            services: {
                localStorage,
                sync: {} as any,
            },
        }
    }

    function setup(
        dependencies?: SyncScreenDependencies & { navigation: FakeNavigation },
    ) {
        dependencies = dependencies || createMockDependencies()
        const logic = new SyncScreenLogic(dependencies)
        const logicContainer = new TestLogicContainer(logic)

        return { logicContainer, ...dependencies }
    }

    multiDeviceTest(
        'should be able to do the whole onboarding flow without skips or errors',
        async ({ createDevice }) => {
            const devices = [await createDevice(), await createDevice()]

            await devices[0].auth.setUser(TEST_USER)
            await insertIntegrationTestData(devices[0])

            const userInterfaces = [
                setup({
                    ...devices[0],
                    navigation: devices[0].navigation as any,
                }),
                setup({
                    ...devices[1],
                    navigation: devices[1].navigation as any,
                }),
            ]

            expect(userInterfaces.map(ui => ui.logicContainer.state)).toEqual([
                { status: 'setup' },
                { status: 'setup' },
            ])

            await userInterfaces[0].logicContainer.processEvent(
                'init',
                undefined,
            )
            await userInterfaces[1].logicContainer.processEvent(
                'init',
                undefined,
            )
            expect(userInterfaces.map(ui => ui.logicContainer.state)).toEqual([
                { status: 'setup' },
                { status: 'setup' },
            ])

            await userInterfaces[1].logicContainer.processEvent(
                'startScanning',
                {},
            )
            expect(userInterfaces[1].logicContainer.state).toEqual({
                status: 'scanning',
            })

            const {
                initialMessage,
            } = await devices[0].services.sync.initialSync.requestInitialSync()
            await userInterfaces[1].logicContainer.processEvent('doSync', {
                qrEvent: { data: initialMessage } as any,
            })
            expect(userInterfaces[1].logicContainer.state).toEqual({
                status: 'success',
            })

            await checkIntegrationTestData(devices[1])
            expect(await devices[1].auth.getCurrentUser()).toEqual(TEST_USER)
        },
    )

    multiDeviceTest(
        'should be switch to the failure state if the sync setup goes wrong',
        async ({ createDevice }) => {
            const devices = [await createDevice()]

            const userInterfaces = [
                setup({
                    ...devices[0],
                    navigation: devices[0].navigation as any,
                }),
            ]

            await userInterfaces[0].logicContainer.processEvent(
                'init',
                undefined,
            )

            await userInterfaces[0].logicContainer.processEvent(
                'startScanning',
                {},
            )
            expect(userInterfaces[0].logicContainer.state).toEqual({
                status: 'scanning',
            })

            devices[0].services.sync.initialSync.answerInitialSync = async () => {
                throw new Error('Muahaha')
            }
            await userInterfaces[0].logicContainer.processEvent('doSync', {
                qrEvent: { data: 'bla' } as any,
            })
            expect(userInterfaces[0].logicContainer.state).toEqual({
                status: 'failure',
            })
        },
    )

    it('should skip the sync onboarding if already synced', async () => {
        const { logicContainer, services, navigation } = setup()
        services.localStorage.set(storageKeys.syncKey, true)
        expect(logicContainer.state).toEqual({
            status: 'setup',
        })

        await logicContainer.processEvent('init', undefined)
        expect(logicContainer.state).toEqual({
            status: 'setup',
        })
        expect(navigation.popRequests()).toEqual([
            {
                type: 'navigate',
                target: 'MVPOverview',
            },
        ])
    })
})
