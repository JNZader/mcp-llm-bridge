/**
 * Three-part prompt pattern — split, compose, optimize.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  splitPrompt,
  composeMessages,
  optimizeMessages,
} from '../../src/transformers/three-part-prompt.js';
import type { ThreePartPrompt } from '../../src/transformers/three-part-prompt.js';
import type { InternalMessage } from '../../src/core/internal-model.js';

describe('splitPrompt', () => {
  it('returns empty parts for empty input', () => {
    const result = splitPrompt('');
    assert.deepEqual(result, { system: '', context: '', instruction: '' });
  });

  it('puts single paragraph into instruction', () => {
    const result = splitPrompt('What is the capital of France?');
    assert.equal(result.instruction, 'What is the capital of France?');
    assert.equal(result.system, '');
    assert.equal(result.context, '');
  });

  it('detects system-like content', () => {
    const prompt = [
      'You are a helpful coding assistant.',
      '',
      'Here is the file content: function foo() { return 1; }',
      '',
      'Explain what this function does.',
    ].join('\n');

    const result = splitPrompt(prompt);
    assert.ok(result.system.includes('You are a helpful'));
    assert.ok(result.context.includes('file content'));
    assert.ok(result.instruction.includes('Explain'));
  });

  it('detects context markers', () => {
    const prompt = [
      'Context: The user is a Python developer.',
      '',
      'Please write a sorting function.',
    ].join('\n');

    const result = splitPrompt(prompt);
    assert.ok(result.context.includes('Python developer'));
    assert.ok(result.instruction.includes('sorting function'));
  });

  it('detects instruction markers', () => {
    const prompt = [
      'The database has 3 tables: users, orders, items.',
      '',
      'Task: Write a SQL query to find all users who placed orders.',
    ].join('\n');

    const result = splitPrompt(prompt);
    assert.ok(result.context.includes('database'));
    assert.ok(result.instruction.includes('SQL query'));
  });

  it('handles multi-paragraph context', () => {
    const prompt = [
      'You are an expert reviewer.',
      '',
      'Background: The project uses React 19.',
      '',
      'The following code implements a form component.',
      '',
      'Find any bugs in this code.',
    ].join('\n');

    const result = splitPrompt(prompt);
    assert.ok(result.system.includes('expert reviewer'));
    assert.ok(result.instruction.includes('bugs'));
  });

  it('falls back to position when no markers found', () => {
    const prompt = [
      'Some general background information here.',
      '',
      'More detailed information about the topic.',
      '',
      'What should we do about this?',
    ].join('\n');

    const result = splitPrompt(prompt);
    // Question-like content should end up as instruction
    assert.ok(result.instruction.includes('What should we do'));
  });

  it('accepts custom markers', () => {
    const prompt = [
      'DATOS: The user has 5 items.',
      '',
      'PREGUNTA: How many items are left?',
    ].join('\n');

    const result = splitPrompt(prompt, {
      contextMarkers: ['datos:'],
      instructionMarkers: ['pregunta:'],
    });

    assert.ok(result.context.includes('5 items'));
    assert.ok(result.instruction.includes('How many'));
  });
});

describe('composeMessages', () => {
  it('creates system + user messages', () => {
    const prompt: ThreePartPrompt = {
      system: 'You are a helpful assistant.',
      context: 'The user works with TypeScript.',
      instruction: 'Write a generic function.',
    };

    const messages = composeMessages(prompt);
    assert.equal(messages.length, 2);
    assert.equal(messages[0]!.role, 'system');
    assert.equal(messages[0]!.content, 'You are a helpful assistant.');
    assert.equal(messages[1]!.role, 'user');
    assert.ok((messages[1]!.content as string).includes('[Context]'));
    assert.ok((messages[1]!.content as string).includes('[Instruction]'));
  });

  it('skips system message when empty', () => {
    const prompt: ThreePartPrompt = {
      system: '',
      context: 'Some context.',
      instruction: 'Do something.',
    };

    const messages = composeMessages(prompt);
    assert.equal(messages.length, 1);
    assert.equal(messages[0]!.role, 'user');
  });

  it('handles instruction-only prompt', () => {
    const prompt: ThreePartPrompt = {
      system: '',
      context: '',
      instruction: 'What time is it?',
    };

    const messages = composeMessages(prompt);
    assert.equal(messages.length, 1);
    assert.ok((messages[0]!.content as string).includes('What time is it?'));
  });

  it('respects addLabels: false', () => {
    const prompt: ThreePartPrompt = {
      system: '',
      context: 'Some data.',
      instruction: 'Analyze it.',
    };

    const messages = composeMessages(prompt, { addLabels: false });
    const content = messages[0]!.content as string;
    assert.ok(!content.includes('[Context]'));
    assert.ok(!content.includes('[Instruction]'));
    assert.ok(content.includes('Some data.'));
    assert.ok(content.includes('Analyze it.'));
  });

  it('uses custom separator', () => {
    const prompt: ThreePartPrompt = {
      system: '',
      context: 'Data here.',
      instruction: 'Do this.',
    };

    const messages = composeMessages(prompt, { separator: '\n---\n' });
    const content = messages[0]!.content as string;
    assert.ok(content.includes('---'));
  });
});

describe('optimizeMessages', () => {
  it('splits a single user message into system + user', () => {
    const messages: InternalMessage[] = [
      {
        role: 'user',
        content: 'You are an expert Python developer.\n\nContext: The project uses Django.\n\nWrite a view for the API.',
      },
    ];

    const optimized = optimizeMessages(messages);
    assert.ok(optimized.length >= 1);

    const systemMsg = optimized.find((m) => m.role === 'system');
    if (systemMsg) {
      assert.ok((systemMsg.content as string).includes('Python developer'));
    }
  });

  it('returns messages as-is when already structured', () => {
    const messages: InternalMessage[] = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello.' },
    ];

    const optimized = optimizeMessages(messages);
    assert.deepEqual(optimized, messages);
  });

  it('returns messages as-is for multi-turn conversations', () => {
    const messages: InternalMessage[] = [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello!' },
      { role: 'user', content: 'How are you?' },
    ];

    const optimized = optimizeMessages(messages);
    assert.deepEqual(optimized, messages);
  });

  it('returns messages as-is when content is not string', () => {
    const messages: InternalMessage[] = [
      { role: 'user', content: [{ type: 'text' as const, text: 'Hello' }] },
    ];

    const optimized = optimizeMessages(messages);
    assert.deepEqual(optimized, messages);
  });

  it('returns messages as-is for simple instructions', () => {
    const messages: InternalMessage[] = [
      { role: 'user', content: 'What is 2 + 2?' },
    ];

    const optimized = optimizeMessages(messages);
    // Simple instruction with no system/context should stay as-is
    assert.equal(optimized.length, 1);
  });
});
