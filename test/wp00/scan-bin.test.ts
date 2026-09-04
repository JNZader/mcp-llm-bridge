import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
// @ts-expect-error Deliberate ESM JavaScript contract module.
import { canonicalizeJcs, createArtifactHash, createBindingHash, decodePathsBin, encodePathsBin, parseJsonWithoutDuplicateKeys } from '../contracts/outward-scanner.mjs';

const hash=(s:string)=>new Uint8Array(createHash('sha256').update(s).digest());
const rec=(path='a.ts',mode=0o100644,length:unknown=1n)=>({path,mode,length,sha256:hash(path)});
const reject=(fn:()=>unknown)=>assert.throws(fn);

describe('SCAN-BIN',()=>{
  it('SCAN-BIN-01 encodes exact big-endian header, offsets, mode, uint64 length, and raw SHA-256',()=>{
    const b=encodePathsBin([rec()]);
    assert.equal(b.toString('hex'),'5750303050544800000100000000000100000004612e7473000081a400000000000000010d18d4eb377a214157ad45e7ee0f189a2d7370788a483e729c7f269d94cafe41');
    assert.equal(b.subarray(0,8).toString('ascii'),'WP00PTH\0'); assert.equal(b.readUInt16BE(8),1); assert.equal(b.readUInt16BE(10),0); assert.equal(b.readUInt32BE(12),1);
    assert.equal(b.readUInt32BE(16),4); assert.equal(b.readUInt32BE(24),0o100644); assert.equal(b.readBigUInt64BE(28),1n); assert.deepEqual(b.subarray(36,68),Buffer.from(hash('a.ts')));
  });
  it('SCAN-BIN-02 deterministically sorts unsigned UTF-8 paths, rejects duplicates, and round-trips',()=>{
    const a=encodePathsBin([rec('z.ts',0o100755,2n),rec('é.ts',0o120000,3n),rec()]),b=encodePathsBin([rec(),rec('z.ts',0o100755,2n),rec('é.ts',0o120000,3n)]);
    assert.deepEqual(a,b); assert.deepEqual(decodePathsBin(a).map((x:{path:string;mode:number;length:bigint})=>[x.path,x.mode,x.length]),[['a.ts',0o100644,1n],['z.ts',0o100755,2n],['é.ts',0o120000,3n]]); reject(()=>encodePathsBin([rec(),rec()]));
  });
  it('SCAN-BIN-03 rejects every header and record truncation boundary and trailing bytes',()=>{
    const b=encodePathsBin([rec()]); for(let i=0;i<b.length;i+=1)reject(()=>decodePathsBin(b.subarray(0,i))); reject(()=>decodePathsBin(Buffer.concat([b,Buffer.from([0])])));
  });
  it('SCAN-BIN-04 rejects NUL, absolute, dot, traversal, slash, and backslash paths without normalization',()=>{
    for(const p of ['', '/x','.', './x','a//b','a/../b','a/./b','a\\b','a\0b'])reject(()=>encodePathsBin([rec(p)]));
    assert.deepEqual(decodePathsBin(encodePathsBin([rec('e\u0301.ts'),rec('é.ts')])).map((x:{path:string})=>x.path),['e\u0301.ts','é.ts']);
  });
  it('SCAN-BIN-05 allows only Git modes 100644, 100755, and 120000',()=>{
    for(const mode of [0o100644,0o100755,0o120000])assert.equal(decodePathsBin(encodePathsBin([rec('x',mode)]))[0].mode,mode);
    for(const mode of [0o100600,0o100664,0o040000,0o160000])reject(()=>encodePathsBin([rec('x',mode)]));
  });
  it('SCAN-BIN-06 preserves uint64 endpoints and rejects invalid numeric, type, and overflow lengths',()=>{
    for(const n of [0n,0xffff_ffff_ffff_ffffn])assert.equal(decodePathsBin(encodePathsBin([rec('x',0o100644,n)]))[0].length,n);
    for(const n of [-1n,0x1_0000_0000_0000_0000n,1.5,NaN,{}])reject(()=>encodePathsBin([rec('x',0o100644,n)]));reject(()=>encodePathsBin([{...rec('x'),length:undefined}]));
  });
  it('SCAN-BIN-07 rejects malformed UTF-8 and isolated surrogates but accepts supplementary scalars',()=>{
    const b=Buffer.from(encodePathsBin([rec()]));b[20]=0xff;reject(()=>decodePathsBin(b));for(const p of ['x\ud800','x\udc00'])reject(()=>encodePathsBin([rec(p)]));assert.equal(decodePathsBin(encodePathsBin([rec('x\ud83d\ude00')]))[0].path,'x\ud83d\ude00');
  });
  it('SCAN-BIN-08 rejects duplicate keys per object while permitting same keys in distinct objects and strings',()=>{
    reject(()=>parseJsonWithoutDuplicateKeys('{"a":1,"a":2}'));assert.deepEqual(parseJsonWithoutDuplicateKeys('{"l":{"a":1},"r":{"a":2},"text":"a: key","items":[{"a":3}]}'),{l:{a:1},r:{a:2},text:'a: key',items:[{a:3}]});
  });
  it('SCAN-BIN-09 rejects strict RFC 8259 syntax failures',()=>{for(const text of ['{"a":}','{"a":1,}','{a:1}','[1,]','true false','"bad'])reject(()=>parseJsonWithoutDuplicateKeys(text));});
  it('SCAN-BIN-10 emits exact RFC 8785 escapes and UTF-16 property order',()=>{
    assert.equal(canonicalizeJcs({'\ud83d\ude00':1,'\ufffd':2,control:'\b\t\n\f\r\u0000\u001f',quote:'"\\'}),'{"control":"\\b\\t\\n\\f\\r\\u0000\\u001f","quote":"\\\"\\\\","😀":1,"�":2}');
  });
  it('SCAN-BIN-11 emits negative zero and integer boundaries while rejecting unsupported JCS values',()=>{
    assert.equal(canonicalizeJcs({max:Number.MAX_SAFE_INTEGER,min:Number.MIN_SAFE_INTEGER,zero:-0}),'{"max":9007199254740991,"min":-9007199254740991,"zero":0}');
    for(const v of [1.5,NaN,Infinity,-Infinity,undefined,()=>0,1n,new Date()])reject(()=>canonicalizeJcs(v));
  });
  it('SCAN-BIN-12 excludes exactly hash fields and matches the known artifact preimage result',()=>{
    const p=encodePathsBin([rec()]),m={schema:'wp00/v1',records:[{path:'a.ts'}],wp00ArtifactHash:'omit',bindingHash:'omit'},expected='sha256:3bbc92b51a1bad0388afe5ce206b2241535bdff02a59676552a116d839a44f4a';
    assert.equal(createArtifactHash(p,m),expected);assert.equal(createArtifactHash(p,{...m,wp00ArtifactHash:'changed',bindingHash:'changed'}),expected);assert.notEqual(createArtifactHash(p,{...m,schema:'wp00/v2'}),createArtifactHash(Buffer.concat([p,Buffer.from([0])]),m));
  });
  it('SCAN-BIN-13 validates raw artifact hash identity and matches the known provider-binding result',()=>{
    const a='sha256:3bbc92b51a1bad0388afe5ce206b2241535bdff02a59676552a116d839a44f4a';assert.equal(createBindingHash('provider-subject-opaque',a),'sha256:679cfdb3da577557964ff44c33e64c9cfd25b951bd23d47a32be70bdb75e14d5');for(const x of ['sha256:ABC','sha256:'+'a'.repeat(63),'bad'])reject(()=>createBindingHash('provider-subject-opaque',x));
  });
  it('SCAN-BIN-14 validates opaque scalar provider subjects and rejects decoded noncanonical order',()=>{
    const b=Buffer.from(encodePathsBin([rec(),rec('z.ts')]));Buffer.from('z.ts').copy(b,20);Buffer.from('a.ts').copy(b,72);reject(()=>decodePathsBin(b));reject(()=>createBindingHash('x\ud800','sha256:'+'a'.repeat(64)));reject(()=>createBindingHash(42 as unknown as string,'sha256:'+'a'.repeat(64)));
  });
  it('SCAN-BIN-15 terminates at EOF for primitives and rejects missing or truncated values', () => {
    const scannerUrl = new URL('../contracts/outward-scanner.mjs', import.meta.url).href;
    const cases = {
      valid: ['true', 'false', 'null', '1', '-1', '1.5', '1e2', ' true ', '[1]', '{"a":1}'],
      invalid: ['', '   ', '[', '[1', '[1,', '{"a":', '{"a":1', '[true', 'tru', '-', '{"a":}'],
    };
    // A synchronous parser regression must time out only this child, not the test runner.
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', `
      import assert from 'node:assert/strict';
      import { parseJsonWithoutDuplicateKeys } from ${JSON.stringify(scannerUrl)};
      const cases = ${JSON.stringify(cases)};
      for (const text of cases.valid) {
        assert.deepEqual(parseJsonWithoutDuplicateKeys(text), JSON.parse(text));
      }
      for (const text of cases.invalid) {
        assert.throws(() => parseJsonWithoutDuplicateKeys(text), /WP00 scanner: invalid JSON/);
      }
    `], { encoding: 'utf8', timeout: 5_000, killSignal: 'SIGKILL' });
    assert.ifError(result.error);
    assert.equal(result.signal, null, `Parser child terminated: ${result.signal}`);
    assert.equal(result.status, 0, result.stderr);
  });
});
