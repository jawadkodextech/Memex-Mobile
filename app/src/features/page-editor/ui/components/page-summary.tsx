import React from 'react'
import {
    View,
    Image,
    TouchableOpacity,
    GestureResponderEvent,
} from 'react-native'

import PageBody, {
    Props as PageBodyProps,
} from 'src/features/page-editor/ui/components/page-body-summary'
import styles from './page-summary.styles'

export interface Props extends PageBodyProps {
    onBackPress: (e: GestureResponderEvent) => void
    onAddPress?: (e: GestureResponderEvent) => void
}

const MainLayout: React.StatelessComponent<Props> = props => (
    <View style={styles.container}>
        <TouchableOpacity onPress={props.onBackPress}>
            <Image
                style={styles.backIcon}
                source={require('src/ui/img/arrow-back.png')}
            />
        </TouchableOpacity>
        <View style={styles.pageBodyContainer}>
            <PageBody {...props} />
        </View>
        {props.onAddPress && (
            <TouchableOpacity onPress={props.onAddPress}>
                <Image
                    style={styles.backIcon}
                    source={require('src/ui/img/plus.png')}
                />
            </TouchableOpacity>
        )}
    </View>
)

export default MainLayout
