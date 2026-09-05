import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// @ts-expect-error Deliberate ESM JavaScript contract module.
import { decodeDockerfile } from '../contracts/scanner/dockerfile.mjs';

interface Instruction { instruction: string; argument: string; form: string; argv: string[] | null; startLine: number; endLine: number }
function decoded(source: string): Instruction[] {
  const result = decodeDockerfile(source);
  assert.equal(result.status, 'decoded', JSON.stringify(result));
  assert.equal(Object.hasOwn(result, 'edges'), false);
  return result.instructions;
}
function rejected(source: string) {
  const result = decodeDockerfile(source);
  assert.equal(result.status, 'rejected', source);
  assert.deepEqual(result.instructions, []);
  assert.doesNotMatch(JSON.stringify(result), /secret-canary/);
}

describe('SCAN-ROOT-DOCKER lexical component, not root admission', () => {
  it('decodes every required instruction while retaining ordered source spans and forms', () => {
    const source = 'FROM base AS build\nRUN echo ok\nCMD ["--serve"]\nENTRYPOINT ["node","index.js"]\nCOPY ["source file","/app/"]\nADD archive.tar /app/\nWORKDIR /app\nUSER 1000:1000\nENV MODE=production\n';
    const items = decoded(source);
    assert.deepEqual(items.map((item) => item.instruction), ['FROM', 'RUN', 'CMD', 'ENTRYPOINT', 'COPY', 'ADD', 'WORKDIR', 'USER', 'ENV']);
    assert.equal(items[1]?.form, 'shell');
    assert.deepEqual(items[2]?.argv, ['--serve']);
    assert.equal(items[8]?.startLine, 9);
  });
  it('honors backslash/backtick continuation, strips full-line comments and preserves argument whitespace', () => {
    const source = '# escape=`\nFROM base\nRUN echo `\n# intervening comment\n  "hello world"\n';
    const items = decoded(source);
    assert.equal(items[1]?.argument, 'echo   "hello world"');
    assert.deepEqual([items[1]?.startLine, items[1]?.endLine], [3, 5]);
    assert.equal(decoded('FROM base\nRUN echo \\\nnext')[1]?.argument, 'echo next');
    assert.equal(decoded('FROM base\r\nRUN echo "# literal"\r\n')[1]?.argument, 'echo "# literal"');
  });
  it('preserves JSON exec argv literally rather than invoking shell expansion or splitting', () => {
    const argv = ['echo', '$HOME', '$(touch sentinel)', 'a;b', 'a b', '\\', '"'];
    for (const instruction of ['RUN', 'CMD', 'ENTRYPOINT', 'COPY', 'ADD']) {
      assert.deepEqual(decoded(`FROM base\n${instruction} ${JSON.stringify(argv)}`)[1]?.argv, argv);
    }
    assert.equal(decoded('FROM base\nCMD echo "$HOME"')[1]?.form, 'shell');
    assert.equal(decoded('FROM base\nENTRYPOINT echo ok')[1]?.form, 'shell');
  });
  it('retains supported static flags for later stage/path resolution without claiming semantic admission', () => {
    const result = decodeDockerfile('FROM --platform=linux/amd64 base AS build\nCOPY --from=build --chown=1000:1000 --chmod=0755 /out /app\n');
    assert.equal(result.status, 'decoded');
    assert.equal(result.instructions[1].flags.from, 'build');
    assert.equal(result.instructions[1].flags.chmod, '0755');
    // The lexical result cannot resolve stage identity or environment references.
    assert.equal(decodeDockerfile('FROM $BASE\nCOPY $SOURCE /app').status, 'decoded');
  });
  it('rejects malformed JSON, unknown flags/instructions, heredocs and directive ambiguity atomically', () => {
    for (const suffix of ['RUN ["echo",]', 'CMD [{"x":1,"x":2}]', 'CMD [1]', 'COPY ["a",null]', 'RUN --mount=type=secret echo ok',
      'COPY --from=a --from=b /x /y', 'COPY --unknown=x /a /b', 'ONBUILD RUN echo secret-canary', 'SHELL ["pwsh"]',
      'RUN <<EOF\nsecret-canary\nEOF', 'COPY <<EOF /file\nsecret-canary\nEOF', '# escape=`\nRUN echo ok']) rejected(`FROM base\n${suffix}`);
    for (const source of ['', '\ufeffFROM base', '# escape=bad\nFROM base', '# escape=\\\n# escape=\\\nFROM base',
      '# syntax=custom/frontend\nFROM base', 'FROM base\nRUN echo \\', 'FROM base\rRUN echo ok']) rejected(source);
  });
});
