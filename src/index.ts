import type { App, Plugin } from 'vue'
import SearchGrid from './components/SearchGrid.vue'
import PayloadViewer from './components/PayloadViewer.vue'
import PcapViewer from './components/PcapViewer.vue'
import EventDetail from './components/EventDetail.vue'
import GroupPanel from './components/GroupPanel.vue'
import GroupChart from './components/GroupChart.vue'
import FilterBuilder from './components/FilterBuilder.vue'
import ContextMenu from './components/ContextMenu.vue'

import FloatingWindow from './components/FloatingWindow.vue'
import PayloadDiff from './components/PayloadDiff.vue'

export {
  SearchGrid,
  PayloadViewer,
  PcapViewer,
  PayloadDiff,
  FloatingWindow,
  EventDetail,
  GroupPanel,
  GroupChart,
  FilterBuilder,
  ContextMenu,
}
export { useWindows, type FloatWin, type FloatWinKind, type WinGeometry } from './composables/useWindows'
export {
  diffLines,
  diffTexts,
  inlineDiff,
  stableJson,
  toSideBySide,
  type DiffInput,
  type DiffResult,
  type DiffRow,
} from './utils/diff'
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
export {
  analyzeCapture,
  parseCapture,
  dissectFrame,
  looksLikePacket,
  isCaptureFile,
  matchPacketFilter,
  toPcapFile,
  LINKTYPE,
  type PcapCapture,
  type PcapFrame,
  type PcapLayer,
  type PcapField,
  type PcapSummary,
  type DissectedFrame,
} from './utils/pcap'

/** app.use(CodSearchGrid) 로 전역 컴포넌트 <CodSearchGrid>, <CodPayloadViewer> 등록 */
export const CodSearchGrid: Plugin = {
  install(app: App) {
    app.component('CodSearchGrid', SearchGrid)
    app.component('CodPayloadViewer', PayloadViewer)
    app.component('CodPcapViewer', PcapViewer)
    app.component('CodPayloadDiff', PayloadDiff)
  },
}

export default CodSearchGrid
