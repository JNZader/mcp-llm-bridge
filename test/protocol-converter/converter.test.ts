/**
 * Protocol Converter Tests
 * TDD test suite for bidirectional protocol conversion
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { ProtocolConverter } from '../../src/protocol-converter/converter.js';
import { AnthropicAdapter } from '../../src/protocol-converter/adapters/anthropic-adapter.js';
import { GeminiAdapter } from '../../src/protocol-converter/adapters/gemini-adapter.js';
import type { CanonicalResponse, AnthropicRequest, GeminiRequest } from '../../src/protocol-converter/types.js';

describe('ProtocolConverter', () => {
  let converter: ProtocolConverter;

  beforeEach(() => {
    converter = new ProtocolConverter();
  });

  describe('Anthropic ↔ OpenAI', () => {
    it('should convert Anthropic request to OpenAI format', () => {
      const anthropicRequest: AnthropicRequest = {
        model: 'claude-3-sonnet-20240229',
        system: 'You are a helpful assistant',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
        ],
        max_tokens: 1024,
      };

      const result = converter.convertIncoming('anthropic', anthropicRequest);

      assert.strictEqual(result.canonical.model, 'claude-3-sonnet-20240229');
      assert.strictEqual(result.canonical.messages.length, 3); // system + 2 messages
      assert.strictEqual(result.canonical.messages[0]!.role, 'system');
      assert.strictEqual(result.canonical.messages[0]!.content, 'You are a helpful assistant');
      assert.strictEqual(result.canonical.messages[1]!.role, 'user');
      assert.strictEqual(result.canonical.messages[1]!.content, 'Hello');
      assert.strictEqual(result.targetProtocol, 'anthropic');
    });

    it('should convert Anthropic request with content blocks to OpenAI format', () => {
      const anthropicRequest: AnthropicRequest = {
        model: 'claude-3-opus',
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Hello with blocks' }],
          },
        ],
      };

      const result = converter.convertIncoming('anthropic', anthropicRequest);

      assert.strictEqual(result.canonical.messages[0]!.content, 'Hello with blocks');
    });

    it('should convert OpenAI response to Anthropic format', () => {
      const openaiResponse: CanonicalResponse = {
        id: 'msg_123',
        model: 'claude-3-sonnet',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'Hello!' },
          finish_reason: 'stop',
        }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      };

      const result = converter.convertOutgoing('anthropic', openaiResponse) as { content: Array<{ type: string; text: string }>; role: string; usage: { input_tokens: number; output_tokens: number } };

      assert.strictEqual(result.content[0]!.text, 'Hello!');
      assert.strictEqual(result.role, 'assistant');
      assert.strictEqual(result.usage.input_tokens, 10);
      assert.strictEqual(result.usage.output_tokens, 5);
    });

    it('should map Anthropic stop reasons correctly', () => {
      const openaiResponse: CanonicalResponse = {
        id: 'msg_456',
        model: 'claude-3-sonnet',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'Test' },
          finish_reason: 'length',
        }],
        usage: {
          prompt_tokens: 5,
          completion_tokens: 10,
          total_tokens: 15,
        },
      };

      const result = converter.convertOutgoing('anthropic', openaiResponse) as { stop_reason: string };

      assert.strictEqual(result.stop_reason, 'max_tokens');
    });
  });

  describe('Gemini ↔ OpenAI', () => {
    it('should convert Gemini request to OpenAI format', () => {
      const geminiRequest: GeminiRequest = {
        model: 'gemini-1.5-flash',
        contents: [
          { role: 'user', parts: [{ text: 'Hello' }] },
          { role: 'model', parts: [{ text: 'Hi!' }] },
        ],
        generationConfig: { temperature: 0.7 },
      };

      const result = converter.convertIncoming('gemini', geminiRequest);

      assert.strictEqual(result.canonical.model, 'gemini-1.5-flash');
      assert.strictEqual(result.canonical.messages.length, 2);
      assert.strictEqual(result.canonical.messages[0]!.role, 'user');
      assert.strictEqual(result.canonical.messages[0]!.content, 'Hello');
      assert.strictEqual(result.canonical.messages[1]!.role, 'assistant');
      assert.strictEqual(result.canonical.messages[1]!.content, 'Hi!');
      assert.strictEqual(result.canonical.temperature, 0.7);
    });

    it('should convert Gemini request with generation config to OpenAI format', () => {
      const geminiRequest: GeminiRequest = {
        model: 'gemini-pro',
        contents: [{ role: 'user', parts: [{ text: 'Test' }] }],
        generationConfig: {
          temperature: 0.5,
          maxOutputTokens: 512,
          topP: 0.9,
          topK: 40,
        },
      };

      const result = converter.convertIncoming('gemini', geminiRequest);

      assert.strictEqual(result.canonical.temperature, 0.5);
      assert.strictEqual(result.canonical.max_tokens, 512);
    });

    it('should convert OpenAI response to Gemini format', () => {
      const openaiResponse: CanonicalResponse = {
        id: 'resp_789',
        model: 'gemini-pro',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'Gemini response!' },
          finish_reason: 'stop',
        }],
        usage: {
          prompt_tokens: 8,
          completion_tokens: 3,
          total_tokens: 11,
        },
      };

      const result = converter.convertOutgoing('gemini', openaiResponse) as { candidates: Array<{ content: { parts: Array<{ text: string }> }; finishReason: string }>; usageMetadata: { promptTokenCount: number; candidatesTokenCount: number; totalTokenCount: number } };

      assert.strictEqual(result.candidates[0]!.content.parts[0]!.text, 'Gemini response!');
      assert.strictEqual(result.candidates[0]!.finishReason, 'STOP');
      assert.strictEqual(result.usageMetadata.promptTokenCount, 8);
      assert.strictEqual(result.usageMetadata.candidatesTokenCount, 3);
      assert.strictEqual(result.usageMetadata.totalTokenCount, 11);
    });

    it('should map Gemini finish reasons correctly', () => {
      const openaiResponse: CanonicalResponse = {
        id: 'resp_999',
        model: 'gemini-pro',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'Long response' },
          finish_reason: 'length',
        }],
        usage: {
          prompt_tokens: 5,
          completion_tokens: 100,
          total_tokens: 105,
        },
      };

      const result = converter.convertOutgoing('gemini', openaiResponse) as { candidates: Array<{ finishReason: string }> };

      assert.strictEqual(result.candidates[0]!.finishReason, 'MAX_TOKENS');
    });
  });

  describe('Protocol Detection', () => {
    it('should auto-detect Anthropic from model name', () => {
      const result = converter.convertIncoming('openai', {
        model: 'claude-3-opus',
        messages: [{ role: 'user' as const, content: 'test' }],
      });

      assert.strictEqual(result.targetProtocol, 'anthropic');
    });

    it('should auto-detect Gemini from model name', () => {
      const result = converter.convertIncoming('openai', {
        model: 'gemini-pro',
        messages: [{ role: 'user' as const, content: 'test' }],
      });

      assert.strictEqual(result.targetProtocol, 'gemini');
    });

    it('should default to OpenAI for unknown model prefixes', () => {
      const result = converter.convertIncoming('openai', {
        model: 'gpt-4',
        messages: [{ role: 'user' as const, content: 'test' }],
      });

      assert.strictEqual(result.targetProtocol, 'openai');
    });

    it('should detect Gemini-1.5 models correctly', () => {
      const result = converter.convertIncoming('openai', {
        model: 'gemini-1.5-flash',
        messages: [{ role: 'user' as const, content: 'test' }],
      });

      assert.strictEqual(result.targetProtocol, 'gemini');
    });

    it('should detect Claude-3 models correctly', () => {
      const result = converter.convertIncoming('openai', {
        model: 'claude-3-sonnet',
        messages: [{ role: 'user' as const, content: 'test' }],
      });

      assert.strictEqual(result.targetProtocol, 'anthropic');
    });
  });

  describe('OpenAI Passthrough', () => {
    it('should pass through OpenAI requests as canonical', () => {
      const openaiRequest = {
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'System prompt' },
          { role: 'user', content: 'User message' },
        ],
        temperature: 0.8,
        max_tokens: 2048,
      };

      const result = converter.convertIncoming('openai', openaiRequest);

      assert.strictEqual(result.canonical.model, 'gpt-4');
      assert.strictEqual(result.canonical.messages.length, 2);
      assert.strictEqual(result.targetProtocol, 'openai');
    });

    it('should pass through OpenAI responses unchanged', () => {
      const openaiResponse: CanonicalResponse = {
        id: 'chatcmpl_123',
        model: 'gpt-4',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'Direct response' },
          finish_reason: 'stop',
        }],
        usage: {
          prompt_tokens: 20,
          completion_tokens: 10,
          total_tokens: 30,
        },
      };

      const result = converter.convertOutgoing('openai', openaiResponse);

      assert.deepStrictEqual(result, openaiResponse);
    });
  });

  describe('Error Handling', () => {
    it('should throw error for unsupported protocol', () => {
      assert.throws(
        () => converter.convertIncoming('unsupported' as any, {}),
        /Unsupported protocol: unsupported/
      );
    });

    it('should throw error for missing model in Anthropic request', () => {
      assert.throws(
        () => converter.convertIncoming('anthropic', { messages: [] }),
        /missing required field: model/
      );
    });

    it('should throw error for missing messages in Anthropic request', () => {
      assert.throws(
        () => converter.convertIncoming('anthropic', { model: 'claude-3' }),
        /missing or invalid field: messages/
      );
    });

    it('should throw error for missing model in Gemini request', () => {
      assert.throws(
        () => converter.convertIncoming('gemini', { contents: [] }),
        /missing required field: model/
      );
    });

    it('should throw error for missing contents in Gemini request', () => {
      assert.throws(
        () => converter.convertIncoming('gemini', { model: 'gemini-pro' }),
        /missing or invalid field: contents/
      );
    });

    it('should throw error for response with no choices', () => {
      const emptyResponse: CanonicalResponse = {
        id: 'empty',
        model: 'test',
        choices: [],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };

      assert.throws(
        () => converter.convertOutgoing('anthropic', emptyResponse),
        /Canonical response has no choices/
      );
    });
  });

  describe('Streaming Support', () => {
    it('should pass through stream chunks for OpenAI', () => {
      const chunk = { delta: { content: 'partial' } };

      const result = converter.convertStreamChunk('openai', chunk);

      assert.deepStrictEqual(result, chunk);
    });

    it('should pass through stream chunks when adapter lacks handler', () => {
      const chunk = { content: 'partial response' };

      const result = converter.convertStreamChunk('anthropic', chunk);

      assert.deepStrictEqual(result, chunk);
    });
  });

  describe('Adapter Registration', () => {
    it('should support getting list of supported protocols', () => {
      const protocols = converter.getSupportedProtocols();

      assert.deepStrictEqual(protocols, ['openai', 'anthropic', 'gemini']);
    });

    it('should check if protocol is supported', () => {
      assert.strictEqual(converter.isProtocolSupported('openai'), true);
      assert.strictEqual(converter.isProtocolSupported('anthropic'), true);
      assert.strictEqual(converter.isProtocolSupported('gemini'), true);
      assert.strictEqual(converter.isProtocolSupported('unknown' as any), false);
    });

    it('should allow registering custom adapter', () => {
      const customAdapter = {
        protocol: 'custom' as any,
        toCanonical: (_req: unknown) => ({
          model: 'custom-model',
          messages: [{ role: 'user' as const, content: 'test' }],
        }),
        fromCanonical: (res: CanonicalResponse) => res,
      };

      converter.registerAdapter(customAdapter);

      assert.strictEqual(converter.isProtocolSupported('custom' as any), true);
    });
  });

  describe('Direct Adapter Tests', () => {
    describe('AnthropicAdapter', () => {
      it('should handle Anthropic content blocks extraction', () => {
        const adapter = new AnthropicAdapter();
        const request = {
          model: 'claude-3',
          messages: [{
            role: 'user' as const,
            content: [
              { type: 'text' as const, text: 'First' },
              { type: 'text' as const, text: 'Second' },
            ],
          }],
        };

        const result = adapter.toCanonical(request);

        assert.strictEqual(result.messages[0]!.content, 'FirstSecond');
      });

      it('should convert canonical back to Anthropic request', () => {
        const adapter = new AnthropicAdapter();
        const canonical = {
          model: 'claude-3-opus',
          messages: [
            { role: 'system' as const, content: 'Be helpful' },
            { role: 'user' as const, content: 'Hello' },
          ],
        };

        const result = adapter.toAnthropicRequest(canonical);

        assert.strictEqual(result.system, 'Be helpful');
        assert.strictEqual(result.messages.length, 1);
        assert.strictEqual(result.messages[0]!.role, 'user');
      });
    });

    describe('GeminiAdapter', () => {
      it('should handle multiple parts extraction', () => {
        const adapter = new GeminiAdapter();
        const request = {
          model: 'gemini-pro',
          contents: [{
            role: 'user' as const,
            parts: [
              { text: 'Part 1' },
              { text: 'Part 2' },
            ],
          }],
        };

        const result = adapter.toCanonical(request);

        assert.strictEqual(result.messages[0]!.content, 'Part 1Part 2');
      });

      it('should convert canonical back to Gemini request', () => {
        const adapter = new GeminiAdapter();
        const canonical = {
          model: 'gemini-pro',
          messages: [
            { role: 'system' as const, content: 'System' },
            { role: 'user' as const, content: 'Hello' },
          ],
        };

        const result = adapter.toGeminiRequest(canonical);

        // System messages are filtered in Gemini
        assert.strictEqual(result.contents.length, 1);
        assert.strictEqual(result.contents[0]!.role, 'user');
        assert.strictEqual(result.contents[0]!.parts[0]!.text, 'Hello');
      });
    });
  });
});
