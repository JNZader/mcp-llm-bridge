import { decodeBoundedYaml, YAML_SCALAR } from './bounded-yaml.mjs';
import { validateShell } from './posix-shell-validation.mjs';
import { createRootParserRegistry } from './root-api.mjs';

const stop = (code = 'unsupported_syntax') => { throw code; };
const codes = new Set(['invalid_input', 'unsupported_syntax', 'unresolved_execution']);
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const identifier = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const pointer = (key) => key.replace(/~/g, '~0').replace(/\//g, '~1');
function mapping(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value[YAML_SCALAR]) stop('invalid_input');
  if (allowed && Object.keys(value).some((key) => !allowed.includes(key))) stop();
  return value;
}
function text(value, empty = false) {
  if (!value?.[YAML_SCALAR] || (!empty && !value.value.trim())) stop('invalid_input');
  // Schema-sensitive plain scalars are not interchangeable with quoted strings.
  if (value.style === 'plain' && /^(?:null|~|true|false|[-+]?(?:[0-9].*|\.[0-9].*|\.inf)|\.nan)$/i.test(value.value)) stop();
  return value.value;
}
function staticTree(value) {
  if (value?.[YAML_SCALAR]) {
    if (value.value.includes('${{')) stop('unresolved_execution');
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (key.includes('${{')) stop('unresolved_execution');
      staticTree(child);
    }
  }
}
function environment(value) {
  const result = Object.create(null);
  if (value === undefined) return result;
  for (const [key, item] of Object.entries(mapping(value))) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || /^(GITHUB_|RUNNER_)/.test(key)) stop();
    result[key] = text(item, true);
  }
  return result;
}
function directory(value) {
  const path = text(value);
  if (path.startsWith('/') || path.includes('\\') || path.split('/').includes('..') || /[\x00-\x1f]/.test(path)) stop('unresolved_execution');
  return path;
}
function runDefaults(value) {
  if (value === undefined) return {};
  const outer = mapping(value, ['run']);
  const run = mapping(outer.run, ['shell', 'working-directory']);
  const result = {};
  if (run.shell !== undefined) result.shell = text(run.shell);
  if (run['working-directory'] !== undefined) result.directory = directory(run['working-directory']);
  return result;
}
function actionReference(value) {
  const ref = text(value);
  if (ref.startsWith('./')) {
    if (ref.length <= 2 || ref.includes('\\') || ref.split('/').includes('..') || /[\s\x00-\x1f]/.test(ref)) stop();
  } else if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*@[A-Za-z0-9_./-]+$/.test(ref)) stop();
  return ref;
}
function trigger(value) {
  if (value?.[YAML_SCALAR]) { text(value); return; }
  if (Array.isArray(value)) {
    if (!value.length) stop('invalid_input');
    value.forEach((item) => text(item));
    return;
  }
  const events = mapping(value);
  if (!Object.keys(events).length || Object.values(events).some((item) => item !== null)) stop();
}

// Bounded workflow semantics, not remote action admission or executable safety.
// Unsupported execution fields reject the whole root instead of hiding edges.
export const parseGitHubActions = createRootParserRegistry({ github_actions(input) {
  const edges = [];
  const edge = (kind, field, target) => edges.push({ kind, field, target });
  try {
    const decoded = decodeBoundedYaml(decoder.decode(input.bytes), { preserveScalarStyle: true });
    if (decoded.status !== 'decoded') stop('invalid_input');
    staticTree(decoded.value);
    const workflow = mapping(decoded.value, ['name', 'on', 'jobs', 'env', 'defaults']);
    if (workflow.name !== undefined) text(workflow.name);
    trigger(workflow.on);
    const globalEnv = environment(workflow.env);
    const globalDefaults = runDefaults(workflow.defaults);
    const jobs = mapping(workflow.jobs);
    if (!Object.keys(jobs).length) stop('invalid_input');
    for (const [id, value] of Object.entries(jobs)) {
      if (!identifier.test(id)) stop('invalid_input');
      const job = mapping(value, ['name', 'runs-on', 'steps', 'env', 'defaults']);
      if (job.name !== undefined) text(job.name);
      const runner = text(job['runs-on']);
      if (!/^(?:ubuntu|macos)-(?:latest|[0-9]+(?:\.[0-9]+)?)(?:-arm64|-large|-xlarge)?$/.test(runner)) stop('unresolved_execution');
      const env = { ...globalEnv, ...environment(job.env) };
      const defaults = { ...globalDefaults, ...runDefaults(job.defaults) };
      if (!Array.isArray(job.steps) || !job.steps.length) stop('invalid_input');
      const ids = new Set();
      for (const [index, value] of job.steps.entries()) {
        const step = mapping(value, ['name', 'id', 'uses', 'run', 'shell', 'working-directory', 'env']);
        const field = `/jobs/${pointer(id)}/steps/${index}`;
        if (step.name !== undefined) text(step.name);
        if (step.id !== undefined) {
          const id = text(step.id);
          if (!identifier.test(id) || ids.has(id)) stop('invalid_input');
          ids.add(id);
        }
        if ((step.run === undefined) === (step.uses === undefined)) stop('invalid_input');
        edge('environment', `${field}/runs-on`, runner);
        for (const [key, val] of Object.entries({ ...env, ...environment(step.env) })) {
          edge('environment', `${field}/env/${pointer(key)}`, val);
        }
        if (step.uses !== undefined) {
          if (step.shell !== undefined || step['working-directory'] !== undefined) stop();
          edge('entry', `${field}/uses`, actionReference(step.uses));
          continue;
        }
        const shell = step.shell === undefined ? defaults.shell : text(step.shell);
        if (shell !== undefined && !['bash', 'sh'].includes(shell)) stop();
        const template = shell === 'bash' ? 'bash --noprofile --norc -e -o pipefail {0}' : shell === 'sh' ? 'sh -e {0}' : 'bash -e {0} (fallback: sh -e {0})';
        edge('environment', `${field}/shell`, template);
        edge('working_directory', `${field}/working-directory`, step['working-directory'] === undefined ? defaults.directory ?? '.' : directory(step['working-directory']));
        const command = text(step.run);
        const result = validateShell(command);
        if (result.status !== 'parsed') stop(result.diagnostics[0]?.code ?? 'invalid_input');
        edge('command', `${field}/run`, command);
        for (const item of result.edges) edge(item.kind, `${field}/run${item.field}`, item.target);
      }
    }
    return { status: 'parsed', edges, diagnostics: [] };
  } catch (error) {
    return { status: 'rejected', edges: [], diagnostics: [{ code: codes.has(error) ? error : 'invalid_input', line: null, column: null, field: null }] };
  }
} });
