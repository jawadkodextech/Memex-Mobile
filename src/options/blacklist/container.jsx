import React, { Component } from 'react'
import PropTypes from 'prop-types'
import { connect } from 'react-redux'

import { Wrapper } from 'src/common-ui/components'
import BlacklistTable from './components/BlacklistTable'
import BlacklistRow from './components/BlacklistRow'
import BlacklistInputRow from './components/BlacklistInputRow'
import BlacklistRemoveModal from './components/BlacklistRemoveModal'
import * as actions from './actions'
import * as selectors from './selectors'
import styles from './components/base.css'

class BlacklistContainer extends Component {
    static propTypes = {
        // State
        inputVal: PropTypes.string.isRequired,
        lastValue: PropTypes.string,
        blacklist: PropTypes.arrayOf(PropTypes.string).isRequired,
        isInputRegexInvalid: PropTypes.bool.isRequired,
        isSaveBtnDisabled: PropTypes.bool.isRequired,
        isClearBtnDisabled: PropTypes.bool.isRequired,
        showRemoveModal: PropTypes.bool.isRequired,
        isLoading: PropTypes.bool.isRequired,
        matchedDocCount: PropTypes.number.isRequired,

        // Actions
        hideModal: PropTypes.func.isRequired,
        removeMatchingDocs: PropTypes.func.isRequired,
        resetInputVal: PropTypes.func.isRequired,
        addToBlacklist: PropTypes.func.isRequired,
        removeFromBlacklist: PropTypes.func.isRequired,
        setInputVal: PropTypes.func.isRequired,
    }

    componentDidMount() {
        this.focusInput()
    }

    focusInput = () => this.input.focus()
    assignRef = input => (this.input = input)

    onNewBlacklistItemAdded = () => {
        // Make sure to interpret '.' as "period" rather than "any single character", as it is common in hostnames
        // also ignore all whitespace
        const expression = this.props.inputVal
            .replace(/\s+/g, '')
            .replace('.', '\\.')

        // Ignore when user tries to submit nothing (no error state, so just do nothing)
        if (!expression.length) return

        this.props.addToBlacklist(expression)

        // Make sure input refocuses after new item added
        this.focusInput()
    }

    // TODO(AM): Undo? Confirmation?
    onDeleteClicked = index => () => this.props.removeFromBlacklist(index)

    onInputChange = (event = { target: {} }) => {
        const value = event.target.value || ''
        this.props.setInputVal(value)
    }

    /**
     * Handles removing all matching docs from the DBs for the recently added blacklist entry.
     */
    handleRemoveMatching = () =>
        this.props.removeMatchingDocs(this.props.lastValue)

    renderBlacklistInputRow() {
        const { resetInputVal, inputVal, ...props } = this.props

        return (
            <BlacklistInputRow
                key="blacklist-input"
                value={inputVal}
                onAdd={this.onNewBlacklistItemAdded}
                onInputChange={this.onInputChange}
                onInputClear={resetInputVal}
                inputRef={this.assignRef} // eslint-disable-line no-return-assign
                {...props}
            />
        )
    }

    renderBlacklistRows = () =>
        this.props.blacklist.map((expression, i) => (
            <BlacklistRow
                key={i}
                expression={expression}
                onDeleteClicked={this.onDeleteClicked(i)}
            />
        ))

    renderAddDomain = () => (
        <div className={styles.ignoreDomainText}>Ignore a new domain/url:</div>
    )

    renderAddBlacklistSites = () =>
        this.props.blacklist.length ? (
            <div className={styles.blacklistText}>
                You are currently not indexing ANY visits on URLs that have the
                following text in them:
            </div>
        ) : (
            false
        )

    renderInvalidRegexAlert = () =>
        this.props.isInputRegexInvalid ? (
            <div className={styles.blacklistAlert}>
                This is an invalid RegExp! You can test your regex{' '}
                <a target="_blank" href="https://regexr.com/">
                    here
                </a>
            </div>
        ) : (
            false
        )

    render() {
        return (
            <Wrapper>
                <div>
                    {this.renderAddDomain()}
                    {this.renderInvalidRegexAlert()}
                    {this.renderBlacklistInputRow()}
                    {this.renderAddBlacklistSites()}
                    <BlacklistTable>
                        {this.renderBlacklistRows()}
                    </BlacklistTable>
                </div>
                <BlacklistRemoveModal
                    isLoading={this.props.isLoading}
                    matchedCount={this.props.matchedDocCount}
                    isShown={this.props.showRemoveModal}
                    onCancel={this.props.hideModal}
                    onConfirm={this.handleRemoveMatching}
                />
            </Wrapper>
        )
    }
}

const mapStateToProps = state => ({
    inputVal: selectors.siteInputValue(state),
    blacklist: selectors.normalizedBlacklist(state),
    isInputRegexInvalid: selectors.isInputRegexInvalid(state),
    isSaveBtnDisabled: selectors.isSaveBtnDisabled(state),
    isClearBtnDisabled: selectors.isClearBtnDisabled(state),
    isLoading: selectors.isLoading(state),
    matchedDocCount: selectors.matchedDocCount(state),
    showRemoveModal: selectors.showRemoveModal(state),
    lastValue: selectors.lastValue(state),
})

const mapDispatchToProps = dispatch => ({
    hideModal: () => dispatch(actions.setModalShow(false)),
    removeMatchingDocs: expression =>
        dispatch(actions.removeMatchingDocs(expression)),
    resetInputVal: () => dispatch(actions.resetSiteInputValue()),
    addToBlacklist: expression => dispatch(actions.addToBlacklist(expression)),
    setInputVal: siteInputValue =>
        dispatch(actions.setSiteInputValue({ siteInputValue })),
    removeFromBlacklist: index =>
        dispatch(actions.removeSiteFromBlacklist({ index })),
})

export default connect(mapStateToProps, mapDispatchToProps)(BlacklistContainer)
