/**
 * Analytics Aggregator Module
 *
 * Exports all types and the AnalyticsAggregator class
 *
 * Following the specification from openspec/changes/octopus-features/tasks.md
 * Tasks 2.2.1, 2.2.2: Analytics aggregator module
 */

// Export types
export type {
  AnalyticsMetrics,
  AnalyticsDimensions,
  AggregatedDataPoint,
  AnalyticsQuery,
  RecordInput,
  AggregatorConfig,
  Database,
  AnalyticsFlushData,
} from './types';

// Export type guards
export {
  isAnalyticsMetrics,
  isAnalyticsQuery,
  isAggregatedDataPoint,
} from './types';

// Export AnalyticsAggregator class
export { AnalyticsAggregator } from './aggregator';
