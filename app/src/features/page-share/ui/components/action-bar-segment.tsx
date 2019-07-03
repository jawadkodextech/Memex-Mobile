import React from 'react'
import {
    View,
    Text,
    Button,
    NativeSyntheticEvent,
    NativeTouchEvent,
} from 'react-native'

import styles from './action-bar-segment.styles'

export interface Props {
    onCancelPress: (e: NativeSyntheticEvent<NativeTouchEvent>) => void
    onConfirmPress: (e: NativeSyntheticEvent<NativeTouchEvent>) => void
}

const ActionBar: React.StatelessComponent<Props> = props => (
    <View style={styles.container}>
        <Button title="Undo" onPress={props.onCancelPress} />
        <Text style={styles.mainText}>{props.children}</Text>
        <Button title="Save" onPress={props.onConfirmPress} />
    </View>
)

export default ActionBar
