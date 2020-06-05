import { EditorMode } from 'src/features/page-editor/types'

export type PreviousRoute = 'Dashboard' | 'Reader'

export interface PageEditorNavigationParams {
    previousRoute?: PreviousRoute
    selectedList?: string
    pageUrl: string
    mode: EditorMode
}
