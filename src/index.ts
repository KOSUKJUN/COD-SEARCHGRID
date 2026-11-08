import type { App, Plugin } from 'vue'
import SearchGrid from './components/SearchGrid.vue'

export { SearchGrid }
export * from './types'
export {
  appendToQuery,
  buildFilterToken,
  compareValues,
  filterRecords,
  getValueByPath,
  highlightTerms,
  matchRecord,
  parseQuery,
  tokenize,
  wildcardToRegExp,
} from './utils/query'
export type { FieldFilter, FilterOp, ParsedQuery } from './utils/query'

/** app.use(CodSearchGrid) 로 전역 컴포넌트 <CodSearchGrid> 등록 */
export const CodSearchGrid: Plugin = {
  install(app: App) {
    app.component('CodSearchGrid', SearchGrid)
  },
}

export default CodSearchGrid
