/**
 * Tests for semantic code chunker.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { splitIntoChunks } from '../../src/code-search/chunker.js';

describe('splitIntoChunks', () => {
  it('extracts TypeScript function declarations', () => {
    const content = `
export function greet(name: string): string {
  return \`Hello, \${name}\`;
}

export async function fetchData(url: string): Promise<Response> {
  return fetch(url);
}
`.trim();

    const chunks = splitIntoChunks('app.ts', content);

    assert.equal(chunks.length, 2);
    assert.equal(chunks[0]!.name, 'greet');
    assert.equal(chunks[0]!.kind, 'function');
    assert.equal(chunks[0]!.startLine, 1);

    assert.equal(chunks[1]!.name, 'fetchData');
    assert.equal(chunks[1]!.kind, 'function');
  });

  it('extracts arrow functions assigned to const', () => {
    const content = `
export const add = (a: number, b: number) => {
  return a + b;
};

const multiply = async (a: number, b: number) => {
  return a * b;
};
`.trim();

    const chunks = splitIntoChunks('math.ts', content);

    assert.equal(chunks.length, 2);
    assert.equal(chunks[0]!.name, 'add');
    assert.equal(chunks[0]!.kind, 'function');
    assert.equal(chunks[1]!.name, 'multiply');
  });

  it('extracts class declarations', () => {
    const content = `
export class UserService {
  constructor(private db: Database) {}

  async getUser(id: string): Promise<User> {
    return this.db.find(id);
  }
}

abstract class BaseController {
  abstract handle(): void;
}
`.trim();

    const chunks = splitIntoChunks('service.ts', content);

    const classChunks = chunks.filter((c) => c.kind === 'class');
    assert.equal(classChunks.length, 2);
    assert.equal(classChunks[0]!.name, 'UserService');
    assert.equal(classChunks[1]!.name, 'BaseController');
  });

  it('extracts interfaces and type aliases', () => {
    const content = `
export interface Config {
  host: string;
  port: number;
}

export type UserId = string;

interface Internal {
  secret: string;
}
`.trim();

    const chunks = splitIntoChunks('types.ts', content);

    const interfaces = chunks.filter((c) => c.kind === 'interface');
    assert.equal(interfaces.length, 2);
    assert.equal(interfaces[0]!.name, 'Config');

    const types = chunks.filter((c) => c.kind === 'type');
    assert.equal(types.length, 1);
    assert.equal(types[0]!.name, 'UserId');
  });

  it('extracts Python functions and classes', () => {
    const content = `
def greet(name):
    return f"Hello, {name}"

class UserService:
    def __init__(self, db):
        self.db = db

    def get_user(self, id):
        return self.db.find(id)

async def fetch_data(url):
    return await aiohttp.get(url)
`.trim();

    const chunks = splitIntoChunks('app.py', content);

    const funcs = chunks.filter((c) => c.kind === 'function');
    assert.ok(funcs.length >= 2, `Expected at least 2 functions, got ${funcs.length}`);
    assert.equal(funcs[0]!.name, 'greet');

    const classes = chunks.filter((c) => c.kind === 'class');
    assert.equal(classes.length, 1);
    assert.equal(classes[0]!.name, 'UserService');
  });

  it('extracts Go functions and types', () => {
    const content = `
func NewServer(port int) *Server {
	return &Server{port: port}
}

func (s *Server) Start() error {
	return s.listen()
}

type Config struct {
	Host string
	Port int
}
`.trim();

    const chunks = splitIntoChunks('main.go', content);

    const funcs = chunks.filter((c) => c.kind === 'function');
    assert.equal(funcs.length, 2);
    assert.equal(funcs[0]!.name, 'NewServer');
    assert.equal(funcs[1]!.name, 'Start');

    const types = chunks.filter((c) => c.kind === 'type');
    assert.equal(types.length, 1);
    assert.equal(types[0]!.name, 'Config');
  });

  it('extracts Rust functions and types', () => {
    const content = `
pub fn new(port: u16) -> Server {
    Server { port }
}

pub async fn fetch(url: &str) -> Result<Response, Error> {
    reqwest::get(url).await
}

pub struct Config {
    host: String,
    port: u16,
}
`.trim();

    const chunks = splitIntoChunks('main.rs', content);

    const funcs = chunks.filter((c) => c.kind === 'function');
    assert.equal(funcs.length, 2);
    assert.equal(funcs[0]!.name, 'new');

    const types = chunks.filter((c) => c.kind === 'type');
    assert.equal(types.length, 1);
    assert.equal(types[0]!.name, 'Config');
  });

  it('handles empty content', () => {
    const chunks = splitIntoChunks('empty.ts', '');
    assert.equal(chunks.length, 0);
  });

  it('handles content with no recognizable chunks', () => {
    const chunks = splitIntoChunks('data.json', '{ "key": "value" }');
    assert.equal(chunks.length, 0);
  });

  it('assigns unique IDs to chunks', () => {
    const content = `
function a() { return 1; }
function b() { return 2; }
`.trim();

    const chunks = splitIntoChunks('test.ts', content);
    const ids = new Set(chunks.map((c) => c.id));
    assert.equal(ids.size, chunks.length, 'All chunk IDs should be unique');
  });
});
