import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Span } from "@opentelemetry/api";

import { AnalyticsAggregator } from "../../src/analytics/aggregator.js";
import { childLogger } from "../../src/core/logger.js";
import { getMetrics, recordLlmAttemptMetric, startLlmTimer } from "../../src/core/metrics.js";
import { endSpanError, initTracing, shutdownTracing, startGenerateSpan } from "../../src/core/tracing.js";

import {
  RETENTION_SINKS,
  RETENTION_VERIFICATION_OUTCOMES,
  enforceExternalRetention,
  getRetentionPolicy,
  verifyRetention,
} from "../../src/telemetry/retention.js";

describe("telemetry sink retention", () => {
  it("rejects canaries at ordinary log, trace, and metric boundaries", () => {
    const canaries = [
      "WU3-PLAIN-CANARY", "WU3-NESTED-CANARY", "WU3-RENAMED-CANARY",
      "V1UzLUJBU0U2NC1DQU5BUlk=", "WU3-ESCAPED-\\u0063ANARY", "WU3-UNICODE-秘密",
      `${"x".repeat(9_990)}WU3-TRUNCATION-CANARY`,
      "COMPARISON-PROMPT-CANARY", "COMPARISON-SYSTEM-PROMPT-CANARY",
      "COMPARISON-RESPONSE-CANARY", "COMPARISON-SUMMARY-CANARY",
    ];

    for (const canary of canaries) {
      assert.throws(() => childLogger({ renamedPayload: canary }));
      assert.throws(() => new AnalyticsAggregator().record(canary, "gpt-4", {
        channel: "gateway", latencyMs: 1,
      }));
      assert.throws(() => startGenerateSpan(canary, "gpt-4"));
      assert.throws(() => recordLlmAttemptMetric({
        provider: "openai", model: canary, success: true, latencyMs: 1,
      }));
      assert.throws(() => startLlmTimer("openai", canary));
    }
  });

  it("reduces provider errors to safe trace attributes before export", () => {
    const attributes: Record<string, unknown> = {};
    const span = {
      setAttribute(key: string, value: unknown) { attributes[key] = value; },
      setStatus() {},
      end() {},
    } as unknown as Span;

    endSpanError(span, new Error("provider WU3-TRACE-CANARY"));

    assert.deepEqual(attributes, {
      "telemetry.failure_code": "failed",
      "telemetry.failure_category": "client",
    });
  });

  it("defines independently owned thirty-day policies for every protected sink", () => {
    const sinks = Object.values(RETENTION_SINKS);

    assert.equal(sinks.length, 7);
    for (const sink of sinks) {
      const policy = getRetentionPolicy(sink);
      assert.equal(policy.retentionDays, 30);
      assert.ok(policy.deletionOwner.length > 0);
      assert.ok(policy.verificationControl.length > 0);
    }
  });

  it("never reports success without complete deletion evidence", () => {
    for (const sink of Object.values(RETENTION_SINKS)) {
      assert.notEqual(
        verifyRetention(sink).outcome,
        RETENTION_VERIFICATION_OUTCOMES.SUCCESS,
        `${sink} must not succeed without evidence`,
      );
      assert.equal(
        verifyRetention(sink, { deletionFailed: true }).outcome,
        RETENTION_VERIFICATION_OUTCOMES.FAILED,
      );
      assert.equal(
        verifyRetention(sink, { indeterminate: true }).outcome,
        RETENTION_VERIFICATION_OUTCOMES.INDETERMINATE,
      );
      assert.notEqual(
        verifyRetention(sink, { expiredRecordsAbsent: false }).outcome,
        RETENTION_VERIFICATION_OUTCOMES.SUCCESS,
      );
    }
  });

  it("requires configured exporters to prove both deletion receipt and absence", () => {
    const sink = RETENTION_SINKS.ANALYTICS;

    assert.equal(
      verifyRetention(sink, {
        expiredRecordsAbsent: true,
        exporterConfigured: true,
      }).outcome,
      RETENTION_VERIFICATION_OUTCOMES.INDETERMINATE,
    );
    assert.equal(
      verifyRetention(sink, {
        expiredRecordsAbsent: true,
        exporterConfigured: true,
        exporterDeletionReceipt: true,
        exporterAbsenceConfirmed: false,
      }).outcome,
      RETENTION_VERIFICATION_OUTCOMES.FAILED,
    );
    assert.equal(
      verifyRetention(sink, {
        expiredRecordsAbsent: true,
        exporterConfigured: true,
        exporterDeletionReceipt: true,
        exporterAbsenceConfirmed: true,
      }).outcome,
      RETENTION_VERIFICATION_OUTCOMES.SUCCESS,
    );
  });

  it("runs expiry controls for each configured ordinary telemetry backend", async () => {
    for (const sink of [RETENTION_SINKS.ORDINARY_LOGS, RETENTION_SINKS.TRACES, RETENTION_SINKS.METRICS]) {
      const policy = getRetentionPolicy(sink);
      let deletedBefore: number | undefined;
      const result = await enforceExternalRetention(sink, {
        configured: true,
        sink,
        retentionDays: policy.retentionDays,
        deletionOwner: policy.deletionOwner,
        deleteExpired: async (beforeTimestamp) => {
          deletedBefore = beforeTimestamp;
          return { receiptId: `${sink}-receipt` };
        },
        confirmExpiredAbsent: async (beforeTimestamp) => beforeTimestamp === deletedBefore,
      }, 1_800_000_000_000);
      assert.equal(result.outcome, RETENTION_VERIFICATION_OUTCOMES.SUCCESS);
    }
  });

  it("fails closed when a configured backend has no eligibility or absence proof", async () => {
    const policy = getRetentionPolicy(RETENTION_SINKS.TRACES);
    const result = await enforceExternalRetention(RETENTION_SINKS.TRACES, {
      configured: true,
      sink: RETENTION_SINKS.TRACES,
      retentionDays: policy.retentionDays,
      deletionOwner: policy.deletionOwner,
      deleteExpired: async () => undefined,
      confirmExpiredAbsent: async () => true,
    });
    assert.equal(result.outcome, RETENTION_VERIFICATION_OUTCOMES.NOT_VERIFIED);
  });

  it("gates the configured OTLP exporter on verified external retention", async () => {
    const previousEnabled = process.env["LLM_GATEWAY_TRACING_ENABLED"];
    process.env["LLM_GATEWAY_TRACING_ENABLED"] = "true";
    const policy = getRetentionPolicy(RETENTION_SINKS.TRACES);
    let exporterCreated = false;

    try {
      const initialized = await initTracing({
        retentionBackend: {
          configured: true,
          sink: RETENTION_SINKS.TRACES,
          retentionDays: policy.retentionDays,
          deletionOwner: policy.deletionOwner,
          deleteExpired: async () => ({ receiptId: "trace-receipt" }),
          confirmExpiredAbsent: async () => true,
        },
        createTraceExporter: () => {
          exporterCreated = true;
          return {
            export: (_spans: unknown[], callback: (result: { code: number }) => void) => callback({ code: 0 }),
            shutdown: async () => {},
          } as never;
        },
      });

      assert.equal(initialized, true);
      assert.equal(exporterCreated, true);
    } finally {
      await shutdownTracing();
      if (previousEnabled === undefined) delete process.env["LLM_GATEWAY_TRACING_ENABLED"];
      else process.env["LLM_GATEWAY_TRACING_ENABLED"] = previousEnabled;
    }
  });

  it("does not create an OTLP exporter when retention verification is indeterminate", async () => {
    const previousEnabled = process.env["LLM_GATEWAY_TRACING_ENABLED"];
    process.env["LLM_GATEWAY_TRACING_ENABLED"] = "true";
    let exporterCreated = false;

    try {
      const initialized = await initTracing({
        createTraceExporter: () => {
          exporterCreated = true;
          return {
            export: (_spans: unknown[], callback: (result: { code: number }) => void) => callback({ code: 0 }),
            shutdown: async () => {},
          } as never;
        },
      });

      assert.equal(initialized, false);
      assert.equal(exporterCreated, false);
    } finally {
      if (previousEnabled === undefined) delete process.env["LLM_GATEWAY_TRACING_ENABLED"];
      else process.env["LLM_GATEWAY_TRACING_ENABLED"] = previousEnabled;
    }
  });

  it("reports local metrics separately from an unverified configured external backend", async () => {
    const localMetrics = await getMetrics();
    const policy = getRetentionPolicy(RETENTION_SINKS.METRICS);
    const externalMetrics = getMetrics({
      configured: true,
      sink: RETENTION_SINKS.METRICS,
      retentionDays: policy.retentionDays,
      deletionOwner: policy.deletionOwner,
      deleteExpired: async () => undefined,
      confirmExpiredAbsent: async () => true,
    });

    assert.equal(typeof localMetrics, "string");
    await assert.rejects(externalMetrics, /retention is not verified/);
  });
});
