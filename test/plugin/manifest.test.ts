import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');
const readJson = (p: string): any => JSON.parse(read(p));

describe('Claude Code plugin packaging', () => {
  it('plugin.json lives in .claude-plugin/ and is valid with a name', () => {
    const m = readJson('.claude-plugin/plugin.json');
    expect(m.name).toBe('program-design');
    expect(typeof m.description).toBe('string');
    expect(m.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('marketplace.json lists this repo as a single root-sourced plugin', () => {
    const mk = readJson('.claude-plugin/marketplace.json');
    expect(mk.name).toBeTruthy();
    expect(mk.owner && mk.owner.name).toBeTruthy();
    expect(Array.isArray(mk.plugins)).toBe(true);
    const p = mk.plugins.find((x: any) => x.name === 'program-design');
    expect(p, 'a plugin entry named program-design').toBeTruthy();
    // source "./" = the plugin is the repo root (simplest one-repo install)
    expect(p.source).toBe('./');
  });

  it('the install string program-design@<marketplace> resolves (names line up)', () => {
    const plugin = readJson('.claude-plugin/plugin.json');
    const mk = readJson('.claude-plugin/marketplace.json');
    const entry = mk.plugins.find((x: any) => x.name === plugin.name);
    expect(entry, 'marketplace lists a plugin whose name matches plugin.json').toBeTruthy();
  });

  it('the skill auto-discovers at skills/<name>/SKILL.md with activation frontmatter', () => {
    const skill = read('skills/program-design/SKILL.md');
    expect(skill.startsWith('---')).toBe(true);
    expect(skill).toMatch(/\nname:\s*program-design/);
    // the description is the entire auto-activation contract — must be trigger-rich
    expect(skill).toMatch(/\ndescription:/);
    expect(skill).toMatch(/claim time/i);
  });

  it('hooks auto-discover at hooks/hooks.json and reference the bundled script via CLAUDE_PLUGIN_ROOT', () => {
    const hooks = readJson('hooks/hooks.json');
    expect(hooks.hooks.SessionStart).toBeTruthy();
    expect(hooks.hooks.Stop).toBeTruthy();
    const cmd = hooks.hooks.SessionStart[0].hooks[0].command as string;
    expect(cmd).toContain('${CLAUDE_PLUGIN_ROOT}');
    expect(cmd).toContain('scripts/pd-session-start.sh');
  });

  it('the SessionStart script exists and is executable', () => {
    const rel = 'scripts/pd-session-start.sh';
    expect(existsSync(join(ROOT, rel))).toBe(true);
    const mode = statSync(join(ROOT, rel)).mode;
    // owner-execute bit set
    expect(mode & 0o100).toBeTruthy();
  });

  it('the npm files whitelist ships the plugin so npm and the marketplace agree', () => {
    const pkg = readJson('package.json');
    for (const dir of ['skills', 'hooks', 'scripts', '.claude-plugin']) {
      expect(pkg.files, `files[] includes ${dir}`).toContain(dir);
    }
    // plugin.json version tracks the package version
    expect(readJson('.claude-plugin/plugin.json').version).toBe(pkg.version);
  });
});
