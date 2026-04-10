import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ApprovalStore, requiresApproval, DEFAULT_CONFIG } from '../src/approval/index.js';

describe('ApprovalStore', () => {
	it('creates a pending request', () => {
		const store = new ApprovalStore();
		const req = store.create({
			toolName: 'file_write',
			toolArgs: { path: '/etc/passwd' },
			requester: 'agent-1',
			reason: 'Needs to write config file',
		});
		assert.equal(req.status, 'pending');
		assert.equal(req.toolName, 'file_write');
		assert.ok(req.id.startsWith('approval-'));
	});

	it('approves a pending request', () => {
		const store = new ApprovalStore();
		const req = store.create({
			toolName: 'shell_exec',
			toolArgs: {},
			requester: 'agent-1',
			reason: 'Run tests',
		});
		const approved = store.approve(req.id, 'admin');
		assert.ok(approved);
		assert.equal(approved!.status, 'approved');
		assert.equal(approved!.resolvedBy, 'admin');
		assert.ok(approved!.resolvedAt);
	});

	it('denies a pending request', () => {
		const store = new ApprovalStore();
		const req = store.create({
			toolName: 'db_write',
			toolArgs: {},
			requester: 'agent-1',
			reason: 'Drop table',
		});
		const denied = store.deny(req.id, 'admin');
		assert.ok(denied);
		assert.equal(denied!.status, 'denied');
	});

	it('returns null when approving non-pending', () => {
		const store = new ApprovalStore();
		const req = store.create({
			toolName: 'test',
			toolArgs: {},
			requester: 'agent',
			reason: 'test',
		});
		store.approve(req.id, 'admin');
		// Try to approve again
		assert.equal(store.approve(req.id, 'admin'), null);
	});

	it('returns null for unknown id', () => {
		const store = new ApprovalStore();
		assert.equal(store.approve('nope', 'admin'), null);
	});

	it('getPending returns only pending requests', () => {
		const store = new ApprovalStore();
		store.create({ toolName: 'a', toolArgs: {}, requester: 'x', reason: 'r' });
		const req2 = store.create({ toolName: 'b', toolArgs: {}, requester: 'x', reason: 'r' });
		store.approve(req2.id, 'admin');
		store.create({ toolName: 'c', toolArgs: {}, requester: 'x', reason: 'r' });

		const pending = store.getPending();
		assert.equal(pending.length, 2);
		assert.ok(pending.every(r => r.status === 'pending'));
	});

	it('generates unique IDs', () => {
		const store = new ApprovalStore();
		const r1 = store.create({ toolName: 'a', toolArgs: {}, requester: 'x', reason: 'r' });
		const r2 = store.create({ toolName: 'b', toolArgs: {}, requester: 'x', reason: 'r' });
		assert.notEqual(r1.id, r2.id);
	});
});

describe('requiresApproval', () => {
	it('requires approval for dangerous tools', () => {
		assert.equal(requiresApproval('file_write'), true);
		assert.equal(requiresApproval('shell_exec'), true);
		assert.equal(requiresApproval('db_write'), true);
	});

	it('auto-approves safe tools', () => {
		assert.equal(requiresApproval('file_read'), false);
		assert.equal(requiresApproval('search'), false);
		assert.equal(requiresApproval('list'), false);
	});

	it('unknown tools do not require approval by default', () => {
		assert.equal(requiresApproval('unknown_tool'), false);
	});
});
