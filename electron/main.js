const { app, BrowserWindow, dialog, ipcMain, net, shell, safeStorage } = require('electron');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');

let mainWindow = null;
let reposCache = [];
let githubAuth = null;
let cachedGitProxy;

function storageDir() {
  return process.env.REPO_STUDIO_HOME || path.join(app.getPath('appData'), 'Repo Studio');
}

function reposDir() {
  return path.join(storageDir(), 'repositories');
}

function metaFile() {
  return path.join(storageDir(), 'repos.json');
}

function authFile() {
  return path.join(storageDir(), 'auth.json');
}

function ensureDirs() {
  fs.mkdirSync(reposDir(), { recursive: true });
}

async function loadGithubAuth() {
  try {
    const raw = JSON.parse(await fsp.readFile(authFile(), 'utf8'));
    if (raw.token && raw.user && safeStorage.isEncryptionAvailable()) {
      githubAuth = {
        token: safeStorage.decryptString(Buffer.from(raw.token, 'base64')),
        user: raw.user
      };
    }
  } catch (err) {
    githubAuth = null;
  }
}

async function saveGithubAuth(auth) {
  ensureDirs();
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('当前系统不支持安全存储 GitHub Token');
  }
  const encrypted = safeStorage.encryptString(auth.token);
  await fsp.writeFile(
    authFile(),
    JSON.stringify({ token: encrypted.toString('base64'), user: auth.user }, null, 2),
    'utf8'
  );
}

async function clearGithubAuth() {
  githubAuth = null;
  try {
    await fsp.unlink(authFile());
  } catch (err) {
    // The auth file may already be absent.
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1080,
    minHeight: 680,
    frame: false,
    title: 'GitHub Repository Manager',
    backgroundColor: '#0d0f12',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('maximize', () => mainWindow.webContents.send('window:maximized', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:maximized', false));
  mainWindow.on('closed', () => { mainWindow = null; });
}

function sendProgress(sender, stage, message) {
  sender.send('repo:progress', { stage, message });
}

function gitAuthArgs() {
  if (!githubAuth || !githubAuth.token) return [];
  const basic = Buffer.from(`x-access-token:${githubAuth.token}`).toString('base64');
  return ['-c', `http.extraHeader=Authorization: Basic ${basic}`];
}

function windowsSystemProxy() {
  try {
    const { execFileSync } = require('child_process');
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
    const enabled = execFileSync('reg.exe', ['query', key, '/v', 'ProxyEnable'], { encoding: 'utf8' });
    if (!/0x1/i.test(enabled)) return '';
    const serverOut = execFileSync('reg.exe', ['query', key, '/v', 'ProxyServer'], { encoding: 'utf8' });
    const match = /ProxyServer\s+REG_SZ\s+(.+)/i.exec(serverOut);
    return match ? match[1].trim() : '';
  } catch (err) {
    return '';
  }
}

function gitProxy() {
  if (cachedGitProxy !== undefined) return cachedGitProxy;
  cachedGitProxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY || '';
  if (!cachedGitProxy && process.platform === 'win32') {
    cachedGitProxy = windowsSystemProxy();
  }
  return cachedGitProxy;
}

function gitProxyArgs() {
  const proxy = gitProxy();
  if (!proxy) return [];
  return ['-c', `http.proxy=${proxy}`, '-c', `https.proxy=${proxy}`];
}

function sanitizeGitWarnings(text) {
  return String(text)
    .replace(/(?:^|\n)[^\n]*?(?:LF|CRLF) will be replaced by (?:CRLF|LF)[^\n]*/gi, '\n')
    .replace(/\n{2,}/g, '\n');
}

function openSafeExternal(url) {
  const value = String(url || '').trim();
  if (!/^https?:\/\//i.test(value)) {
    throw new Error('仅允许打开 http/https 链接');
  }
  return shell.openExternal(value);
}

function shouldUseGithubAuth(args, cwd) {
  if (!githubAuth || !githubAuth.token) return false;
  const joined = args.join(' ').toLowerCase();
  if (joined.includes('github.com')) return true;
  if (cwd) {
    const repo = reposCache.find((item) => path.resolve(item.dir) === path.resolve(cwd));
    const remote = repo ? `${repo.url || ''} ${repo.remote || ''}` : '';
    if (/github\.com/i.test(remote)) return true;
  }
  return false;
}

function runGit(args, cwd, onData) {
  return new Promise((resolve, reject) => {
    const authArgs = shouldUseGithubAuth(args, cwd) ? gitAuthArgs() : [];
    const child = spawn('git', [...gitProxyArgs(), ...authArgs, ...args], { cwd, windowsHide: true });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (onData) onData(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = sanitizeGitWarnings(chunk.toString());
      if (text) {
        stderr += text;
        if (onData) onData(text);
      }
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(stderr.trim() || `git exited with code ${code}`));
      }
    });
  });
}

async function loadRepos() {
  try {
    const raw = await fsp.readFile(metaFile(), 'utf8');
    const parsed = JSON.parse(raw);
    reposCache = Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    reposCache = [];
  }
  return reposCache;
}

async function saveRepos() {
  ensureDirs();
  await fsp.writeFile(metaFile(), JSON.stringify(reposCache, null, 2), 'utf8');
}

function normalizeUrl(raw) {
  return String(raw || '')
    .trim()
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

async function githubFetch(pathname, token, options = {}) {
  let response;
  try {
    response = await net.fetch(`https://api.github.com${pathname}`, {
      method: options.method || 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'GitHub Repository Manager',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
  } catch (err) {
    throw new Error(`GitHub network error: ${err.message}`, { cause: err });
  }
  if (!response.ok) {
    let body = '';
    try {
      body = await response.text();
    } catch (err) {
      body = '';
    }
    throw new Error(`GitHub API ${response.status}: ${body.slice(0, 180)}`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function githubHttpsUrl(raw) {
  const value = String(raw || '').trim().replace(/\/+$/, '').replace(/\.git$/i, '');
  let ownerRepo = '';
  if (/^git@github\.com:/i.test(value)) {
    ownerRepo = value.slice('git@github.com:'.length);
  } else if (/^ssh:\/\/git@github\.com\//i.test(value)) {
    ownerRepo = value.replace(/^ssh:\/\/git@github\.com\//i, '');
  } else if (/^https:\/\/github\.com\//i.test(value)) {
    ownerRepo = value.replace(/^https:\/\/github\.com\//i, '');
  }
  if (!ownerRepo) return '';
  ownerRepo = ownerRepo.replace(/\/+$/, '');
  return `https://github.com/${ownerRepo}.git`;
}

async function githubReposForToken(token) {
  const repos = [];
  for (let page = 1; page <= 3; page += 1) {
    const data = await githubFetch(
      `/user/repos?per_page=100&page=${page}&affiliation=owner,collaborator,organization_member&sort=updated`,
      token
    );
    if (!Array.isArray(data)) break;
    repos.push(...data.map((repo) => ({
      id: repo.id,
      name: repo.name,
      fullName: repo.full_name,
      owner: repo.owner ? repo.owner.login : '',
      private: Boolean(repo.private),
      cloneUrl: repo.clone_url,
      htmlUrl: repo.html_url,
      description: repo.description,
      language: repo.language,
      updatedAt: repo.updated_at,
      defaultBranch: repo.default_branch,
      visibility: repo.visibility || (repo.private ? 'private' : 'public'),
      stars: repo.stargazers_count || 0,
      forks: repo.forks_count || 0,
      license: repo.license ? repo.license.spdx_id || repo.license.name : '',
      archived: Boolean(repo.archived)
    })));
    if (data.length < 100) break;
  }
  return repos;
}

function encodeGithubPath(path) {
  return String(path || '').split('/').map(encodeURIComponent).join('/');
}

function githubCommitMessage(action, path) {
  return `${action} ${path} via GitHub Repository Manager`;
}

function githubRefQuery(ref) {
  return ref ? `?ref=${encodeURIComponent(String(ref))}` : '';
}

async function githubReadRaw(repo, path, token, ref) {
  const data = await githubFetch(
    `/repos/${repo}/contents/${encodeGithubPath(path)}${githubRefQuery(ref)}`,
    token
  );
  if (!data || data.type !== 'file') {
    throw new Error('无法读取云端文件');
  }
  if (!data.content && data.sha) {
    const blob = await githubFetch(`/repos/${repo}/git/blobs/${data.sha}`, token);
    if (blob && blob.encoding === 'base64' && blob.content) {
      return { path: data.path, sha: data.sha, content: blob.content, size: data.size || 0 };
    }
  }
  if (!data.content) {
    throw new Error('云端文件过大，无法通过 Contents API 读取');
  }
  return { path: data.path, sha: data.sha, content: data.content, size: data.size || 0 };
}

async function githubWriteRaw(repo, path, contentBase64, sha, message, token, ref) {
  const body = { message, content: contentBase64 };
  if (sha) body.sha = sha;
  if (ref) body.branch = ref;
  return githubFetch(`/repos/${repo}/contents/${encodeGithubPath(path)}`, token, {
    method: 'PUT',
    body
  });
}

async function githubDeleteRaw(repo, path, sha, message, token, ref) {
  const body = { message, sha };
  if (ref) body.branch = ref;
  return githubFetch(`/repos/${repo}/contents/${encodeGithubPath(path)}`, token, {
    method: 'DELETE',
    body
  });
}

async function githubListEntries(repo, path, token, ref) {
  const base = path
    ? `/repos/${repo}/contents/${encodeGithubPath(path)}`
    : `/repos/${repo}/contents`;
  const url = `${base}${githubRefQuery(ref)}`;
  try {
    const data = await githubFetch(url, token);
    if (Array.isArray(data)) return data;
    if (data && data.type) return [data];
    return [];
  } catch (err) {
    if (/404/i.test(err.message)) return [];
    throw err;
  }
}

async function githubCollectFiles(repo, path, token, ref) {
  const entries = await githubListEntries(repo, path, token, ref);
  const files = [];
  for (const entry of entries) {
    if (entry.type === 'dir') {
      files.push(...await githubCollectFiles(repo, entry.path, token, ref));
    } else if (entry.type === 'file') {
      files.push(entry);
    }
  }
  return files;
}

async function githubUploadLocalPath(repo, source, target, token, ref) {
  const stat = await fsp.stat(source);
  let uploaded = 0;
  const paths = [];
  if (stat.isDirectory()) {
    const entries = await fsp.readdir(source, { withFileTypes: true });
    for (const entry of entries) {
      if (isIgnoredImportName(entry.name)) continue;
      const child = await githubUploadLocalPath(
        repo,
        path.join(source, entry.name),
        target ? `${target}/${entry.name}` : entry.name,
        token,
        ref
      );
      uploaded += child.uploaded;
      paths.push(...child.paths);
    }
  } else {
    const existing = await githubListEntries(repo, target, token, ref);
    const sha = existing.length && existing[0].type === 'file' ? existing[0].sha : null;
    const buffer = await fsp.readFile(source);
    await githubWriteRaw(
      repo,
      target,
      buffer.toString('base64'),
      sha,
      githubCommitMessage('Add', target),
      token,
      ref
    );
    uploaded += 1;
    paths.push(target);
  }
  return { uploaded, paths };
}

async function githubUniquePath(repo, cloudPath, token, ref) {
  const slash = String(cloudPath).lastIndexOf('/');
  const parent = slash === -1 ? '' : cloudPath.slice(0, slash);
  const name = slash === -1 ? cloudPath : cloudPath.slice(slash + 1);
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot) : '';
  const stem = dot > 0 ? name.slice(0, dot) : name;
  let candidate = cloudPath;
  let index = 2;
  while ((await githubListEntries(repo, candidate, token, ref)).length) {
    candidate = parent ? `${parent}/${stem}-${index++}${ext}` : `${stem}-${index++}${ext}`;
  }
  return candidate;
}

async function githubRepoInfo(repo, token) {
  return githubFetch(`/repos/${repo}`, token);
}

async function githubBranchesForRepo(repo, token) {
  const data = await githubFetch(`/repos/${repo}/branches?per_page=100`, token);
  if (!Array.isArray(data)) return [];
  return data.map((branch) => ({
    name: branch.name,
    sha: branch.commit ? branch.commit.sha : '',
    protected: Boolean(branch.protected)
  }));
}

async function githubCommitsForRepo(repo, ref, token) {
  const query = ref ? `&sha=${encodeURIComponent(String(ref))}` : '';
  const data = await githubFetch(`/repos/${repo}/commits?per_page=20${query}`, token);
  if (!Array.isArray(data)) return [];
  return data.map((commit) => ({
    hash: commit.sha,
    shortHash: commit.sha ? commit.sha.slice(0, 7) : '',
    subject: commit.commit ? String(commit.commit.message || '').split('\n')[0] : '',
    author: commit.commit && commit.commit.author ? commit.commit.author.name : '',
    date: commit.commit && commit.commit.author ? commit.commit.author.date : '',
    htmlUrl: commit.html_url || ''
  }));
}

async function githubReadmeForRepo(repo, ref, token) {
  try {
    const data = await githubFetch(`/repos/${repo}/readme${githubRefQuery(ref)}`, token);
    if (!data || !data.content) return '';
    return Buffer.from(data.content, 'base64').toString('utf8');
  } catch (err) {
    if (/404/i.test(err.message)) return '';
    throw err;
  }
}

async function githubTreeRecursive(repo, ref, token) {
  const refValue = String(ref || 'HEAD');
  const data = await githubFetch(
    `/repos/${repo}/git/trees/${encodeURIComponent(refValue)}?recursive=1`,
    token
  );
  if (!data || !Array.isArray(data.tree)) return [];
  return data.tree.map((entry) => ({
    name: String(entry.path || '').split('/').pop(),
    path: entry.path || '',
    kind: entry.type === 'tree' ? 'dir' : 'file',
    size: entry.type === 'tree' ? null : (entry.size || 0),
    sha: entry.sha || '',
    mode: entry.mode || '',
    truncated: Boolean(data.truncated)
  }));
}

async function githubCreateRepo(token, options) {
  const body = {
    name: String(options.name || '').trim(),
    description: String(options.description || ''),
    private: Boolean(options.private),
    auto_init: Boolean(options.autoInit)
  };
  if (!body.name) throw new Error('仓库名称不能为空');
  const gitignore = String(options.gitignoreTemplate || '').trim();
  const license = String(options.licenseTemplate || '').trim();
  if (gitignore && gitignore !== 'None') body.gitignore_template = gitignore;
  if (license && license !== 'None') body.license_template = license;
  const owner = String(options.owner || '').trim();
  const endpoint = owner && owner !== String(options.currentUser || '').trim()
    ? `/orgs/${encodeURIComponent(owner)}/repos`
    : '/user/repos';
  return githubFetch(endpoint, token, { method: 'POST', body });
}

async function githubOrgsForToken(token) {
  const data = await githubFetch('/user/orgs?per_page=100', token);
  if (!Array.isArray(data)) return [];
  return data.map((org) => ({
    login: org.login,
    name: org.name || org.login,
    avatarUrl: org.avatar_url || ''
  }));
}

async function githubGitignoreTemplates(token) {
  const data = await githubFetch('/gitignore/templates', token);
  return Array.isArray(data) ? data : [];
}

async function githubLicenses(token) {
  const data = await githubFetch('/licenses?per_page=100', token);
  if (!Array.isArray(data)) return [];
  return data.map((license) => ({
    key: license.key,
    name: license.name
  }));
}

async function githubUpdateRepo(repo, token, options) {
  const body = {};
  if (options.description !== undefined) body.description = String(options.description || '');
  if (options.private !== undefined) body.private = Boolean(options.private);
  return githubFetch(`/repos/${repo}`, token, { method: 'PATCH', body });
}

async function githubDownloadPath(repo, cloudPath, localPath, ref, token, onProgress) {
  const entries = await githubListEntries(repo, cloudPath, token, ref);
  if (cloudPath && entries.length === 1 && entries[0].type === 'file') {
    const raw = await githubReadRaw(repo, entries[0].path, token, ref);
    const buffer = Buffer.from(raw.content, 'base64');
    await fsp.mkdir(path.dirname(localPath), { recursive: true });
    await fsp.writeFile(localPath, buffer);
    if (onProgress) onProgress(`已下载 ${entries[0].path}`);
    return 1;
  }
  await fsp.mkdir(localPath, { recursive: true });
  let count = 0;
  for (const entry of entries) {
    if (entry.type === 'dir') {
      count += await githubDownloadPath(
        repo,
        entry.path,
        path.join(localPath, entry.name),
        ref,
        token,
        onProgress
      );
    } else {
      const raw = await githubReadRaw(repo, entry.path, token, ref);
      const buffer = Buffer.from(raw.content, 'base64');
      await fsp.writeFile(path.join(localPath, entry.name), buffer);
      count += 1;
      if (onProgress) onProgress(`已下载 ${entry.path}`);
    }
  }
  return count;
}

function repoNameFromUrl(raw) {
  let url = String(raw || '').trim().replace(/\/+$/, '');
  if (url.endsWith('.git')) url = url.slice(0, -4);
  if (url.includes('://')) {
    url = url.split('/').filter(Boolean).pop() || 'repository';
  } else if (url.includes(':')) {
    const pathPart = url.slice(url.lastIndexOf(':') + 1);
    url = pathPart.split('/').filter(Boolean).pop() || pathPart;
  } else {
    url = path.basename(url);
  }
  const clean = url.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim();
  return clean || 'repository';
}

function getRepo(id) {
  return reposCache.find((repo) => repo.id === id);
}

function sanitizeRel(rel) {
  const normalized = String(rel || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
  if (!normalized || normalized === '.') return '';
  const parts = normalized.split('/');
  if (parts.some((part) => part === '..')) {
    throw new Error('非法路径');
  }
  return parts.join('/');
}

function safePath(repo, rel) {
  const root = path.resolve(repo.dir);
  const clean = sanitizeRel(rel);
  const target = path.resolve(root, clean);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error('路径越界');
  }
  return target;
}

function isIgnoredImportName(name) {
  const lower = String(name || '').toLowerCase();
  const ignored = new Set([
    '.git',
    '.gradle',
    '.kotlin',
    'node_modules',
    'dist',
    'build',
    'out',
    '.next',
    '.nuxt',
    '.cache',
    '.parcel-cache',
    '.turbo',
    '.venv',
    'venv',
    'local.properties',
    '__pycache__',
    '.idea',
    '.vscode',
    '.externalnativebuild',
    '.cxx',
    'captures',
    '.ds_store',
    'thumbs.db',
    'coverage',
    '.pytest_cache',
    '.mypy_cache',
    '.ruff_cache'
  ]);
  if (ignored.has(lower)) return true;
  if (/^\.env(\.|$)/.test(lower)) return true;
  return /\.(log|tmp|swp|bak|iml|apk|aab)$/i.test(lower);
}

async function copyPathForImport(source, destination) {
  const stat = await fsp.stat(source);
  if (stat.isDirectory()) {
    await fsp.mkdir(destination, { recursive: true });
    const entries = await fsp.readdir(source, { withFileTypes: true });
    for (const entry of entries) {
      if (isIgnoredImportName(entry.name)) continue;
      await copyPathForImport(path.join(source, entry.name), path.join(destination, entry.name));
    }
  } else {
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    await fsp.copyFile(source, destination);
  }
}

async function branchName(dir) {
  try {
    const { stdout } = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], dir);
    return stdout.trim() || 'detached';
  } catch (err) {
    return 'unknown';
  }
}

async function gitRemote(dir) {
  try {
    const { stdout } = await runGit(['remote', 'get-url', 'origin'], dir);
    return stdout.trim();
  } catch (err) {
    return '';
  }
}

async function isGitIgnored(repo, rel) {
  try {
    await runGit(['check-ignore', '-q', '--', rel], repo.dir);
    return true;
  } catch (err) {
    return false;
  }
}

async function resolveRepoDestination(url, sender) {
  ensureDirs();
  const baseName = repoNameFromUrl(url);
  let candidate = baseName;
  let index = 2;

  while (fs.existsSync(path.join(reposDir(), candidate))) {
    const dir = path.join(reposDir(), candidate);
    const stat = await fsp.stat(dir).catch(() => null);
    if (stat && stat.isDirectory()) {
      const contents = await fsp.readdir(dir);
      if (contents.length === 0) {
        return { dir, name: candidate, existing: false, empty: true };
      }
    }
    const remote = await gitRemote(dir);
    if (remote && normalizeUrl(remote) === normalizeUrl(url)) {
      return { dir, name: candidate, existing: true };
    }
    candidate = `${baseName}-${index++}`;
  }

  return { dir: path.join(reposDir(), candidate), name: candidate, existing: false, empty: false };
}

async function repoInfo(repo) {
  let branch = 'unknown';
  let changed = 0;
  let remote = '';
  try {
    branch = await branchName(repo.dir);
    const status = await gitStatusRaw(repo.dir);
    changed = status.changes.length;
    remote = await gitRemote(repo.dir);
  } catch (err) {
    // Keep the repo visible even if Git state is temporarily unavailable.
  }
  return {
    id: repo.id,
    name: repo.name,
    url: repo.url,
    remote,
    dir: repo.dir,
    branch,
    changed,
    githubFullName: repo.githubFullName || '',
    addedAt: repo.addedAt
  };
}

function parseStatusLine(line) {
  if (line.length < 3) return null;
  const x = line[0];
  const y = line[1];
  let rawPath = line.slice(3);
  let oldPath = null;
  const arrow = rawPath.indexOf(' -> ');
  if (arrow !== -1) {
    oldPath = rawPath.slice(0, arrow);
    rawPath = rawPath.slice(arrow + 4);
  }
  const unquote = (value) => {
    if (value && value[0] === '"' && value[value.length - 1] === '"') {
      try {
        return JSON.parse(value);
      } catch (err) {
        return value.slice(1, -1);
      }
    }
    return value;
  };
  rawPath = unquote(rawPath);
  oldPath = oldPath ? unquote(oldPath) : null;
  rawPath = rawPath.replace(/\/+$/, '');

  let kind = 'modified';
  if (x === '?' || y === '?') kind = 'untracked';
  else if (x === '!' || y === '!') kind = 'ignored';
  else if (x === 'U' || y === 'U') kind = 'conflict';
  else if (x === 'A' || y === 'A') kind = 'added';
  else if (x === 'D' || y === 'D') kind = 'deleted';
  else if (x === 'R' || y === 'R') kind = 'renamed';
  else if (x === 'C' || y === 'C') kind = 'copied';

  return {
    x,
    y,
    path: rawPath,
    oldPath,
    kind,
    staged: x !== ' ' && x !== '?' && x !== '!' && x !== 'U'
  };
}

async function gitStatusRaw(dir) {
  const { stdout } = await runGit(['status', '--porcelain=v1', '--branch'], dir);
  const lines = stdout.split(/\r?\n/).filter(Boolean);
  const branchLine = lines.shift() || '';
  let branch = 'detached';
  let ahead = 0;
  let behind = 0;
  const branchMatch = /^## (?:No commits yet on )?(.+?)(?:\.\.\.| \[|$)/.exec(branchLine);
  if (branchMatch) {
    branch = branchMatch[1] || 'detached';
    const aheadMatch = /ahead (\d+)/.exec(branchLine);
    const behindMatch = /behind (\d+)/.exec(branchLine);
    ahead = aheadMatch ? Number(aheadMatch[1]) : 0;
    behind = behindMatch ? Number(behindMatch[1]) : 0;
  }
  return {
    branch,
    ahead,
    behind,
    changes: lines.map(parseStatusLine).filter(Boolean)
  };
}

async function ensureRepoIdFromDir(dir) {
  const remote = await gitRemote(dir);
  const existing = reposCache.find((repo) => path.resolve(repo.dir) === path.resolve(dir));
  if (existing) return existing;
  const repo = {
    id: crypto.createHash('sha1').update(remote || dir).digest('hex').slice(0, 12),
    name: path.basename(dir),
    url: remote,
    dir,
    addedAt: new Date().toISOString()
  };
  reposCache.push(repo);
  await saveRepos();
  return repo;
}

ipcMain.handle('repo:add', async (event, rawUrl) => {
  const originalUrl = String(rawUrl || '').trim();
  if (!originalUrl) throw new Error('请输入仓库地址');
  let url = originalUrl;
  if (githubAuth) {
    const httpsUrl = githubHttpsUrl(url);
    if (httpsUrl) url = httpsUrl;
  }
  ensureDirs();
  const progress = (text) => sendProgress(event.sender, 'git', text.trim());
  const target = await resolveRepoDestination(url, event.sender);

  if (target.existing) {
    if (githubAuth) {
      const currentRemote = await gitRemote(target.dir);
      const httpsUrl = githubHttpsUrl(currentRemote);
      if (httpsUrl && httpsUrl !== currentRemote) {
        await runGit(['remote', 'set-url', 'origin', httpsUrl], target.dir);
      }
    }
    sendProgress(event.sender, 'sync', '仓库已存在，正在同步');
    await runGit(['pull', '--ff-only'], target.dir, progress);
  } else {
    sendProgress(event.sender, 'clone', '正在克隆仓库');
    await runGit(['clone', '--progress', url, target.dir], reposDir(), progress);
  }

  const repo = await ensureRepoIdFromDir(target.dir);
  repo.url = url;
  await saveRepos();
  return repoInfo(repo);
});

ipcMain.handle('repo:list', async () => {
  ensureDirs();
  await loadRepos();
  return Promise.all(reposCache.map(repoInfo));
});

ipcMain.handle('repo:get', async (event, id) => {
  const repo = getRepo(id);
  if (!repo) throw new Error('仓库不存在');
  return repoInfo(repo);
});

ipcMain.handle('repo:remove', async (event, id) => {
  const repo = getRepo(id);
  if (!repo) throw new Error('仓库不存在');
  const target = path.resolve(repo.dir);
  const base = path.resolve(reposDir());
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error('不允许删除仓库目录之外的路径');
  }
  await fsp.rm(target, { recursive: true, force: true });
  reposCache = reposCache.filter((item) => item.id !== id);
  await saveRepos();
  return { ok: true };
});

ipcMain.handle('repo:tree', async (event, payload) => {
  const repo = getRepo(payload.repoId);
  if (!repo) throw new Error('仓库不存在');
  const root = safePath(repo, payload.path);
  const stat = await fsp.stat(root);
  if (!stat.isDirectory()) throw new Error('目标不是目录');
  const names = await fsp.readdir(root, { withFileTypes: true });
  const entries = [];
  for (const name of names) {
    if (name.name === '.git') continue;
    const rel = payload.path ? `${sanitizeRel(payload.path)}/${name.name}` : name.name;
    const full = path.join(root, name.name);
    const itemStat = await fsp.stat(full);
    entries.push({
      name: name.name,
      path: rel,
      kind: itemStat.isDirectory() ? 'dir' : 'file',
      size: itemStat.isDirectory() ? null : itemStat.size,
      mtime: itemStat.mtimeMs,
      ext: itemStat.isDirectory() ? '' : path.extname(name.name).slice(1).toLowerCase()
    });
  }
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });
  return entries;
});

ipcMain.handle('file:read', async (event, payload) => {
  const repo = getRepo(payload.repoId);
  if (!repo) throw new Error('仓库不存在');
  const full = safePath(repo, payload.path);
  const stat = await fsp.stat(full);
  if (stat.isDirectory()) throw new Error('目录无法作为文件打开');
  if (stat.size > 20 * 1024 * 1024) {
    return { type: 'too-large', size: stat.size, path: payload.path };
  }
  const ext = path.extname(full).slice(1).toLowerCase();
  const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'avif'];
  if (imageExts.includes(ext)) {
    const buffer = await fsp.readFile(full);
    const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
    return {
      type: 'image',
      path: payload.path,
      name: path.basename(full),
      size: stat.size,
      mtime: stat.mtimeMs,
      dataUrl: `data:${mime};base64,${buffer.toString('base64')}`
    };
  }
  const buffer = await fsp.readFile(full);
  if (buffer.includes(0)) {
    return {
      type: 'binary',
      path: payload.path,
      name: path.basename(full),
      size: stat.size,
      mtime: stat.mtimeMs,
      ext
    };
  }
  return {
    type: 'text',
    path: payload.path,
    name: path.basename(full),
    size: stat.size,
    mtime: stat.mtimeMs,
    content: buffer.toString('utf8'),
    ext
  };
});

ipcMain.handle('file:write', async (event, payload) => {
  const repo = getRepo(payload.repoId);
  if (!repo) throw new Error('仓库不存在');
  const full = safePath(repo, payload.path);
  if (String(payload.content || '').length > 20 * 1024 * 1024) {
    throw new Error('文件内容过大');
  }
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, String(payload.content || ''), 'utf8');
  const stat = await fsp.stat(full);
  return { size: stat.size, mtime: stat.mtimeMs };
});

ipcMain.handle('file:mkdir', async (event, payload) => {
  const repo = getRepo(payload.repoId);
  if (!repo) throw new Error('仓库不存在');
  const full = safePath(repo, payload.path);
  await fsp.mkdir(full, { recursive: true });
  return { ok: true };
});

ipcMain.handle('file:rename', async (event, payload) => {
  const repo = getRepo(payload.repoId);
  if (!repo) throw new Error('仓库不存在');
  const from = safePath(repo, payload.from);
  const to = safePath(repo, payload.to);
  await fsp.mkdir(path.dirname(to), { recursive: true });
  await fsp.rename(from, to);
  return { ok: true };
});

ipcMain.handle('file:delete', async (event, payload) => {
  const repo = getRepo(payload.repoId);
  if (!repo) throw new Error('仓库不存在');
  const full = safePath(repo, payload.path);
  const stat = await fsp.stat(full);
  if (stat.isDirectory()) {
    await fsp.rm(full, { recursive: true, force: false });
  } else {
    await fsp.unlink(full);
  }
  return { ok: true };
});

ipcMain.handle('file:duplicate', async (event, payload) => {
  const repo = getRepo(payload.repoId);
  if (!repo) throw new Error('仓库不存在');
  const from = safePath(repo, payload.path);
  const base = path.basename(from);
  const ext = path.extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  const parent = path.dirname(from);
  let candidate = path.join(parent, `${stem}-copy${ext}`);
  let index = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(parent, `${stem}-copy-${index++}${ext}`);
  }
  const stat = await fsp.stat(from);
  if (stat.isDirectory()) {
    await fsp.cp(from, candidate, { recursive: true });
  } else {
    await fsp.copyFile(from, candidate);
  }
  return { ok: true, path: path.relative(repo.dir, candidate).split(path.sep).join('/') };
});

ipcMain.handle('shell:reveal', async (event, payload) => {
  const repo = getRepo(payload.repoId);
  if (!repo) throw new Error('仓库不存在');
  const full = safePath(repo, payload.path || '');
  shell.showItemInFolder(full);
  return { ok: true };
});

ipcMain.handle('shell:open', async (event, payload) => {
  const repo = getRepo(payload.repoId);
  if (!repo) throw new Error('仓库不存在');
  const full = safePath(repo, payload.path);
  const err = await shell.openPath(full);
  if (err) throw new Error(err);
  return { ok: true };
});

ipcMain.handle('git:status', async (event, repoId) => {
  const repo = getRepo(repoId);
  if (!repo) throw new Error('仓库不存在');
  return gitStatusRaw(repo.dir);
});

ipcMain.handle('git:diff', async (event, payload) => {
  const repo = getRepo(payload.repoId);
  if (!repo) throw new Error('仓库不存在');
  const args = ['diff', '--no-color', '--unified=3'];
  if (payload.staged) args.push('--staged');
  if (payload.path) args.push('--', sanitizeRel(payload.path));
  const { stdout } = await runGit(args, repo.dir);
  let stat = '';
  if (!payload.path) {
    try {
      const statResult = await runGit(['diff', '--stat'], repo.dir);
      stat = statResult.stdout;
    } catch (err) {
      stat = '';
    }
  }
  if (payload.path && !stdout.trim()) {
    const status = await gitStatusRaw(repo.dir);
    const change = status.changes.find((item) => item.path === sanitizeRel(payload.path));
    if (change && change.kind === 'untracked') {
      try {
        const full = safePath(repo, payload.path);
        const content = await fsp.readFile(full, 'utf8');
        return { diff: `(未跟踪的新文件)\n${content}`, stat };
      } catch (err) {
        return { diff: '(未跟踪的新文件)', stat };
      }
    }
  }
  return { diff: stdout, stat };
});

ipcMain.handle('git:stage', async (event, payload) => {
  const repo = getRepo(payload.repoId);
  if (!repo) throw new Error('仓库不存在');
  const paths = Array.isArray(payload.paths) ? payload.paths : [payload.path];
  const clean = paths.map((item) => sanitizeRel(item)).filter(Boolean);
  if (!clean.length) return { ok: true };
  const stageable = [];
  for (const rel of clean) {
    const ignored = await isGitIgnored(repo, rel);
    if (!ignored) stageable.push(rel);
  }
  if (stageable.length) {
    await runGit(['add', '--', ...stageable], repo.dir);
  }
  return { ok: true, skipped: clean.length - stageable.length };
});

ipcMain.handle('git:unstage', async (event, payload) => {
  const repo = getRepo(payload.repoId);
  if (!repo) throw new Error('仓库不存在');
  const paths = Array.isArray(payload.paths) ? payload.paths : [payload.path];
  const clean = paths.map((item) => sanitizeRel(item)).filter(Boolean);
  if (!clean.length) return { ok: true };
  await runGit(['restore', '--staged', '--', ...clean], repo.dir);
  return { ok: true };
});

ipcMain.handle('git:commit', async (event, payload) => {
  const repo = getRepo(payload.repoId);
  if (!repo) throw new Error('仓库不存在');
  const message = String(payload.message || '').trim();
  if (!message) throw new Error('提交信息不能为空');
  const { stdout, stderr } = await runGit(['commit', '-m', message], repo.dir);
  return { output: `${stdout}${stderr}`.trim() };
});

ipcMain.handle('git:push', async (event, repoId) => {
  const repo = getRepo(repoId);
  if (!repo) throw new Error('仓库不存在');
  const progress = (text) => sendProgress(event.sender, 'git', text.trim());
  sendProgress(event.sender, 'push', '正在推送');
  try {
    try {
      const result = await runGit(['push'], repo.dir, progress);
      return { output: `${result.stdout}${result.stderr}`.trim() };
    } catch (err) {
      if (/no upstream|tracking branch|fatal/i.test(err.message)) {
        const result = await runGit(['push', '-u', 'origin', 'HEAD'], repo.dir, progress);
        return { output: `${result.stdout}${result.stderr}`.trim() };
      }
      throw err;
    }
  } catch (err) {
    if (/src refspec|does not match any/i.test(err.message)) {
      throw new Error('当前分支还没有提交，请先在 Git 面板填写提交信息并点击“提交”，然后再推送');
    }
    if (/denied to|requested url returned error: 403/i.test(err.message)) {
      throw new Error('GitHub Token 没有推送权限：请使用勾选 repo 权限的 Classic Token，或给 Fine-grained Token 开启 Contents Read and write 权限');
    }
    throw err;
  }
});

ipcMain.handle('git:pull', async (event, repoId) => {
  const repo = getRepo(repoId);
  if (!repo) throw new Error('仓库不存在');
  const progress = (text) => sendProgress(event.sender, 'git', text.trim());
  sendProgress(event.sender, 'pull', '正在拉取');
  const result = await runGit(['pull', '--ff-only'], repo.dir, progress);
  return { output: `${result.stdout}${result.stderr}`.trim() };
});

ipcMain.handle('git:fetch', async (event, repoId) => {
  const repo = getRepo(repoId);
  if (!repo) throw new Error('仓库不存在');
  const progress = (text) => sendProgress(event.sender, 'git', text.trim());
  const result = await runGit(['fetch', '--prune', 'origin'], repo.dir, progress);
  return { output: `${result.stdout}${result.stderr}`.trim() };
});

ipcMain.handle('git:log', async (event, payload) => {
  const repo = getRepo(payload.repoId);
  if (!repo) throw new Error('仓库不存在');
  const format = '%h%x1f%an%x1f%ar%x1f%s%x1f%ad';
  const { stdout } = await runGit([
    'log',
    '--pretty=format:' + format,
    '--date=short',
    '-40'
  ], repo.dir);
  return stdout.split(/\r?\n/).filter(Boolean).map((line) => {
    const [hash, author, relative, subject, date] = line.split('\x1f');
    return { hash, author, relative, subject, date };
  });
});

ipcMain.handle('git:show', async (event, payload) => {
  const repo = getRepo(payload.repoId);
  if (!repo) throw new Error('仓库不存在');
  const { stdout } = await runGit([
    'show',
    '--stat',
    '--format=%h%n%an%n%ad%n%s%n%b',
    '--date=short',
    payload.commit
  ], repo.dir);
  return stdout;
});

ipcMain.handle('git:branches', async (event, repoId) => {
  const repo = getRepo(repoId);
  if (!repo) throw new Error('仓库不存在');
  const localResult = await runGit([
    'branch',
    '--format=%(refname:short)%09%(HEAD)%09%(upstream:track)'
  ], repo.dir);
  const remoteResult = await runGit([
    'branch',
    '-r',
    '--format=%(refname:short)%09%(HEAD)'
  ], repo.dir);
  const local = localResult.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
    const [name, head] = line.split('\t');
    return { name, current: head === '*' };
  });
  const remotes = remoteResult.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
    const [name] = line.split('\t');
    return { name };
  });
  return { local, remotes };
});

ipcMain.handle('git:checkout', async (event, payload) => {
  const repo = getRepo(payload.repoId);
  if (!repo) throw new Error('仓库不存在');
  let branch = String(payload.branch || '').trim();
  if (branch.startsWith('remotes/')) branch = branch.slice('remotes/'.length);
  if (branch.startsWith('origin/')) {
    const localName = branch.slice('origin/'.length);
    try {
      await runGit(['checkout', localName], repo.dir);
    } catch (err) {
      await runGit(['checkout', '-b', localName, branch], repo.dir);
    }
  } else {
    await runGit(['checkout', branch], repo.dir);
  }
  return { ok: true };
});

ipcMain.handle('git:createBranch', async (event, payload) => {
  const repo = getRepo(payload.repoId);
  if (!repo) throw new Error('仓库不存在');
  const name = String(payload.name || '').trim();
  if (!name) throw new Error('分支名不能为空');
  await runGit(['checkout', '-b', name], repo.dir);
  return { ok: true };
});

ipcMain.handle('git:discard', async (event, payload) => {
  const repo = getRepo(payload.repoId);
  if (!repo) throw new Error('仓库不存在');
  const rel = sanitizeRel(payload.path);
  const status = await gitStatusRaw(repo.dir);
  const change = status.changes.find((item) => item.path === rel);
  if (change && change.kind === 'untracked') {
    const full = safePath(repo, rel);
    const stat = await fsp.stat(full);
    if (stat.isDirectory()) {
      await fsp.rm(full, { recursive: true, force: true });
    } else {
      await fsp.unlink(full);
    }
  } else {
    try {
      await runGit(['restore', '--worktree', '--staged', '--', rel], repo.dir);
    } catch (err) {
      await runGit(['restore', '--worktree', '--', rel], repo.dir);
    }
  }
  return { ok: true };
});

ipcMain.handle('git:setRemote', async (event, payload) => {
  const repo = getRepo(payload.repoId);
  if (!repo) throw new Error('仓库不存在');
  const url = String(payload.url || '').trim();
  if (!url) throw new Error('远程地址不能为空');
  await runGit(['remote', 'set-url', 'origin', url], repo.dir);
  repo.url = url;
  await saveRepos();
  return { ok: true };
});

ipcMain.handle('github:login', async (event, rawToken) => {
  const token = String(rawToken || '').trim();
  if (!token) throw new Error('请输入 GitHub Token');
  const user = await githubFetch('/user', token);
  githubAuth = { token, user };
  await saveGithubAuth(githubAuth);
  return user;
});

ipcMain.handle('github:me', async () => {
  return githubAuth ? githubAuth.user : null;
});

ipcMain.handle('github:logout', async () => {
  await clearGithubAuth();
  return { ok: true };
});

ipcMain.handle('github:repos', async () => {
  if (!githubAuth) return [];
  return githubReposForToken(githubAuth.token);
});

ipcMain.handle('github:clone', async (event, remoteRepo) => {
  if (!githubAuth) throw new Error('请先登录 GitHub');
  if (!remoteRepo || !remoteRepo.cloneUrl) throw new Error('仓库信息不完整');
  ensureDirs();
  const progress = (text) => sendProgress(event.sender, 'git', text.trim());
  const target = await resolveRepoDestination(remoteRepo.cloneUrl, event.sender);

  if (target.existing) {
    sendProgress(event.sender, 'sync', '仓库已存在，正在同步');
    await runGit(['pull', '--ff-only'], target.dir, progress);
  } else {
    sendProgress(event.sender, 'clone', `正在克隆 ${remoteRepo.fullName || remoteRepo.name}`);
    await runGit(['clone', '--progress', remoteRepo.cloneUrl, target.dir], reposDir(), progress);
  }

  const repo = await ensureRepoIdFromDir(target.dir);
  repo.url = remoteRepo.cloneUrl;
  repo.githubFullName = remoteRepo.fullName || '';
  await saveRepos();
  return repoInfo(repo);
});

ipcMain.handle('github:tree', async (event, payload) => {
  if (!githubAuth) throw new Error('请先登录 GitHub');
  const repo = String(payload.repo || '');
  const path = sanitizeRel(payload.path || '');
  const ref = String(payload.ref || '');
  const entries = await githubListEntries(repo, path, githubAuth.token, ref);
  return entries.map((entry) => ({
    name: entry.name,
    path: entry.path,
    kind: entry.type === 'dir' ? 'dir' : 'file',
    size: entry.type === 'dir' ? null : (entry.size || 0),
    sha: entry.sha || '',
    mtime: entry.size || 0
  }));
});

ipcMain.handle('github:readFile', async (event, payload) => {
  if (!githubAuth) throw new Error('请先登录 GitHub');
  const repo = String(payload.repo || '');
  const path = sanitizeRel(payload.path || '');
  const ref = String(payload.ref || '');
  const data = await githubFetch(
    `/repos/${repo}/contents/${encodeGithubPath(path)}${githubRefQuery(ref)}`,
    githubAuth.token
  );
  if (!data || data.type === 'dir') throw new Error('目录无法作为文件打开');
  let buffer = null;
  let sha = data.sha || '';
  if (!data.content && data.sha) {
    const blob = await githubFetch(`/repos/${repo}/git/blobs/${data.sha}`, githubAuth.token);
    if (blob && blob.encoding === 'base64' && blob.content) {
      buffer = Buffer.from(blob.content, 'base64');
    }
  } else if (data.content) {
    buffer = Buffer.from(data.content, 'base64');
  }
  if (!buffer) {
    return { type: 'too-large', path, size: data.size || 0 };
  }
  const ext = path.includes('.') ? path.split('.').pop().toLowerCase() : '';
  const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'avif'];
  if (imageExts.includes(ext)) {
    const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
    return {
      type: 'image',
      path,
      name: path.split('/').pop(),
      size: data.size || buffer.length,
      mtime: 0,
      dataUrl: `data:${mime};base64,${buffer.toString('base64')}`,
      sha
    };
  }
  if (buffer.includes(0)) {
    return { type: 'binary', path, name: path.split('/').pop(), size: data.size || buffer.length, mtime: 0, ext, sha };
  }
  return {
    type: 'text',
    path,
    name: path.split('/').pop(),
    size: data.size || buffer.length,
    mtime: 0,
    content: buffer.toString('utf8'),
    ext,
    sha
  };
});

ipcMain.handle('github:writeFile', async (event, payload) => {
  if (!githubAuth) throw new Error('请先登录 GitHub');
  const repo = String(payload.repo || '');
  const path = sanitizeRel(payload.path || '');
  const ref = String(payload.ref || '');
  if (!path) throw new Error('文件路径不能为空');
  const message = String(payload.message || '').trim() || githubCommitMessage('Update', path);
  const result = await githubWriteRaw(
    repo,
    path,
    Buffer.from(String(payload.content || ''), 'utf8').toString('base64'),
    payload.sha || null,
    message,
    githubAuth.token,
    ref
  );
  return { sha: result.content ? result.content.sha : '', path: result.content ? result.content.path : path };
});

ipcMain.handle('github:delete', async (event, payload) => {
  if (!githubAuth) throw new Error('请先登录 GitHub');
  const repo = String(payload.repo || '');
  const path = sanitizeRel(payload.path || '');
  const ref = String(payload.ref || '');
  if (!path) throw new Error('路径不能为空');
  const entries = await githubListEntries(repo, path, githubAuth.token, ref);
  if (!entries.length) throw new Error('云端路径不存在');
  const target = entries[0];
  const files = target.type === 'dir'
    ? await githubCollectFiles(repo, path, githubAuth.token, ref)
    : [target];
  for (const file of files) {
    await githubDeleteRaw(
      repo,
      file.path,
      file.sha,
      githubCommitMessage('Delete', file.path),
      githubAuth.token,
      ref
    );
  }
  return { deleted: files.length };
});

ipcMain.handle('github:rename', async (event, payload) => {
  if (!githubAuth) throw new Error('请先登录 GitHub');
  const repo = String(payload.repo || '');
  const from = sanitizeRel(payload.from || '');
  const to = sanitizeRel(payload.to || '');
  const ref = String(payload.ref || '');
  if (!from || !to) throw new Error('路径不能为空');
  const existing = await githubListEntries(repo, to, githubAuth.token, ref);
  if (existing.length) throw new Error('目标已存在');
  const entries = await githubListEntries(repo, from, githubAuth.token, ref);
  if (!entries.length) throw new Error('云端路径不存在');
  const target = entries[0];
  const files = target.type === 'dir'
    ? await githubCollectFiles(repo, from, githubAuth.token, ref)
    : [target];
  let moved = 0;
  for (const file of files) {
    const raw = await githubReadRaw(repo, file.path, githubAuth.token, ref);
    const newPath = target.type === 'dir'
      ? `${to}${file.path.slice(from.length)}`
      : to;
    await githubWriteRaw(
      repo,
      newPath,
      raw.content,
      null,
      githubCommitMessage('Rename', newPath),
      githubAuth.token,
      ref
    );
    await githubDeleteRaw(
      repo,
      file.path,
      file.sha,
      githubCommitMessage('Rename', file.path),
      githubAuth.token,
      ref
    );
    moved += 1;
  }
  return { moved };
});

ipcMain.handle('github:duplicate', async (event, payload) => {
  if (!githubAuth) throw new Error('请先登录 GitHub');
  const repo = String(payload.repo || '');
  const path = sanitizeRel(payload.path || '');
  const ref = String(payload.ref || '');
  if (!path) throw new Error('路径不能为空');
  const targetPath = await githubUniquePath(repo, path, githubAuth.token, ref);
  const entries = await githubListEntries(repo, path, githubAuth.token, ref);
  if (!entries.length) throw new Error('云端路径不存在');
  const target = entries[0];
  const files = target.type === 'dir'
    ? await githubCollectFiles(repo, path, githubAuth.token, ref)
    : [target];
  let copied = 0;
  for (const file of files) {
    const raw = await githubReadRaw(repo, file.path, githubAuth.token, ref);
    const newPath = target.type === 'dir'
      ? `${targetPath}${file.path.slice(path.length)}`
      : targetPath;
    await githubWriteRaw(
      repo,
      newPath,
      raw.content,
      null,
      githubCommitMessage('Copy', newPath),
      githubAuth.token,
      ref
    );
    copied += 1;
  }
  return { path: targetPath, copied };
});

ipcMain.handle('github:upload', async (event, payload) => {
  if (!githubAuth) throw new Error('请先登录 GitHub');
  const repo = String(payload.repo || '');
  const destination = sanitizeRel(payload.destination || '');
  const ref = String(payload.ref || '');
  const sourcePaths = Array.isArray(payload.paths) ? payload.paths : [];
  let uploaded = 0;
  const uploadedPaths = [];
  for (const rawSource of sourcePaths) {
    const source = path.resolve(String(rawSource || ''));
    const stat = await fsp.stat(source).catch(() => null);
    if (!stat) continue;
    const name = path.basename(source);
    if (isIgnoredImportName(name)) continue;
    const result = await githubUploadLocalPath(
      repo,
      source,
      destination ? `${destination}/${name}` : name,
      githubAuth.token,
      ref
    );
    uploaded += result.uploaded;
    uploadedPaths.push(...result.paths);
  }
  return { uploaded, paths: uploadedPaths };
});

ipcMain.handle('github:repo', async (event, payload) => {
  if (!githubAuth) throw new Error('请先登录 GitHub');
  const repo = String(payload.repo || '');
  return githubRepoInfo(repo, githubAuth.token);
});

ipcMain.handle('github:branches', async (event, payload) => {
  if (!githubAuth) throw new Error('请先登录 GitHub');
  const repo = String(payload.repo || '');
  return githubBranchesForRepo(repo, githubAuth.token);
});

ipcMain.handle('github:commits', async (event, payload) => {
  if (!githubAuth) throw new Error('请先登录 GitHub');
  const repo = String(payload.repo || '');
  const ref = String(payload.ref || '');
  return githubCommitsForRepo(repo, ref, githubAuth.token);
});

ipcMain.handle('github:readme', async (event, payload) => {
  if (!githubAuth) throw new Error('请先登录 GitHub');
  const repo = String(payload.repo || '');
  const ref = String(payload.ref || '');
  return githubReadmeForRepo(repo, ref, githubAuth.token);
});

ipcMain.handle('github:searchTree', async (event, payload) => {
  if (!githubAuth) throw new Error('请先登录 GitHub');
  const repo = String(payload.repo || '');
  const ref = String(payload.ref || '');
  return githubTreeRecursive(repo, ref, githubAuth.token);
});

ipcMain.handle('github:orgs', async () => {
  if (!githubAuth) throw new Error('请先登录 GitHub');
  return githubOrgsForToken(githubAuth.token);
});

ipcMain.handle('github:gitignoreTemplates', async () => {
  if (!githubAuth) throw new Error('请先登录 GitHub');
  return githubGitignoreTemplates(githubAuth.token);
});

ipcMain.handle('github:licenses', async () => {
  if (!githubAuth) throw new Error('请先登录 GitHub');
  return githubLicenses(githubAuth.token);
});

ipcMain.handle('github:createRepo', async (event, payload) => {
  if (!githubAuth) throw new Error('请先登录 GitHub');
  return githubCreateRepo(githubAuth.token, payload || {});
});

ipcMain.handle('github:updateRepo', async (event, payload) => {
  if (!githubAuth) throw new Error('请先登录 GitHub');
  const repo = String(payload.repo || '');
  if (!repo) throw new Error('仓库不能为空');
  return githubUpdateRepo(repo, githubAuth.token, payload.options || {});
});

ipcMain.handle('github:download', async (event, payload) => {
  if (!githubAuth) throw new Error('请先登录 GitHub');
  const repo = String(payload.repo || '');
  const cloudPath = sanitizeRel(payload.path || '');
  const ref = String(payload.ref || '');
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择下载位置',
    defaultPath: app.getPath('downloads'),
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || !result.filePaths || !result.filePaths.length) {
    return { canceled: true };
  }
  const entries = await githubListEntries(repo, cloudPath, githubAuth.token, ref);
  const baseName = cloudPath ? String(cloudPath).split('/').pop() : String(repo).split('/').pop();
  const targetPath = path.join(result.filePaths[0], baseName || 'repo');
  const progress = (text) => sendProgress(event.sender, 'download', text.trim());
  const count = await githubDownloadPath(repo, cloudPath, targetPath, ref, githubAuth.token, progress);
  return { canceled: false, count, path: targetPath };
});

ipcMain.handle('shell:openWeb', async (event, url) => {
  await openSafeExternal(url);
  return { ok: true };
});

ipcMain.handle('import:paths', async (event, payload) => {
  const repo = getRepo(payload.repoId);
  if (!repo) throw new Error('仓库不存在');
  const destination = safePath(repo, payload.destination || '');
  const destinationStat = await fsp.stat(destination).catch(() => null);
  if (!destinationStat || !destinationStat.isDirectory()) throw new Error('导入目标不是目录');
  const sourcePaths = Array.isArray(payload.paths) ? payload.paths : [];
  if (!sourcePaths.length) return { imported: [] };

  const imported = [];
  for (const rawSource of sourcePaths) {
    const source = path.resolve(String(rawSource || ''));
    const stat = await fsp.stat(source).catch(() => null);
    if (!stat) continue;
    const name = path.basename(source);
    if (isIgnoredImportName(name)) continue;
    const relPath = payload.destination
      ? `${sanitizeRel(payload.destination)}/${name}`
      : name;
    if (await isGitIgnored(repo, relPath)) continue;
    if (destination.startsWith(source + path.sep)) {
      throw new Error('不能将文件夹导入到它自身内部');
    }

    let candidate = path.join(destination, name);
    let index = 2;
    while (fs.existsSync(candidate)) {
      const ext = stat.isDirectory() ? '' : path.extname(name);
      const stem = ext ? name.slice(0, -ext.length) : name;
      candidate = path.join(destination, `${stem}-${index++}${ext}`);
    }

    await copyPathForImport(source, candidate);
    imported.push(path.relative(repo.dir, candidate).split(path.sep).join('/'));
  }

  return { imported };
});

ipcMain.on('window:minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window:maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.on('window:close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.handle('window:isMaximized', () => {
  return mainWindow ? mainWindow.isMaximized() : false;
});

app.whenReady().then(async () => {
  app.setAppUserModelId('com.githubrepositorymanager.desktop');
  ensureDirs();
  await loadRepos();
  await loadGithubAuth();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
