import type { App, Plugin } from 'vue'
import SearchGrid from './components/SearchGrid.vue'
import PayloadViewer from './components/PayloadViewer.vue'
import EventDetail from './components/EventDetail.vue'
import GroupPanel from './components/GroupPanel.vue'
import GroupChart from './components/GroupChart.vue'
import FilterBuilder from './components/FilterBuilder.vue'
import ContextMenu from './components/ContextMenu.vue'

export { SearchGrid, PayloadViewer, EventDetail, GroupPanel, GroupChart, FilterBuilder, ContextMenu }
export * from './types'
export { DEFAULT_MESSAGES, fmtMsg } from './messages'
export { toCSV, toTSV, toJSON, downloadText, copyText, type ExportFormat } from './utils/export'
export { queryToConditions, conditionsToQuery, setValueByPath, quoteTerm, type ConditionOp, type QueryCondition } from './utils/query'
export {
  appendToQuery,
  buildFilterToken,
  compareValues,
  filterRecords,
  getValueByPath,
  groupCounts,
  groupFilterToken,
  highlightTerms,
  matchRecord,
  parseQuery,
  sortBuckets,
  tokenize,
  wildcardToRegExp,
} from './utils/query'
export type { FieldFilter, FilterOp, ParsedQuery } from './utils/query'
export { buildGroupTree, collectGroupKeys, type GroupNode } from './utils/group'
export {
  analyzePayload,
  decodeBase64,
  decodeHex,
  formatBytes,
  hexDump,
  looksLikeBase64,
  type PayloadEncoding,
  type PayloadInfo,
  type PayloadView,
} from './utils/payload'

/** app.use(CodSearchGrid) 로 전역 컴포넌트 <CodSearchGrid>, <CodPayloadViewer> 등록 */
export const CodSearchGrid: Plugin = {
  install(app: App) {
    app.component('CodSearchGrid', SearchGrid)
    app.component('CodPayloadViewer', PayloadViewer)
  },
}

export default CodSearchGrid
