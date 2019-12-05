import React from 'react'
import QRCodeScanner, {
    Event as QRReadEvent,
} from 'react-native-qrcode-scanner'

import MainLayout from 'src/ui/layouts/main'
import E2EEMessage from './e2ee-msg'
import styles from './sync-scan-qr-stage.styles'
import ManualSyncInput, {
    Props as ManualSyncInputProps,
} from './manual-sync-input'

export interface Props extends ManualSyncInputProps {
    onSkipBtnPress: () => void
    onQRRead: (e: QRReadEvent) => void
    debug?: boolean
}

const SyncScanQRStage: React.StatelessComponent<Props> = props => (
    <MainLayout
        titleText="Step 2"
        subtitleText="Scan the QR code displayed in your Memex"
        onBtnPress={props.onSkipBtnPress}
        btnText="Skip"
    >
        <QRCodeScanner
            cameraStyle={styles.cameraView as any}
            containerStyle={styles.cameraViewContainer as any}
            onRead={props.onQRRead}
        />
        <E2EEMessage
            onPress={props.onQRRead as any} // TODO: Remove this; just offers a way for simulator to do a fake sync as camera isn't available
        />
        {props.debug && <ManualSyncInput {...props} />}
    </MainLayout>
)

export default SyncScanQRStage
