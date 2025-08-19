/**
 * 搜索模块统一导出入口
 *
 * 使用示例：
 * ```typescript
 * import { searchService, SmartHighlighter, AdvancedSearchParser } from './services/search';
 *
 * // 执行搜索
 * const { results } = await searchService.search('关键词');
 *
 * // 高亮结果
 * const segments = SmartHighlighter.quickHighlight(text, matchedTerms);
 *
 * // 解析搜索语法
 * const ast = AdvancedSearchParser.parse('标题:搜索 AND "精确匹配"');
 * ```
 */

// 核心搜索功能
export {
  SearchService,
  searchService,
  SearchExecutor,
  AdvancedSearch,
} from "./core";

// 搜索解析器
export { AdvancedSearchParser, SearchTokenizer, SearchParser } from "./parser";

// 高亮功能
export { SmartHighlighter } from "./highlighter";

// 工具函数
export * from "./utils";

// 类型定义
export * from "./types";

// 向后兼容的别名
export { searchService as default } from "./core";
