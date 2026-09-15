import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { canonicalizeJcs } from '../outward-scanner.mjs';
import { YAML_SCALAR } from './bounded-yaml.mjs';
import { composeText, composeCommand, decodeComposeValues, isComposeNull } from './compose-values.mjs';
import { validateShell } from './posix-shell-validation.mjs';
import { createRootParserRegistry } from './root-api.mjs';

const stop = (code = 'unresolved_execution') => { throw code; };
const hash = (value) => `sha256:${createHash('sha256').update(canonicalizeJcs(value)).digest('hex')}`;
const identifier = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const strings = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string' && !item.includes('\0'));
function map(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value[YAML_SCALAR]) stop('invalid_input');
  if (keys && Object.keys(value).some((key) => !keys.includes(key))) stop('unsupported_syntax');
  return value;
}
function local(value, base = '.') {
  if (!value || value.startsWith('/') || /[\x00-\x1f\\~:$*?]/.test(value) || value.split('/').includes('..')) stop();
  return posix.normalize(posix.join(base, value));
}
function containerPath(value) {
  if (!value.startsWith('/') || /[\x00-\x1f\\$]/.test(value) || value.split('/').includes('..')) stop();
  return posix.normalize(value);
}
function boolean(value) {
  if (!value?.[YAML_SCALAR] || value.style !== 'plain' || !['true', 'false'].includes(value.value)) stop('invalid_input');
  return value.value === 'true';
}
function envText(value) {
  if (value?.[YAML_SCALAR] && value.style === 'plain' && /^-?(?:0|[1-9][0-9]*)$/.test(value.value)) return value.value;
  return composeText(value);
}

// resolveConfig is separately installed trusted composition, never YAML data.
// It admits immutable image/build-result metadata for the normalized subject.
// Consistency hashes below do not perform upstream admission or fetch images.
export function createComposeParser({ resolveConfig } = {}) {
  return createRootParserRegistry({ compose(input) {
    const edges = [];
    const edge = (kind, field, target) => edges.push({ kind, field, target });
    try {
      const decoded = decodeComposeValues(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(input.bytes));
      if (decoded.status !== 'decoded') stop('invalid_input');
      const root = map(decoded.value, ['services', 'volumes']);
      const services = map(root.services);
      const volumes = root.volumes === undefined ? {} : map(root.volumes);
      for (const [name, value] of Object.entries(volumes)) if (!identifier.test(name) || !isComposeNull(value)) stop();
      if (!Object.keys(services).length) stop('invalid_input');
      const networkParents = new Map();
      const base = posix.dirname(input.path);
      for (const [name, value] of Object.entries(services)) {
        if (!identifier.test(name)) stop('invalid_input');
        const service = map(value, ['image', 'build', 'command', 'entrypoint', 'volumes', 'network_mode', 'user', 'working_dir', 'environment']);
        const field = `/services/${name}`;
        if ((service.image === undefined) === (service.build === undefined)) stop();
        let subject;
        if (service.image !== undefined) {
          const reference = composeText(service.image);
          if (!reference || /[\s$\\]/.test(reference)) stop();
          subject = { kind: 'image', reference };
        } else {
          const build = service.build?.[YAML_SCALAR] ? { context: service.build } : map(service.build, ['context', 'dockerfile', 'target']);
          const context = local(build.context === undefined ? '.' : composeText(build.context), base);
          const dockerfile = local(build.dockerfile === undefined ? 'Dockerfile' : composeText(build.dockerfile), context);
          const target = build.target === undefined ? null : composeText(build.target);
          if (target !== null && !identifier.test(target)) stop();
          subject = { kind: 'build', context, dockerfile, target };
          edge('entry', `${field}/build/dockerfile`, dockerfile);
          edge('working_directory', `${field}/build/context`, context);
        }
        if (typeof resolveConfig !== 'function') stop('parser_unavailable');
        const admitted = resolveConfig(structuredClone(subject));
        if (!admitted || admitted.schema !== 'wp00-compose-config/v1' || canonicalizeJcs(admitted.subject) !== canonicalizeJcs(subject) ||
          !/^sha256:[0-9a-f]{64}$/.test(admitted.imageDigest) || admitted.configHash !== hash(admitted.config) ||
          admitted.bindingHash !== hash({ subject, imageDigest: admitted.imageDigest, configHash: admitted.configHash })) stop();
        if (subject.kind === 'image' && subject.reference.includes('@') && subject.reference.split('@')[1] !== admitted.imageDigest) stop();
        const config = structuredClone(admitted.config);
        if (Object.keys(map(config)).sort().join(',') !== 'cmd,entrypoint,env,healthcheck,os,user,volumes,workingDir' || config.os !== 'linux' ||
          !strings(config.entrypoint) || !strings(config.cmd) || !strings(config.volumes) || config.volumes.length || config.healthcheck !== null ||
          typeof config.user !== 'string' || typeof config.workingDir !== 'string') stop();
        const env = { ...map(config.env) };
        if (Object.entries(env).some(([key, val]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof val !== 'string' || val.includes('\0'))) stop();
        edge('image', `${field}/image`, admitted.imageDigest);
        edge('environment', `${field}/subject`, canonicalizeJcs(subject));
        if (service.environment !== undefined) {
          const entries = Array.isArray(service.environment) ? service.environment.map((item) => {
            const text = composeText(item), equal = text.indexOf('=');
            if (equal < 1) stop();
            return [text.slice(0, equal), text.slice(equal + 1)];
          }) : Object.entries(map(service.environment)).map(([key, val]) => [key, envText(val)]);
          const seen = new Set();
          for (const [key, val] of entries) {
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || seen.has(key)) stop();
            seen.add(key); env[key] = val;
          }
        }
        for (const [key, val] of Object.entries(env)) edge('environment', `${field}/environment/${key}`, val);
        const user = service.user === undefined ? config.user : envText(service.user);
        if (user && !/^[A-Za-z0-9_.-]+(?::[A-Za-z0-9_.-]+)?$/.test(user)) stop();
        edge('environment', `${field}/user`, user);
        edge('working_directory', `${field}/working_dir`, containerPath(service.working_dir === undefined ? config.workingDir : composeText(service.working_dir)));
        const entrypoint = composeCommand(service.entrypoint);
        const command = composeCommand(service.command);
        const argv = [...(entrypoint ?? config.entrypoint), ...(command ?? (entrypoint === null ? config.cmd : []))];
        if (argv.length) {
          const checked = validateShell(argv.map((arg) => `'${arg.replace(/'/g, "'\\''")}'`).join(' '));
          if (checked.status !== 'parsed') stop(checked.diagnostics[0].code);
          for (const item of checked.edges) if (item.kind !== 'command') edge(item.kind, `${field}/execution${item.field}`, item.target);
        }
        edge('command', `${field}/argv`, JSON.stringify(argv));
        const network = service.network_mode === undefined ? 'compose-default' : composeText(service.network_mode);
        if (service.network_mode !== undefined && network === 'compose-default') stop();
        if (network.startsWith('service:')) {
          const dependency = network.slice(8);
          if (!Object.hasOwn(services, dependency)) stop();
          networkParents.set(name, dependency);
        } else if (!['compose-default', 'host', 'none', 'bridge'].includes(network)) stop();
        edge('environment', `${field}/network_mode`, network);
        if (service.volumes === undefined) continue;
        if (!Array.isArray(service.volumes)) stop('invalid_input');
        const targets = new Set();
        for (const [index, item] of service.volumes.entries()) {
          let type, source, target, readOnly = false, createHostPath = true;
          if (item?.[YAML_SCALAR]) {
            const parts = composeText(item).split(':');
            if (parts.length > 3) stop();
            if (parts.length === 1) { type = 'volume'; target = parts[0]; source = null; }
            else {
              [source, target] = parts;
              type = source.startsWith('.') || source.startsWith('/') ? 'bind' : 'volume';
              if (parts[2] !== undefined && !['ro', 'rw'].includes(parts[2])) stop();
              readOnly = parts[2] === 'ro';
            }
          } else {
            const mount = map(item, ['type', 'source', 'target', 'read_only', 'bind']);
            type = composeText(mount.type); target = composeText(mount.target);
            source = mount.source === undefined ? null : composeText(mount.source);
            if (mount.read_only !== undefined) readOnly = boolean(mount.read_only);
            if (mount.bind !== undefined) {
              if (type !== 'bind') stop();
              const bind = map(mount.bind, ['create_host_path']);
              if (bind.create_host_path !== undefined) createHostPath = boolean(bind.create_host_path);
            }
          }
          target = containerPath(target);
          if (targets.has(target)) stop('ambiguous_structure');
          targets.add(target);
          if (type === 'bind') source = local(source, base);
          else if (type === 'volume') { if (source !== null && (!identifier.test(source) || !Object.hasOwn(volumes, source))) stop(); }
          else if (type !== 'tmpfs' || source !== null) stop();
          edge('mount', `${field}/volumes/${index}`, canonicalizeJcs({ type, source, target, readOnly, createHostPath: type === 'bind' ? createHostPath : null }));
        }
      }
      for (const start of networkParents.keys()) {
        const seen = new Set();
        for (let name = start; networkParents.has(name); name = networkParents.get(name)) {
          if (seen.has(name)) stop();
          seen.add(name);
        }
      }
      return { status: 'parsed', edges, diagnostics: [] };
    } catch (error) {
      const candidate = typeof error === 'string' ? error : error?.code;
      const code = ['invalid_input', 'unresolved_execution', 'unsupported_syntax', 'ambiguous_structure', 'parser_unavailable'].includes(candidate) ? candidate : 'unresolved_execution';
      return { status: 'rejected', edges: [], diagnostics: [{ code, line: null, column: null, field: null }] };
    }
  } });
}

export const parseCompose = createComposeParser();
