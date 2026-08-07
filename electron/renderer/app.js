const api = window.repoAPI;

const state = {
  repos: [],
  currentRepo: null,
  currentPath: '',
  expandedDirs: new Set(['']),
  childrenCache: new Map(),
  statusMap: new Map(),
  gitStatus: { branch: '', ahead: 0, behind: 0, changes: [] },
  gitLog: [],
  branches: { local: [], remotes: [] },
  remote: '',
  editorFile: null,
  editorDirty: false,
  diffView: null,
  gitTab: 'changes',
  dragData: null,
  loadingRepo: false,
  githubUser: null,
  githubRepos: [],
  githubLoading: false,
  externalDragging: false,
  operationDepth: 0,
  activeCloudFullName: '',
  repoFilter: '',
  cloudBranches: [],
  cloudCommits: [],
  cloudRepoInfo: null,
  cloudReadme: '',
  cloudTreeIndex: [],
  repoSearchMode: false
};

const els = {};

function qs(selector) {
  return document.querySelector(selector);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function parentPath(path) {
  const index = String(path).lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

function joinPath(parent, name) {
  const cleanParent = String(parent || '').replace(/\/+$/, '');
  const cleanName = String(name || '').replace(/^\/+/, '');
  return cleanParent ? `${cleanParent}/${cleanName}` : cleanName;
}

function cloudRef() {
  return state.currentRepo && state.currentRepo.cloud
    ? (state.currentRepo.branch || 'main')
    : '';
}

function encodeCloudPath(value) {
  return String(value || '').split('/').map(encodeURIComponent).join('/');
}

function isValidPath(path) {
  const value = String(path || '').replace(/^\/+/, '');
  if (!value || value === '.' || value === '..') return false;
  return !value.split('/').some((part) => !part || part === '.' || part === '..' || /[<>:"|?*\u0000-\u001f]/.test(part));
}

function statusLabel(kind) {
  const labels = {
    untracked: 'untracked',
    added: 'added',
    modified: 'modified',
    deleted: 'deleted',
    renamed: 'renamed',
    copied: 'copied',
    conflict: 'conflict',
    ignored: 'ignored'
  };
  return t(labels[kind] || kind);
}

function statusShort(kind) {
  const map = {
    added: '+',
    untracked: '?',
    modified: 'M',
    deleted: 'D',
    renamed: 'R',
    copied: 'C',
    conflict: '!',
    ignored: '!'
  };
  return map[kind] || '·';
}

function shortRemote(url) {
  const value = String(url || '')
    .replace(/^git@github\.com:/, 'github.com/')
    .replace(/^ssh:\/\/git@github\.com\//, 'github.com/')
    .replace(/^https:\/\/github\.com\//, 'github.com/')
    .replace(/\.git$/, '');
  return value || t('noRemote');
}

function cacheElements() {
  els.accountBtn = qs('#account-btn');
  els.settingsBtn = qs('#settings-btn');
  els.themeBtn = qs('#theme-btn');
  els.titlebarRepo = qs('#titlebar-repo');
  els.createRepoBtn = qs('#create-repo-btn');
  els.newRepoBtn = qs('#new-repo-btn');
  els.repoList = qs('#repo-list');
  els.repoFilter = qs('#repo-filter');
  els.newFileBtn = qs('#new-file-btn');
  els.newFolderBtn = qs('#new-folder-btn');
  els.refreshFilesBtn = qs('#refresh-files-btn');
  els.collapseBtn = qs('#collapse-btn');
  els.cloudToolbar = qs('#cloud-toolbar');
  els.branchSelect = qs('#branch-select');
  els.downloadCurrentBtn = qs('#download-current-btn');
  els.repoSearchBtn = qs('#repo-search-btn');
  els.fileSearch = qs('#file-search');
  els.breadcrumb = qs('#breadcrumb');
  els.filesTree = qs('#files-tree');
  els.workspaceEmpty = qs('#workspace-empty');
  els.workspaceContent = qs('#workspace-content');
  els.filePath = qs('#file-path');
  els.workspaceActions = qs('#workspace-actions');
  els.workspaceBody = qs('#workspace-body');
  els.gitBody = qs('#git-body');
  els.gitTabs = Array.from(document.querySelectorAll('.git-tab'));
  els.statusMessage = qs('#status-message');
  els.statusbar = qs('.statusbar');
  els.statusRepo = qs('#status-repo');
  els.statusCount = qs('#status-count');
  els.modalOverlay = qs('#modal-overlay');
  els.modalTitle = qs('#modal-title');
  els.modalMessage = qs('#modal-message');
  els.modalField = qs('#modal-field');
  els.modalInput = qs('#modal-input');
  els.modalSelect = qs('#modal-select');
  els.modalOk = qs('#modal-ok');
  els.modalCancel = qs('#modal-cancel');
  els.repoFormOverlay = qs('#repo-form-overlay');
  els.settingsOverlay = qs('#settings-overlay');
  els.languageSelect = qs('#language-select');
  els.settingsClose = qs('#settings-close');
  els.repoOwnerSelect = qs('#repo-owner-select');
  els.repoNameInput = qs('#repo-name-input');
  els.repoNameHint = qs('#repo-name-hint');
  els.repoDescInput = qs('#repo-desc-input');
  els.repoReadmeInput = qs('#repo-readme-input');
  els.repoGitignoreSelect = qs('#repo-gitignore-select');
  els.repoLicenseSelect = qs('#repo-license-select');
  els.repoFormCancel = qs('#repo-form-cancel');
  els.repoFormCreate = qs('#repo-form-create');
  els.contextMenu = qs('#context-menu');
  els.mainLayout = qs('.main-layout');
  els.paneResizers = Array.from(document.querySelectorAll('.pane-resizer'));
  els.dropOverlay = qs('#drop-overlay');
  els.dropIcon = qs('#drop-icon');
  els.operationOverlay = qs('#operation-overlay');
  els.operationMessage = qs('#operation-message');
  els.toastStack = qs('#toast-stack');
}

function setStatus(message, kind = 'info') {
  els.statusMessage.textContent = message;
  els.statusbar.dataset.kind = kind;
}

function initTheme() {
  let saved = 'dark';
  try {
    saved = localStorage.getItem('repo-studio-theme') || 'dark';
  } catch (err) {
    saved = 'dark';
  }
  document.body.classList.toggle('theme-light', saved === 'light');
}

function toggleTheme() {
  const isLight = document.body.classList.toggle('theme-light');
  try {
    localStorage.setItem('repo-studio-theme', isLight ? 'light' : 'dark');
  } catch (err) {
    // Theme persistence is best effort.
  }
  els.themeBtn.innerHTML = icon(isLight ? 'sun' : 'moon');
}

function openSettingsModal() {
  els.languageSelect.value = getLanguage();
  els.settingsOverlay.classList.remove('hidden');
}

function closeSettingsModal() {
  els.settingsOverlay.classList.add('hidden');
}

function refreshLanguageUI() {
  applyStaticTranslations();
  setWindowChrome();
  els.fileSearch.placeholder = state.repoSearchMode ? t('searchWholeRepo') : t('filterCurrentDir');
  renderAccountButton();
  renderRepos();
  renderTree();
  renderBreadcrumb();
  renderWorkspace();
  renderGitPanel();
  updateStatusBar();
  updateCloudToolbar();
  if (!els.repoFormOverlay.classList.contains('hidden')) loadRepoCreateOptions();
  setStatus(t('ready'));
}

function initPaneWidths() {
  ['sidebar', 'files', 'git'].forEach((key) => {
    try {
      const value = Number(localStorage.getItem(`repo-studio-${key}-w`));
      if (value > 0) els.mainLayout.style.setProperty(`--${key}-w`, `${value}px`);
    } catch (err) {
      // Width persistence is best effort.
    }
  });
}

function startPaneResize(event) {
  event.preventDefault();
  const handle = event.currentTarget;
  const target = handle.dataset.resizer;
  const panel = target === 'sidebar'
    ? document.querySelector('.repos-sidebar')
    : target === 'files'
      ? document.querySelector('.files-panel')
      : document.querySelector('.git-panel');
  if (!panel) return;
  const min = target === 'sidebar' ? 150 : target === 'files' ? 180 : 240;
  const max = target === 'sidebar' ? 340 : target === 'files' ? 460 : 520;
  const startX = event.clientX;
  const startWidth = panel.getBoundingClientRect().width;

  document.body.classList.add('resizing');
  const onMove = (moveEvent) => {
    const delta = moveEvent.clientX - startX;
    const changed = target === 'git' ? -delta : delta;
    const next = Math.round(Math.min(max, Math.max(min, startWidth + changed)));
    els.mainLayout.style.setProperty(`--${target}-w`, `${next}px`);
  };
  const onUp = () => {
    document.body.classList.remove('resizing');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    try {
      localStorage.setItem(`repo-studio-${target}-w`, String(Math.round(panel.getBoundingClientRect().width)));
    } catch (err) {
      // Width persistence is best effort.
    }
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function showToast(message, kind = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${kind === 'error' ? 'error' : kind === 'info' ? 'info' : ''}`.trim();
  toast.textContent = message;
  els.toastStack.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0.25';
    setTimeout(() => toast.remove(), 240);
  }, 3200);
}

function beginOperation(message = t('processing')) {
  state.operationDepth += 1;
  els.operationMessage.textContent = message;
  els.operationOverlay.classList.remove('hidden');
  setStatus(message, 'busy');
}

function endOperation() {
  state.operationDepth = Math.max(0, state.operationDepth - 1);
  if (state.operationDepth === 0) {
    els.operationOverlay.classList.add('hidden');
  }
}

async function runOperation(message, operation) {
  beginOperation(message);
  try {
    return await operation();
  } finally {
    endOperation();
  }
}

function handleError(title, err) {
  const message = err && err.message ? err.message : String(err || t('unknownError'));
  console.error(err);
  setStatus(`${title}: ${message}`, 'error');
  showToast(message, 'error');
}

function bindEvents() {
  els.accountBtn.addEventListener('click', handleAccountClick);
  els.settingsBtn.addEventListener('click', openSettingsModal);
  els.themeBtn.addEventListener('click', toggleTheme);
  els.createRepoBtn.addEventListener('click', openCreateRepoModal);
  els.newRepoBtn.addEventListener('click', refreshGithubRepos);
  els.paneResizers.forEach((handle) => handle.addEventListener('mousedown', startPaneResize));
  els.newFileBtn.addEventListener('click', () => newFile(state.currentPath));
  els.newFolderBtn.addEventListener('click', () => newFolder(state.currentPath));
  els.refreshFilesBtn.addEventListener('click', refreshFiles);
  els.collapseBtn.addEventListener('click', collapseAll);
  els.repoFilter.addEventListener('input', () => {
    state.repoFilter = els.repoFilter.value.trim().toLowerCase();
    renderRepos();
  });
  els.repoNameInput.addEventListener('input', updateRepoNameHint);
  els.repoNameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submitCreateRepo();
  });
  els.repoDescInput.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') submitCreateRepo();
  });
  els.repoFormCancel.addEventListener('click', closeCreateRepoModal);
  els.repoFormCreate.addEventListener('click', submitCreateRepo);
  els.repoFormOverlay.addEventListener('mousedown', (event) => {
    if (event.target === els.repoFormOverlay) closeCreateRepoModal();
  });
  els.settingsClose.addEventListener('click', closeSettingsModal);
  els.settingsOverlay.addEventListener('mousedown', (event) => {
    if (event.target === els.settingsOverlay) closeSettingsModal();
  });
  els.languageSelect.addEventListener('change', () => {
    setLanguage(els.languageSelect.value);
    refreshLanguageUI();
  });
  els.branchSelect.addEventListener('change', () => {
    if (els.branchSelect.value) switchBranch(els.branchSelect.value);
  });
  els.downloadCurrentBtn.addEventListener('click', downloadCurrentPath);
  els.repoSearchBtn.addEventListener('click', toggleRepoSearch);
  els.fileSearch.addEventListener('input', renderTree);

  qs('#window-min').addEventListener('click', () => api.minimize());
  qs('#window-max').addEventListener('click', () => api.maximize());
  qs('#window-close').addEventListener('click', () => api.close());

  els.repoList.addEventListener('click', (event) => {
    const removeBtn = event.target.closest('.repo-remove');
    if (removeBtn) {
      event.stopPropagation();
      removeRepo(removeBtn.dataset.id);
      return;
    }
    const item = event.target.closest('.repo-item');
    if (item && item.dataset.id) selectRepo(item.dataset.id);
  });
  els.repoList.addEventListener('contextmenu', handleRepoContextMenu);

  els.gitTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      state.gitTab = tab.dataset.tab;
      els.gitTabs.forEach((item) => item.classList.toggle('active', item === tab));
      renderGitPanel();
    });
  });

  els.filesTree.addEventListener('click', handleTreeClick);
  els.filesTree.addEventListener('contextmenu', handleTreeContextMenu);
  els.filesTree.addEventListener('dragstart', handleDragStart);
  els.filesTree.addEventListener('dragover', handleDragOver);
  els.filesTree.addEventListener('dragleave', handleDragLeave);
  els.filesTree.addEventListener('drop', handleDrop);
  els.filesTree.addEventListener('dragend', () => { state.dragData = null; });
  document.addEventListener('dragover', handleExternalDragOver);
  document.addEventListener('dragleave', handleExternalDragLeave);
  document.addEventListener('drop', handleExternalDrop);

  els.breadcrumb.addEventListener('click', async (event) => {
    const crumb = event.target.closest('.crumb');
    if (!crumb) return;
    await setCurrentPath(crumb.dataset.path || '');
  });

  els.workspaceActions.addEventListener('click', handleWorkspaceAction);

  els.gitBody.addEventListener('click', handleGitAction);

  els.modalOk.addEventListener('click', () => {
    const fieldHidden = els.modalField.classList.contains('hidden');
    closeModal(fieldHidden ? true : (els.modalSelect.classList.contains('hidden') ? els.modalInput.value.trim() : els.modalSelect.value));
  });
  els.modalCancel.addEventListener('click', () => closeModal(false));
  els.modalOverlay.addEventListener('mousedown', (event) => {
    if (event.target === els.modalOverlay) closeModal(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (!els.settingsOverlay.classList.contains('hidden')) {
        closeSettingsModal();
        return;
      }
      if (!els.repoFormOverlay.classList.contains('hidden')) {
        closeCreateRepoModal();
        return;
      }
      if (!els.modalOverlay.classList.contains('hidden')) closeModal(false);
      hideContextMenu();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      saveFile();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      els.fileSearch.focus();
      els.fileSearch.select();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      if (event.shiftKey) newFolder(state.currentPath);
      else newFile(state.currentPath);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'r') {
      event.preventDefault();
      refreshFiles();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === ',') {
      event.preventDefault();
      toggleTheme();
    }
  });

  document.addEventListener('mousedown', (event) => {
    if (!els.contextMenu.classList.contains('hidden') && !els.contextMenu.contains(event.target)) {
      hideContextMenu();
    }
  });
}

function setWindowChrome() {
  document.querySelector('.brand-mark').innerHTML = icon('logo');
  qs('#window-min').innerHTML = icon('minus');
  qs('#window-max').innerHTML = icon('square');
  qs('#window-close').innerHTML = icon('x');
  els.accountBtn.innerHTML = icon('cloud');
  els.settingsBtn.innerHTML = icon('settings');
  els.themeBtn.innerHTML = icon(document.body.classList.contains('theme-light') ? 'sun' : 'moon');
  els.createRepoBtn.innerHTML = icon('plus');
  els.newRepoBtn.innerHTML = icon('refresh');
  els.newFileBtn.innerHTML = icon('filePlus');
  els.newFolderBtn.innerHTML = icon('folderPlus');
  els.refreshFilesBtn.innerHTML = icon('refresh');
  els.collapseBtn.innerHTML = icon('chevronUp');
  els.downloadCurrentBtn.innerHTML = icon('download');
  els.repoSearchBtn.innerHTML = icon('search');
  qs('.file-search .search-icon').innerHTML = icon('search');
  qs('.sidebar-search .search-icon').innerHTML = icon('search');
  qs('.empty-mark').innerHTML = icon('logo');
  els.dropIcon.innerHTML = icon('upload');
}

function init() {
  cacheElements();
  bindEvents();
  initLanguage();
  applyStaticTranslations();
  initTheme();
  initPaneWidths();
  setWindowChrome();
  setStatus(t('ready'));
  updateStatusBar();

  api.onProgress(({ stage, message }) => {
    const text = message || stage || '';
    setStatus(text ? `Git: ${text}` : t('synced'), 'busy');
  });

  api.onMaximized(() => {});
  api.isMaximized().catch(() => {});

  loadGithubSession();
}

async function loadRepos(autoSelect = true) {
  try {
    state.repos = await api.listRepos();
    renderRepos();

    const currentStillExists = state.currentRepo && state.repos.some((repo) => repo.id === state.currentRepo.id);
    if (!currentStillExists) {
      if (autoSelect && state.repos.length) {
        await selectRepo(state.repos[0].id);
      } else {
        state.currentRepo = null;
        state.childrenCache.clear();
        state.statusMap.clear();
        renderTree();
        renderBreadcrumb();
        renderGitPanel();
        renderWorkspace();
        updateStatusBar();
      }
    } else {
      state.currentRepo = state.repos.find((repo) => repo.id === state.currentRepo.id);
      renderRepos();
      updateStatusBar();
    }
  } catch (err) {
    handleError(t('loadingReposFailed'), err);
  }
}

function renderRepos() {
  els.repoList.innerHTML = '';

  appendSectionLabel(t('cloudRepos'));
  if (!state.githubUser) {
    appendGithubLoginHint();
  } else if (state.githubLoading) {
    appendSidebarEmpty(t('syncingCloud'));
  } else if (!state.githubRepos.length) {
    appendSidebarEmpty(t('noCloudRepos'));
  } else {
    const filter = state.repoFilter || '';
    const filtered = filter
      ? state.githubRepos.filter((repo) => [
          repo.fullName,
          repo.name,
          repo.owner,
          repo.description,
          repo.language
        ].filter(Boolean).some((value) => String(value).toLowerCase().includes(filter)))
      : state.githubRepos;
    if (!filtered.length) {
      appendSidebarEmpty(t('noMatchingRepos'));
    } else {
      filtered.forEach((repo) => appendCloudRepoItem(repo));
    }
  }
}

function appendSectionLabel(text) {
  const label = document.createElement('div');
  label.className = 'sidebar-section-label';
  label.textContent = text;
  els.repoList.appendChild(label);
}

function appendSidebarEmpty(text) {
  const empty = document.createElement('div');
  empty.className = 'empty-inline';
  empty.textContent = text;
  els.repoList.appendChild(empty);
}

function appendGithubLoginHint() {
  const hint = document.createElement('button');
  hint.className = 'cloud-login-hint';
  hint.innerHTML = `${icon('cloud')}<span>${escapeHtml(t('loginGithub'))}</span>`;
  hint.addEventListener('click', githubLogin);
  els.repoList.appendChild(hint);
}

function appendLocalRepoItem(repo) {
  const item = document.createElement('div');
  item.className = `repo-item${state.currentRepo && state.currentRepo.id === repo.id ? ' active' : ''}`;
  item.dataset.id = repo.id;
  item.title = repo.remote || repo.url || repo.name;

  const iconWrap = document.createElement('div');
  iconWrap.className = 'repo-icon';
  iconWrap.innerHTML = icon('branch');

  const meta = document.createElement('div');
  meta.className = 'repo-meta';
  const name = document.createElement('div');
  name.className = 'repo-name';
  name.textContent = repo.name;
  const sub = document.createElement('div');
  sub.className = 'repo-sub';
  sub.textContent = repo.branch ? `${repo.branch} · ${shortRemote(repo.remote || repo.url)}` : shortRemote(repo.remote || repo.url);
  meta.appendChild(name);
  meta.appendChild(sub);

  item.appendChild(iconWrap);
  item.appendChild(meta);

  if (repo.changed) {
    const count = document.createElement('span');
    count.className = 'change-count';
    count.textContent = repo.changed;
    item.appendChild(count);
  }

  const removeBtn = document.createElement('button');
  removeBtn.className = 'icon-btn danger repo-remove';
  removeBtn.dataset.id = repo.id;
  removeBtn.title = t('removeRepo');
  removeBtn.innerHTML = icon('trash');
  item.appendChild(removeBtn);

  els.repoList.appendChild(item);
}

function appendCloudRepoItem(repo) {
  const item = document.createElement('div');
  item.className = `cloud-repo-item${state.activeCloudFullName === repo.fullName ? ' active' : ''}`;
  item.dataset.repo = repo.fullName || repo.name;
  item.title = `${repo.fullName || repo.name} · ${t(repo.private ? 'private' : 'public')}`;

  const iconWrap = document.createElement('div');
  iconWrap.className = 'repo-icon';
  iconWrap.innerHTML = icon(repo.private ? 'lock' : 'cloud');

  const meta = document.createElement('div');
  meta.className = 'repo-meta';
  const name = document.createElement('div');
  name.className = 'repo-name';
  name.textContent = repo.name;
  const sub = document.createElement('div');
  sub.className = 'repo-sub';
  sub.textContent = [
    repo.owner || '',
    repo.language || '',
    Number.isFinite(repo.stars) && repo.stars > 0 ? `★ ${repo.stars}` : '',
    t(repo.private ? 'private' : 'public')
  ].filter(Boolean).join(' · ');
  meta.appendChild(name);
  meta.appendChild(sub);

  item.appendChild(iconWrap);
  item.appendChild(meta);

  item.addEventListener('click', () => openCloudRepo(repo));
  els.repoList.appendChild(item);
}

async function selectRepo(id) {
  const repo = state.repos.find((item) => item.id === id);
  if (!repo || state.loadingRepo) return;
  state.loadingRepo = true;
  setStatus(t('openingRepo', { name: repo.name }), 'busy');
  beginOperation(t('openingRepo', { name: repo.name }));

  try {
    state.currentRepo = repo;
    state.activeCloudFullName = '';
    state.currentPath = '';
    state.expandedDirs = new Set(['']);
    state.childrenCache = new Map();
    state.editorFile = null;
    state.editorDirty = false;
    state.diffView = null;
    state.cloudBranches = [];
    state.cloudCommits = [];
    state.cloudRepoInfo = null;
    state.cloudReadme = '';
    state.cloudTreeIndex = [];
    state.repoSearchMode = false;
    state.gitTab = 'changes';
    state.gitStatus = { branch: '', ahead: 0, behind: 0, changes: [] };
    state.gitLog = [];
    state.branches = { local: [], remotes: [] };
    state.remote = repo.remote || repo.url || '';
    els.fileSearch.value = '';
    els.gitTabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === 'changes'));
    updateCloudToolbar();
    renderRepos();
    renderBreadcrumb();
    renderTree();
    renderWorkspace();
    renderGitPanel();
    await loadDirectory('');
    await refreshGitStatus(false);
    await Promise.all([
      loadGitLog(),
      loadGitBranches(),
      loadRemoteInfo()
    ]);
    renderGitPanel();
    setStatus(t('openedRepo', { name: repo.name }));
  } catch (err) {
    handleError(t('openRepoFailed'), err);
  } finally {
    endOperation();
    state.loadingRepo = false;
  }
}

async function openCloudRepo(remoteRepo) {
  if (!remoteRepo || state.loadingRepo) return;
  await runOperation(t('openingCloudRepo', { name: remoteRepo.fullName }), async () => {
    state.loadingRepo = true;
    state.currentRepo = {
      id: remoteRepo.fullName,
      name: remoteRepo.name,
      cloud: true,
      githubFullName: remoteRepo.fullName,
      branch: remoteRepo.defaultBranch || 'main',
      remote: remoteRepo.cloneUrl,
      url: remoteRepo.cloneUrl
    };
    state.activeCloudFullName = remoteRepo.fullName;
    state.currentPath = '';
    state.expandedDirs = new Set(['']);
    state.childrenCache = new Map();
    state.editorFile = null;
    state.editorDirty = false;
    state.diffView = null;
    state.cloudBranches = [];
    state.cloudCommits = [];
    state.cloudRepoInfo = null;
    state.cloudReadme = '';
    state.cloudTreeIndex = [];
    state.repoSearchMode = false;
    els.fileSearch.value = '';
    els.branchSelect.value = '';
    updateCloudToolbar();
    renderRepos();
    renderBreadcrumb();
    renderTree();
    renderWorkspace();
    renderGitPanel();
    await loadDirectory('');
    await loadCloudOverview();
    renderWorkspace();
    setStatus(t('openedCloudRepo', { name: remoteRepo.fullName }));
    state.loadingRepo = false;
  }).catch((err) => {
    state.loadingRepo = false;
    handleError(t('openCloudRepoFailed'), err);
  });
}

async function loadDirectory(path) {
  if (!state.currentRepo) return;
  const entries = state.currentRepo.cloud
    ? await api.githubTree(state.currentRepo.githubFullName, path, cloudRef())
    : await api.tree(state.currentRepo.id, path);
  state.childrenCache.set(path, entries);
  if (path === state.currentPath) {
    renderTree();
    renderBreadcrumb();
  }
}

async function ensurePathExpanded(path) {
  if (!state.currentRepo) return;
  const parts = path ? String(path).split('/') : [];
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
      state.expandedDirs.add(current);
      if (!state.childrenCache.has(current)) {
        const entries = state.currentRepo.cloud
          ? await api.githubTree(state.currentRepo.githubFullName, current, cloudRef())
          : await api.tree(state.currentRepo.id, current);
      state.childrenCache.set(current, entries);
    }
  }
}

async function setCurrentPath(path) {
  if (!state.currentRepo) return;
  await ensurePathExpanded(path);
  state.currentPath = path || '';
  renderBreadcrumb();
  renderTree();
  updateStatusBar();
}

function renderBreadcrumb() {
  els.breadcrumb.innerHTML = '';
  if (!state.currentRepo) return;

  const root = document.createElement('button');
  root.className = `crumb${state.currentPath ? '' : ' current'}`;
  root.dataset.path = '';
  root.textContent = state.currentRepo.name;
  els.breadcrumb.appendChild(root);

  const parts = state.currentPath ? state.currentPath.split('/') : [];
  let path = '';
  parts.forEach((part, index) => {
    const sep = document.createElement('span');
    sep.className = 'crumb-sep';
    sep.textContent = '/';
    els.breadcrumb.appendChild(sep);

    path = path ? `${path}/${part}` : part;
    const crumb = document.createElement('button');
    crumb.className = `crumb${index === parts.length - 1 ? ' current' : ''}`;
    crumb.dataset.path = path;
    crumb.textContent = part;
    els.breadcrumb.appendChild(crumb);
  });
}

function findEntry(path) {
  for (const entries of state.childrenCache.values()) {
    const found = entries.find((entry) => entry.path === path);
    if (found) return found;
  }
  return null;
}

function renderTree() {
  els.filesTree.innerHTML = '';
  if (!state.currentRepo) {
    const empty = document.createElement('div');
    empty.className = 'empty-inline';
    empty.textContent = t('connectRepoToStart');
    els.filesTree.appendChild(empty);
    return;
  }
  if (state.currentRepo.cloud) {
    renderCloudFileList();
    return;
  }
  const rootEntries = state.childrenCache.get('') || [];
  const search = els.fileSearch.value.trim().toLowerCase();
  renderTreeLevel(rootEntries, 0, search);
}

function renderCloudFileList() {
  const baseEntries = state.repoSearchMode && state.cloudTreeIndex.length
    ? state.cloudTreeIndex
    : (state.childrenCache.get(state.currentPath) || []);
  const search = els.fileSearch.value.trim().toLowerCase();
  if (state.repoSearchMode && !search) {
    const empty = document.createElement('div');
    empty.className = 'empty-inline';
    empty.textContent = t('searchWholeRepo');
    els.filesTree.appendChild(empty);
    return;
  }
  const filtered = baseEntries
    .filter((entry) => !search
      ? true
      : state.repoSearchMode
        ? (entry.path.toLowerCase().includes(search) || entry.name.toLowerCase().includes(search))
        : entry.name.toLowerCase().includes(search))
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });
  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-inline';
    empty.textContent = search ? t('noMatchingFiles') : (state.repoSearchMode ? t('treeEmpty') : t('directoryEmpty'));
    els.filesTree.appendChild(empty);
    return;
  }
  filtered.forEach((entry) => {
    const row = createCloudFileItem(entry);
    if (state.repoSearchMode && entry.path !== state.currentPath) {
      row.classList.add('search-result');
    }
    els.filesTree.appendChild(row);
  });
}

function createCloudFileItem(entry) {
  const row = document.createElement('div');
  row.className = `github-file-row ${entry.kind}${entry.path === state.currentPath ? ' active' : ''}`;
  row.dataset.path = entry.path;
  row.dataset.kind = entry.kind;
  row.innerHTML = `
    <span class="github-file-icon">${icon(entry.kind === 'dir' ? 'folder' : 'file')}</span>
    <span class="github-file-name" title="${escapeAttr(entry.path)}">${escapeHtml(entry.name)}</span>
    <span class="github-file-badge">${entry.kind === 'dir' ? 'folder' : 'file'}</span>
    <span class="github-file-size">${entry.kind === 'file' ? formatBytes(entry.size) : ''}</span>
  `;
  row.addEventListener('click', () => {
    if (entry.kind === 'dir') toggleDir(entry.path);
    else openFile(entry.path);
  });
  row.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
    showContextMenu(event.clientX, event.clientY, entry);
  });
  return row;
}

function renderTreeLevel(entries, depth, search) {
  for (const entry of entries) {
    if (search && !entry.name.toLowerCase().includes(search)) continue;
    els.filesTree.appendChild(createTreeItem(entry, depth));
    if (entry.kind === 'dir' && state.expandedDirs.has(entry.path)) {
      const children = state.childrenCache.get(entry.path);
      if (children) renderTreeLevel(children, depth + 1, search);
    }
  }
}

function createTreeItem(entry, depth) {
  const row = document.createElement('div');
  const expanded = entry.kind === 'dir' && state.expandedDirs.has(entry.path);
  row.className = [
    'tree-item',
    entry.kind,
    expanded ? 'open' : '',
    entry.path === state.currentPath ? 'active' : ''
  ].filter(Boolean).join(' ');
  row.dataset.path = entry.path;
  row.dataset.kind = entry.kind;
  row.draggable = true;
  row.style.paddingLeft = `${8 + depth * 14}px`;

  const change = state.statusMap.get(entry.path);
  const chip = change ? `<span class="status-chip st-${change.kind}">${statusShort(change.kind)}</span>` : '';
  const chevron = entry.kind === 'dir'
    ? `<span class="tree-chevron">${icon(expanded ? 'chevronDown' : 'chevronRight')}</span>`
    : '<span class="tree-chevron"></span>';
  const treeIcon = icon(entry.kind === 'dir' ? (expanded ? 'folderOpen' : 'folder') : 'file');

  row.innerHTML = `
    ${chevron}
    <span class="tree-icon">${treeIcon}</span>
    <span class="tree-name" title="${escapeAttr(entry.path)}">${escapeHtml(entry.name)}</span>
    ${chip}
    <span class="tree-meta">${entry.kind === 'file' ? formatBytes(entry.size) : ''}</span>
  `;
  return row;
}

async function handleTreeClick(event) {
  const row = event.target.closest('.tree-item');
  if (!row || !state.currentRepo) return;
  const entry = findEntry(row.dataset.path) || (state.currentRepo.cloud && state.cloudTreeIndex.find((item) => item.path === row.dataset.path));
  if (!entry) return;
  if (entry.kind === 'dir') {
    await toggleDir(entry.path);
  } else {
    await openFile(entry.path);
  }
}

async function toggleDir(path, forceOpen) {
  if (!state.currentRepo) return;
  const shouldOpen = forceOpen === undefined ? !state.expandedDirs.has(path) : forceOpen;
  if (shouldOpen) {
    await ensurePathExpanded(path);
    state.currentPath = path;
  } else {
    state.expandedDirs.delete(path);
    for (const key of [...state.childrenCache.keys()]) {
      if (key.startsWith(`${path}/`)) state.childrenCache.delete(key);
    }
    if (path === state.currentPath) state.currentPath = '';
  }
  renderBreadcrumb();
  renderTree();
  updateStatusBar();
}

function handleTreeContextMenu(event) {
  if (!state.currentRepo) return;
  event.preventDefault();
  const row = event.target.closest('.tree-item, .github-file-row');
  if (row) {
    const entry = findEntry(row.dataset.path) || (state.currentRepo.cloud && state.cloudTreeIndex.find((item) => item.path === row.dataset.path));
    if (entry) showContextMenu(event.clientX, event.clientY, entry);
  } else {
    showContextMenu(event.clientX, event.clientY, { path: state.currentPath, name: '', kind: 'dir', virtual: true });
  }
}

function showContextMenu(x, y, entry) {
  const menu = els.contextMenu;
  const items = [];

  if (entry.kind === 'file') {
    items.push({ label: t('open'), icon: 'eye', action: 'open' });
    if (state.currentRepo.cloud) {
      items.push({ label: t('download'), icon: 'download', action: 'download' });
      items.push({ label: t('openOnGithub'), icon: 'external', action: 'openWeb' });
      items.push({ label: t('viewHistory'), icon: 'history', action: 'history' });
    }
    if (!state.currentRepo.cloud) items.push({ label: t('viewDiff'), icon: 'code', action: 'diff' });
    items.push({ separator: true });
    items.push({ label: t('rename'), icon: 'pencil', action: 'rename' });
    items.push({ label: t('duplicate'), icon: 'copy', action: 'duplicate' });
    items.push({ label: t('delete'), icon: 'trash', action: 'delete', danger: true });
    items.push({ separator: true });
    items.push({ label: t('copyPath'), icon: 'copy', action: 'copyPath' });
    if (state.currentRepo.cloud) {
      items.push({ label: t('copyLink'), icon: 'link', action: 'copyLink' });
      items.push({ label: t('copyRawLink'), icon: 'code', action: 'copyRaw' });
    } else {
      items.push({ label: t('revealInExplorer'), icon: 'external', action: 'reveal' });
    }
  } else {
    if (!entry.virtual) {
      items.push({ label: t('openFolder'), icon: 'folderOpen', action: 'openDir' });
    }
    if (state.currentRepo.cloud && !entry.virtual) {
      items.push({ label: t('downloadFolder'), icon: 'download', action: 'download' });
      items.push({ label: t('openOnGithub'), icon: 'external', action: 'openWeb' });
    }
    items.push({ label: t('newFile'), icon: 'filePlus', action: 'newFile' });
    items.push({ label: t('newFolder'), icon: 'folderPlus', action: 'newFolder' });
    if (!entry.virtual) {
      items.push({ separator: true });
      items.push({ label: t('rename'), icon: 'pencil', action: 'rename' });
      items.push({ label: t('duplicate'), icon: 'copy', action: 'duplicate' });
      items.push({ label: t('delete'), icon: 'trash', action: 'delete', danger: true });
      items.push({ separator: true });
      items.push({ label: t('copyPath'), icon: 'copy', action: 'copyPath' });
      if (state.currentRepo.cloud) {
        items.push({ label: t('copyLink'), icon: 'link', action: 'copyLink' });
      } else {
        items.push({ label: t('revealInExplorer'), icon: 'external', action: 'reveal' });
      }
    }
  }

  state.contextEntry = entry;
  menu.innerHTML = items.map((item) => {
    if (item.separator) return '<div class="context-sep"></div>';
    return `<button class="context-item${item.danger ? ' danger' : ''}" data-action="${item.action}">${icon(item.icon)}${escapeHtml(item.label)}</button>`;
  }).join('');

  menu.classList.remove('hidden');
  const rect = menu.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 12;
  const maxY = window.innerHeight - rect.height - 12;
  menu.style.left = `${Math.min(x, Math.max(12, maxX))}px`;
  menu.style.top = `${Math.min(y, Math.max(12, maxY))}px`;

  menu.onclick = (event) => {
    const item = event.target.closest('.context-item');
    if (!item) return;
    const action = item.dataset.action;
    const targetEntry = state.contextEntry;
    hideContextMenu();
    handleContextAction(action, targetEntry);
  };
}

function hideContextMenu() {
  els.contextMenu.classList.add('hidden');
  state.contextEntry = null;
  state.repoContextRepo = null;
}

async function handleContextAction(action, entry) {
  if (!entry || !state.currentRepo) return;
  if (action === 'open') await openFile(entry.path);
  if (action === 'openDir') await toggleDir(entry.path, true);
  if (action === 'diff') await showDiff(entry.path, false);
  if (action === 'download') await downloadCloudEntry(entry);
  if (action === 'openWeb') await openCloudEntryWeb(entry);
  if (action === 'history') await openCloudEntryHistory(entry);
  if (action === 'newFile') await newFile(entry.path);
  if (action === 'newFolder') await newFolder(entry.path);
  if (action === 'rename') await renameEntry(entry);
  if (action === 'duplicate') await duplicateEntry(entry);
  if (action === 'delete') await deleteEntry(entry);
  if (action === 'copyPath') await copyPath(entry.path);
  if (action === 'copyLink') await copyCloudEntryLink(entry, false);
  if (action === 'copyRaw') await copyCloudEntryLink(entry, true);
  if (action === 'reveal') {
    try {
      await api.reveal(state.currentRepo.id, entry.path);
    } catch (err) {
      handleError(t('revealInExplorer'), err);
    }
  }
}

function githubEntryWebUrl(entry) {
  if (!state.currentRepo || !state.currentRepo.cloud) return '';
  const fullName = state.currentRepo.githubFullName;
  const ref = cloudRef();
  const kind = entry.kind === 'dir' ? 'tree' : 'blob';
  return `https://github.com/${fullName}/${kind}/${encodeURIComponent(ref)}/${encodeCloudPath(entry.path)}`;
}

function githubEntryRawUrl(entry) {
  if (!state.currentRepo || !state.currentRepo.cloud) return '';
  return `https://raw.githubusercontent.com/${state.currentRepo.githubFullName}/${encodeURIComponent(cloudRef())}/${encodeCloudPath(entry.path)}`;
}

async function downloadCloudEntry(entry) {
  if (!state.currentRepo || !state.currentRepo.cloud) return;
  await runOperation(t('downloading', { path: entry.path }), async () => {
    const result = await api.githubDownload(
      state.currentRepo.githubFullName,
      entry.path,
      cloudRef()
    );
    if (!result.canceled) {
      showToast(t('downloadedCount', { count: result.count }));
      setStatus(t('downloadComplete'));
    } else {
      showToast(t('downloadCanceled'), 'info');
    }
  }).catch((err) => handleError(t('downloadFailed'), err));
}

async function openCloudEntryWeb(entry) {
  const url = githubEntryWebUrl(entry);
  if (url) await api.openWeb(url).catch((err) => handleError(t('cannotOpenLink'), err));
}

async function openCloudEntryHistory(entry) {
  if (!state.currentRepo || !state.currentRepo.cloud) return;
  const url = `https://github.com/${state.currentRepo.githubFullName}/commits/${encodeURIComponent(cloudRef())}/${encodeCloudPath(entry.path)}`;
  await api.openWeb(url).catch((err) => handleError(t('cannotOpenHistory'), err));
}

async function copyCloudEntryLink(entry, raw) {
  const url = raw ? githubEntryRawUrl(entry) : githubEntryWebUrl(entry);
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    showToast(raw ? t('rawLinkCopied') : t('linkCopied'));
  } catch (err) {
    showToast(t('copyFailed'), 'error');
  }
}

async function openFile(path) {
  if (!state.currentRepo) return;
  await runOperation(t('readingFile', { path }), async () => {
    const file = state.currentRepo.cloud
      ? await api.githubReadFile(state.currentRepo.githubFullName, path, cloudRef())
      : await api.readFile(state.currentRepo.id, path);
    state.editorFile = file;
    state.editorDirty = false;
    state.diffView = null;
    renderWorkspace();
    setStatus(path);
  }).catch((err) => handleError(t('openFileFailed'), err));
}

async function newFile(parentPathValue) {
  if (!state.currentRepo) return;
  const name = await showPrompt(t('newFile'), {
    message: parentPathValue ? t('location', { path: `${parentPathValue}/` }) : t('repoRoot'),
    placeholder: t('namePlaceholder')
  });
  if (!name) return;
  const path = joinPath(parentPathValue, name);
  if (!isValidPath(path)) {
    showToast(t('invalidFileName'), 'error');
    return;
  }
  await runOperation(t('creatingFile', { path }), async () => {
    if (state.currentRepo.cloud) {
      await api.githubWriteFile(state.currentRepo.githubFullName, path, '', null, cloudRef());
    } else {
      await api.writeFile(state.currentRepo.id, path, '');
    }
    await refreshAfterFileChange(path);
    await openFile(path);
    showToast(t('fileCreated'));
  }).catch((err) => handleError(t('createFileFailed'), err));
}

async function newFolder(parentPathValue) {
  if (!state.currentRepo) return;
  const name = await showPrompt(t('newFolder'), {
    message: parentPathValue ? t('location', { path: `${parentPathValue}/` }) : t('repoRoot'),
    placeholder: t('folderNamePlaceholder')
  });
  if (!name) return;
  const path = joinPath(parentPathValue, name);
  if (!isValidPath(path)) {
    showToast(t('invalidFolderName'), 'error');
    return;
  }
  await runOperation(t('creatingFolder', { path }), async () => {
    if (state.currentRepo.cloud) {
      await api.githubWriteFile(state.currentRepo.githubFullName, `${path}/.gitkeep`, '', null, cloudRef());
    } else {
      await api.mkdir(state.currentRepo.id, path);
    }
    await refreshAfterFileChange(path);
    showToast(t('folderCreated'));
  }).catch((err) => handleError(t('createFolderFailed'), err));
}

async function renameEntry(entry) {
  if (!state.currentRepo) return;
  const name = await showPrompt(t('rename'), {
    message: entry.path,
    value: entry.name,
    placeholder: t('newNamePlaceholder')
  });
  if (!name || name === entry.name) return;
  const newPath = joinPath(parentPath(entry.path), name);
  if (!isValidPath(newPath)) {
    showToast(t('invalidName'), 'error');
    return;
  }
  await runOperation(t('renaming', { path: entry.path }), async () => {
    if (state.currentRepo.cloud) {
      await api.githubRename(state.currentRepo.githubFullName, entry.path, newPath, cloudRef());
    } else {
      await api.rename(state.currentRepo.id, entry.path, newPath);
    }
    if (state.editorFile && state.editorFile.path === entry.path) {
      state.editorFile.path = newPath;
      state.editorFile.name = name;
    }
    await refreshAfterFileChange(parentPath(entry.path), { targetPath: entry.path, shouldExist: false });
    await refreshAfterFileChange(parentPath(newPath), { targetPath: newPath });
    showToast(t('renamed'));
  }).catch((err) => handleError(t('renameFailed'), err));
}

async function duplicateEntry(entry) {
  if (!state.currentRepo) return;
  await runOperation(t('duplicating', { path: entry.path }), async () => {
    const result = state.currentRepo.cloud
      ? await api.githubDuplicate(state.currentRepo.githubFullName, entry.path, cloudRef())
      : await api.duplicate(state.currentRepo.id, entry.path);
    await refreshAfterFileChange(parentPath(result.path));
    showToast(t('duplicated'));
  }).catch((err) => handleError(t('duplicateFailed'), err));
}

async function deleteEntry(entry) {
  if (!state.currentRepo) return;
  const ok = await showConfirm(t('delete'), t('confirmDelete', { path: entry.path }), { confirmText: t('delete'), danger: true });
  if (!ok) return;
  await runOperation(t('deleting', { path: entry.path }), async () => {
    if (state.currentRepo.cloud) {
      await api.githubDelete(state.currentRepo.githubFullName, entry.path, entry.sha, cloudRef());
    } else {
      await api.remove(state.currentRepo.id, entry.path);
    }
    if (state.editorFile && state.editorFile.path === entry.path) {
      state.editorFile = null;
      state.editorDirty = false;
    }
    await refreshAfterFileChange(parentPath(entry.path), { targetPath: entry.path, shouldExist: false });
    showToast(t('deleted'));
  }).catch((err) => handleError(t('deleteFailed'), err));
}

async function copyPath(path) {
  try {
    await navigator.clipboard.writeText(state.currentRepo ? `${state.currentRepo.name}/${path}` : path);
    showToast(t('copyingPath'));
  } catch (err) {
    showToast(t('copyFailed'), 'error');
  }
}

function renderWorkspace() {
  if (!state.currentRepo) {
    els.workspaceEmpty.classList.remove('hidden');
    els.workspaceContent.classList.add('hidden');
    return;
  }
  els.workspaceEmpty.classList.add('hidden');
  els.workspaceContent.classList.remove('hidden');

  if (state.diffView) {
    renderDiffView();
    return;
  }
  if (state.editorFile) {
    renderEditor();
    return;
  }
  if (state.currentRepo.cloud) {
    renderCloudOverview();
    return;
  }
  els.filePath.innerHTML = '';
  els.workspaceActions.innerHTML = '';
  els.workspaceBody.innerHTML = `<div class="empty-inline">${escapeHtml(t('selectFile'))}</div>`;
}

async function loadCloudOverview() {
  if (!state.currentRepo || !state.currentRepo.cloud) return;
  const fullName = state.currentRepo.githubFullName;
  const ref = cloudRef();
  const [info, branches, commits, readme] = await Promise.all([
    api.githubRepo(fullName).catch(() => null),
    api.githubBranches(fullName).catch(() => []),
    api.githubCommits(fullName, ref).catch(() => []),
    api.githubReadme(fullName, ref).catch(() => '')
  ]);
  state.cloudRepoInfo = info;
  state.cloudBranches = Array.isArray(branches) ? branches : [];
  state.cloudCommits = Array.isArray(commits) ? commits : [];
  state.cloudReadme = String(readme || '');
  updateCloudToolbar();
}

function updateCloudToolbar() {
  const cloud = Boolean(state.currentRepo && state.currentRepo.cloud);
  els.cloudToolbar.classList.toggle('hidden', !cloud);
  if (!cloud) return;
  const current = state.currentRepo.branch || 'main';
  const list = state.cloudBranches.length
    ? state.cloudBranches
    : [{ name: current }];
  els.branchSelect.innerHTML = list.map((branch) =>
    `<option value="${escapeAttr(branch.name)}">${escapeHtml(branch.name)}</option>`
  ).join('');
  els.branchSelect.value = current;
  els.repoSearchBtn.title = state.repoSearchMode ? t('exitWholeSearch') : t('searchWholeRepo');
  els.repoSearchBtn.classList.toggle('active', Boolean(state.repoSearchMode));
}

function renderCloudOverview() {
  const info = state.cloudRepoInfo || {};
  const fullName = state.currentRepo.githubFullName || '';
  const ref = cloudRef();
  const visibility = info.visibility || (info.private ? 'private' : 'public');
  const updated = info.updated_at || '';
  const stats = [
    info.language ? `${t('languageLabel')} ${info.language}` : '',
    Number.isFinite(info.stargazers_count) ? `★ ${info.stargazers_count}` : '',
    Number.isFinite(info.forks_count) ? `Fork ${info.forks_count}` : '',
    t(visibility === 'private' ? 'private' : 'public'),
    info.archived ? t('archived') : '',
    updated ? `${t('updated')} ${String(updated).replace('T', ' ').replace('Z', '')}` : ''
  ].filter(Boolean);

  els.filePath.innerHTML = `${icon('github')}<span class="path-text">${escapeHtml(fullName)}</span>`;
  els.workspaceActions.innerHTML = `
    <button class="icon-btn" data-action="refresh-repo" title="${escapeAttr(t('refreshingRepoInfo'))}">${icon('refresh')}</button>
    <button class="icon-btn" data-action="download-repo" title="${escapeAttr(t('download'))}">${icon('download')}</button>
    <button class="icon-btn" data-action="open-web" title="${escapeAttr(t('openOnGithub'))}">${icon('external')}</button>
  `;

  const commitsHtml = state.cloudCommits.length
    ? state.cloudCommits.map((commit) => `
      <div class="overview-commit">
        <span class="commit-dot"></span>
        <div class="overview-commit-main">
          <strong>${escapeHtml(commit.subject)}</strong>
          <span>${escapeHtml(commit.shortHash)} · ${escapeHtml(commit.author)} · ${escapeHtml(commit.date)}</span>
        </div>
      </div>
    `).join('')
    : `<div class="empty-inline">${escapeHtml(t('noCommits'))}</div>`;

  const branchesHtml = state.cloudBranches.length
    ? state.cloudBranches.map((branch) => `
      <button class="overview-branch${branch.name === ref ? ' current' : ''}" data-branch-name="${escapeAttr(branch.name)}">
        ${icon('branch')}<span>${escapeHtml(branch.name)}</span>
      </button>
    `).join('')
    : `<div class="empty-inline">${escapeHtml(t('noBranches'))}</div>`;

  els.workspaceBody.innerHTML = `
    <div class="repo-overview">
      <div class="overview-hero">
        <div class="overview-badges">
          <span class="cloud-badge ${visibility === 'private' ? 'private' : ''}">${escapeHtml(t(visibility === 'private' ? 'private' : 'public'))}</span>
          ${info.archived ? `<span class="cloud-badge">${escapeHtml(t('archived'))}</span>` : ''}
          <span class="cloud-badge branch-badge">${escapeHtml(ref)}</span>
        </div>
        <h2>${escapeHtml(fullName)}</h2>
        <p class="overview-description">${escapeHtml(info.description || t('noRepoDescription'))}</p>
        <div class="overview-stats">${stats.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}</div>
      </div>
      <div class="overview-grid">
        <section class="overview-section readme-section">
          <div class="overview-section-title">${icon('file')} README</div>
          <div class="markdown-body">
            ${state.cloudReadme ? renderMarkdown(state.cloudReadme) : `<div class="empty-inline">${escapeHtml(t('noReadme'))}</div>`}
          </div>
        </section>
        <aside class="overview-side">
          <section class="overview-section">
            <div class="overview-section-title">${icon('history')} ${escapeHtml(t('recentCommits'))}</div>
            <div class="overview-commit-list">${commitsHtml}</div>
          </section>
          <section class="overview-section">
            <div class="overview-section-title">${icon('branch')} ${escapeHtml(t('branches'))}</div>
            <div class="overview-branch-list">${branchesHtml}</div>
          </section>
        </aside>
      </div>
    </div>
  `;

  els.workspaceBody.querySelectorAll('.overview-branch').forEach((button) => {
    button.addEventListener('click', () => switchBranch(button.dataset.branchName));
  });
  els.workspaceBody.querySelectorAll('a[href]').forEach((anchor) => {
    anchor.addEventListener('click', (event) => {
      event.preventDefault();
      api.openWeb(anchor.href).catch((err) => handleError(t('cannotOpenLink'), err));
    });
  });
}

function renderMarkdown(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  let html = '';
  let inCode = false;
  let codeLines = [];
  const flushCode = () => {
    if (!codeLines.length) return;
    html += `<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`;
    codeLines = [];
  };
  const inline = (line) => escapeHtml(line)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, '<img src="$2" alt="$1">')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (/^```/.test(line)) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        flushCode();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }
    if (!line.trim()) {
      html += '<div class="md-spacer"></div>';
    } else if (/^#{1,6}\s+/.test(line)) {
      const level = line.match(/^(#{1,6})\s+/)[1].length;
      html += `<h${level}>${inline(line.replace(/^#{1,6}\s+/, ''))}</h${level}>`;
    } else if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      html += '<hr>';
    } else if (/^>\s?/.test(line)) {
      html += `<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`;
    } else if (/^[-*]\s+/.test(line)) {
      html += `<div class="md-list-item">• ${inline(line.replace(/^[-*]\s+/, ''))}</div>`;
    } else if (/^\d+\.\s+/.test(line)) {
      html += `<div class="md-list-item">${line.match(/^(\d+)\./)[1]}. ${inline(line.replace(/^\d+\.\s+/, ''))}</div>`;
    } else if (/^\|/.test(line) && line.endsWith('|')) {
      html += `<div class="md-table-line">${inline(line)}</div>`;
    } else {
      html += `<p>${inline(line)}</p>`;
    }
  }
  flushCode();
  return html;
}

async function switchBranch(name) {
  if (!state.currentRepo || !state.currentRepo.cloud || !name || name === cloudRef()) return;
  if (state.editorDirty) {
    const ok = await showConfirm(t('switchBranch'), t('unsavedSwitchBranch'), { confirmText: t('continue') });
    if (!ok) return;
  }
  await runOperation(t('switchingBranch', { name }), async () => {
    state.currentRepo.branch = name;
    state.currentPath = '';
    state.expandedDirs = new Set(['']);
    state.childrenCache = new Map();
    state.editorFile = null;
    state.editorDirty = false;
    state.diffView = null;
    state.cloudTreeIndex = [];
    state.repoSearchMode = false;
    els.fileSearch.value = '';
    els.fileSearch.placeholder = t('filterCurrentDir');
    await loadDirectory('');
    await loadCloudOverview();
    renderBreadcrumb();
    renderTree();
    renderWorkspace();
    updateStatusBar();
    setStatus(t('switchedTo', { name }));
    showToast(t('switchedTo', { name }));
  }).catch((err) => handleError(t('switchBranchFailed'), err));
}

async function toggleRepoSearch() {
  if (!state.currentRepo || !state.currentRepo.cloud) return;
  if (state.repoSearchMode) {
    state.repoSearchMode = false;
    els.fileSearch.placeholder = t('filterCurrentDir');
    els.fileSearch.value = '';
    updateCloudToolbar();
    renderTree();
    return;
  }
  await runOperation(t('loadingRepoTree'), async () => {
    state.cloudTreeIndex = await api.githubSearchTree(state.currentRepo.githubFullName, cloudRef());
    state.repoSearchMode = true;
    els.fileSearch.placeholder = t('searchWholeRepo');
    updateCloudToolbar();
    renderTree();
    setStatus(t('wholeSearchEnabled'));
  }).catch((err) => handleError(t('loadTreeFailed'), err));
}

async function downloadCurrentPath() {
  if (!state.currentRepo || !state.currentRepo.cloud) return;
  await runOperation(t('preparingDownload'), async () => {
    const result = await api.githubDownload(
      state.currentRepo.githubFullName,
      state.currentPath,
      cloudRef()
    );
    if (!result.canceled) {
      showToast(t('downloadedCount', { count: result.count }));
      setStatus(t('downloadComplete'));
    } else {
      showToast(t('downloadCanceled'), 'info');
    }
  }).catch((err) => handleError(t('downloadFailed'), err));
}

function handleRepoContextMenu(event) {
  const item = event.target.closest('.cloud-repo-item');
  if (!item) return;
  event.preventDefault();
  const repo = state.githubRepos.find((entry) => entry.fullName === item.dataset.repo);
  if (repo) showRepoContextMenu(event.clientX, event.clientY, repo);
}

function showRepoContextMenu(x, y, repo) {
  const menu = els.contextMenu;
  const fullName = repo.fullName || repo.name;
  const items = [
    { label: t('openOnGithub'), icon: 'external', action: 'open' },
    { label: t('downloadZip'), icon: 'download', action: 'zip' },
    { label: t('editRepoInfo'), icon: 'pencil', action: 'edit' },
    { separator: true },
    { label: t('copyHttpsUrl'), icon: 'copy', action: 'copyHttps' },
    { label: t('copySshUrl'), icon: 'branch', action: 'copySsh' },
    { separator: true },
    { label: t('refreshRepoList'), icon: 'refresh', action: 'refresh' }
  ];
  state.repoContextRepo = repo;
  menu.innerHTML = items.map((item) => {
    if (item.separator) return '<div class="context-sep"></div>';
    return `<button class="context-item" data-repo-action="${item.action}">${icon(item.icon)}${escapeHtml(item.label)}</button>`;
  }).join('');
  menu.classList.remove('hidden');
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, Math.max(12, window.innerWidth - rect.width - 12))}px`;
  menu.style.top = `${Math.min(y, Math.max(12, window.innerHeight - rect.height - 12))}px`;
  menu.onclick = (event) => {
    const item = event.target.closest('[data-repo-action]');
    if (!item) return;
    const action = item.dataset.repoAction;
    hideContextMenu();
    handleRepoContextAction(action, repo, fullName);
  };
}

async function handleRepoContextAction(action, repo, fullName) {
  const https = repo.cloneUrl || `https://github.com/${fullName}.git`;
  const ssh = `git@github.com:${fullName}.git`;
  if (action === 'open') {
    await api.openWeb(repo.htmlUrl || `https://github.com/${fullName}`).catch((err) => handleError(t('cannotOpenLink'), err));
  }
  if (action === 'zip') {
    const ref = repo.defaultBranch || 'main';
    await api.openWeb(`https://github.com/${fullName}/archive/refs/heads/${encodeURIComponent(ref)}.zip`).catch((err) => handleError(t('downloadFailed'), err));
  }
  if (action === 'edit') await editRepo(repo, fullName);
  if (action === 'copyHttps') {
    await navigator.clipboard.writeText(https).then(() => showToast(t('copyHttpsUrl'))).catch(() => showToast(t('copyFailed'), 'error'));
  }
  if (action === 'copySsh') {
    await navigator.clipboard.writeText(ssh).then(() => showToast(t('copySshUrl'))).catch(() => showToast(t('copyFailed'), 'error'));
  }
  if (action === 'refresh') await refreshGithubRepos();
}

async function editRepo(repo, fullName) {
  const description = await showPrompt(t('editRepoDescription'), {
    message: fullName,
    value: repo.description || '',
    placeholder: t('repoDescription')
  });
  if (description === null || description === false) return;
  const visibility = await showPrompt(
    t('editRepoVisibility'),
    {
      message: t('chooseVisibility'),
      value: repo.private ? 'private' : 'public',
      select: ['public', 'private']
    }
  );
  if (visibility === null || visibility === false) return;
  await runOperation(t('updatingRepoInfo'), async () => {
    await api.githubUpdateRepo(fullName, {
      description,
      private: visibility === 'private'
    });
    state.githubRepos = await api.githubRepos();
    renderRepos();
    if (state.currentRepo && state.currentRepo.cloud && state.currentRepo.githubFullName === fullName) {
      await loadCloudOverview();
      renderWorkspace();
    }
    showToast(t('repoInfoUpdated'));
  }).catch((err) => handleError(t('updateRepoFailed'), err));
}

function renderEditor() {
  const file = state.editorFile;
  const label = `${state.currentRepo.name}/${file.path}`;
  els.filePath.innerHTML = `${icon('file')}<span class="path-text">${escapeHtml(label)}</span>`;
  els.workspaceActions.innerHTML = `
    <button class="icon-btn" data-action="save" ${state.editorDirty ? '' : 'disabled'} title="${escapeAttr(t('saveFile'))}">${icon('save')}</button>
    <button class="icon-btn" data-action="refresh-file" title="${escapeAttr(t('refreshFile'))}">${icon('refresh')}</button>
    <button class="icon-btn" data-action="copy-path" title="${escapeAttr(t('copyPath'))}">${icon('copy')}</button>
    ${state.currentRepo.cloud ? '' : `<button class="icon-btn" data-action="open-system" title="${escapeAttr(t('open'))}">${icon('external')}</button>`}
    <button class="icon-btn" data-action="close-file" title="${escapeAttr(t('closeFile'))}">${icon('x')}</button>
  `;

  if (file.type === 'text') {
    const content = file.content || '';
    els.workspaceBody.innerHTML = `
      <div class="editor-shell">
        <div class="line-numbers"></div>
        <textarea id="editor-textarea" spellcheck="false">${escapeHtml(content)}</textarea>
      </div>
    `;
    const textarea = qs('#editor-textarea');
    const lineNumbers = qs('.line-numbers');
    syncLineNumbers(content, lineNumbers);

    textarea.addEventListener('input', () => {
      state.editorFile.content = textarea.value;
      state.editorDirty = true;
      syncLineNumbers(textarea.value, lineNumbers);
      renderEditorActions();
    });
    textarea.addEventListener('scroll', () => {
      lineNumbers.scrollTop = textarea.scrollTop;
    });
    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Tab') {
        event.preventDefault();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        textarea.setRangeText('  ', start, end, 'end');
        textarea.dispatchEvent(new Event('input'));
      }
    });
  } else if (file.type === 'image') {
    els.workspaceBody.innerHTML = `<div class="image-preview"><img src="${file.dataUrl}" alt="${escapeAttr(file.name)}"></div>`;
  } else if (file.type === 'binary') {
    els.workspaceBody.innerHTML = `
      <div class="binary-view">
        ${icon('terminal')}
        <strong>${escapeHtml(t('binaryFile'))}</strong>
        <span>${escapeHtml(formatBytes(file.size))} · .${escapeHtml(file.ext || 'bin')}</span>
      </div>
    `;
  } else {
    els.workspaceBody.innerHTML = `
      <div class="binary-view">
        ${icon('file')}
        <strong>${escapeHtml(t('fileTooLarge'))}</strong>
        <span>${escapeHtml(formatBytes(file.size))}</span>
      </div>
    `;
  }
}

function renderEditorActions() {
  const saveButton = qs('[data-action="save"]');
  if (saveButton) saveButton.disabled = !state.editorDirty;
}

function syncLineNumbers(content, element) {
  const count = String(content).split('\n').length;
  const max = Math.min(count, 20000);
  let html = '';
  for (let i = 1; i <= max; i += 1) html += `<span>${i}</span>`;
  if (count > max) html += '<span>…</span>';
  element.innerHTML = html;
}

function renderDiffView() {
  const diff = state.diffView;
  const title = diff.title || `${t('viewDiff')} · ${diff.path}`;
  els.filePath.innerHTML = `${icon('code')}<span class="path-text">${escapeHtml(title)}</span>`;
  els.workspaceActions.innerHTML = `
    <button class="icon-btn" data-action="close-diff" title="${escapeAttr(t('closeFile'))}">${icon('x')}</button>
    <button class="icon-btn" data-action="copy-path" title="${escapeAttr(t('copyPath'))}">${icon('copy')}</button>
  `;

  const lines = String(diff.diff || '').split('\n');
  const html = lines.map((line) => {
    let className = 'diff-line';
    if (line.startsWith('+++') || line.startsWith('---')) className += ' diff-meta';
    else if (line.startsWith('@@')) className += ' diff-hunk';
    else if (line.startsWith('+')) className += ' diff-add';
    else if (line.startsWith('-')) className += ' diff-del';
    return `<div class="${className}">${escapeHtml(line)}</div>`;
  }).join('');
  els.workspaceBody.innerHTML = `<div class="diff-scroll">${html}</div>`;
}

async function handleWorkspaceAction(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'save') await saveFile();
  if (action === 'refresh-file') await reloadEditorFile();
  if (action === 'copy-path' && state.editorFile) await copyPath(state.editorFile.path);
  if (action === 'copy-path' && state.diffView && state.diffView.path) await copyPath(state.diffView.path);
  if (action === 'open-system' && state.editorFile && !state.currentRepo.cloud) {
    try {
      await api.openExternal(state.currentRepo.id, state.editorFile.path);
    } catch (err) {
      handleError(t('openFileFailed'), err);
    }
  }
  if (action === 'close-file') {
    state.editorFile = null;
    state.editorDirty = false;
    renderWorkspace();
  }
  if (action === 'close-diff') {
    state.diffView = null;
    renderWorkspace();
  }
  if (action === 'refresh-repo') await refreshRepoOverview();
  if (action === 'download-repo') await downloadCurrentPath();
  if (action === 'open-web' && state.currentRepo && state.currentRepo.cloud) {
    const fullName = state.currentRepo.githubFullName;
    const ref = cloudRef();
    await api.openWeb(`https://github.com/${fullName}/tree/${encodeURIComponent(ref)}`).catch((err) => handleError(t('cannotOpenLink'), err));
  }
}

async function refreshRepoOverview() {
  if (!state.currentRepo) return;
  await runOperation(t('refreshingRepoInfo'), async () => {
    await Promise.all([
      loadCloudOverview(),
      loadDirectory(state.currentPath)
    ]);
    renderWorkspace();
    setStatus(t('repoInfoRefreshed'));
    showToast(t('repoInfoRefreshed'));
  }).catch((err) => handleError(t('refreshRepoInfoFailed'), err));
}

async function saveFile() {
  if (!state.currentRepo || !state.editorFile || !state.editorDirty) return;
  await runOperation(t('savingFile', { path: state.editorFile.path }), async () => {
    if (state.currentRepo.cloud) {
      const result = await api.githubWriteFile(
        state.currentRepo.githubFullName,
        state.editorFile.path,
        state.editorFile.content || '',
        state.editorFile.sha || null,
        cloudRef()
      );
      if (result && result.sha) state.editorFile.sha = result.sha;
    } else {
      await api.writeFile(state.currentRepo.id, state.editorFile.path, state.editorFile.content || '');
    }
    state.editorDirty = false;
    renderEditorActions();
    await refreshAfterFileChange(state.editorFile.path, { content: state.editorFile.content || '' });
    showToast(t('saved'));
  }).catch((err) => handleError(t('saveFailed'), err));
}

async function reloadEditorFile() {
  if (!state.editorFile) return;
  if (state.editorDirty) {
    const ok = await showConfirm(t('discardChanges'), t('discardConfirm'), { confirmText: t('reload'), danger: false });
    if (!ok) return;
  }
  await openFile(state.editorFile.path);
  showToast(t('refreshed'));
}

async function refreshAfterFileChange(path, options = {}) {
  if (!state.currentRepo) return;
  if (state.currentRepo.cloud) {
    const targetPath = options.targetPath || path;
    const dir = parentPath(targetPath);
    const shouldExist = options.shouldExist !== false;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        const entries = await api.githubTree(state.currentRepo.githubFullName, dir, cloudRef());
        state.childrenCache.set(dir, entries);
        const found = entries.some((entry) => entry.path === targetPath || entry.name === targetPath.split('/').pop());
        if (found === shouldExist) {
          if (options.content !== undefined) {
            const file = await api.githubReadFile(state.currentRepo.githubFullName, targetPath, cloudRef());
            if (file.content === options.content) {
              if (state.repoSearchMode) {
                state.cloudTreeIndex = await api.githubSearchTree(state.currentRepo.githubFullName, cloudRef());
              }
              renderTree();
              return true;
            }
          } else {
            if (state.repoSearchMode) {
              state.cloudTreeIndex = await api.githubSearchTree(state.currentRepo.githubFullName, cloudRef());
            }
            renderTree();
            return true;
          }
        }
      } catch (err) {
        // Retry until the cloud tree reflects the operation.
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(t('cloudNotSynced'));
  }
  const dir = parentPath(path);
  try {
    if (state.childrenCache.has(dir)) {
      state.childrenCache.set(dir, await api.tree(state.currentRepo.id, dir));
    }
  } catch (err) {
    state.childrenCache.delete(dir);
  }
  await refreshGitStatus(false);
  renderTree();
}

async function refreshFiles() {
  if (!state.currentRepo) return;
  await runOperation(t('refreshing'), async () => {
    await loadDirectory(state.currentPath);
    if (state.currentRepo.cloud && state.repoSearchMode) {
      state.cloudTreeIndex = await api.githubSearchTree(state.currentRepo.githubFullName, cloudRef());
    }
    if (!state.currentRepo.cloud) await refreshGitStatus(false);
    showToast(t('refreshed'));
  }).catch((err) => handleError(t('refreshFailed'), err));
}

async function collapseAll() {
  if (!state.currentRepo) return;
  state.expandedDirs = new Set(['']);
  state.childrenCache.clear();
  state.currentPath = '';
  await loadDirectory('');
  renderBreadcrumb();
  showToast(t('collapsed'));
}

async function refreshGitStatus(render = true) {
  if (!state.currentRepo) return;
  try {
    const status = await api.gitStatus(state.currentRepo.id);
    state.gitStatus = status;
    state.statusMap = new Map();
    status.changes.forEach((change) => {
      state.statusMap.set(change.path, change);
      if (change.oldPath) state.statusMap.set(change.oldPath, change);
    });
    if (state.currentRepo) {
      state.currentRepo.branch = status.branch;
      state.currentRepo.changed = status.changes.length;
    }
    renderRepos();
    if (render) renderGitPanel();
    renderTree();
    updateStatusBar();
  } catch (err) {
    handleError(t('gitFailed'), err);
  }
}

function renderGitPanel() {
  if (!state.currentRepo) {
    els.gitBody.innerHTML = `<div class="empty-inline">${escapeHtml(t('connectRepoToStart'))}</div>`;
    return;
  }
  if (state.currentRepo.cloud) {
    renderCloudPanel();
    return;
  }
  if (state.gitTab === 'changes') renderChangesTab();
  if (state.gitTab === 'history') renderHistoryTab();
  if (state.gitTab === 'branches') renderBranchesTab();
  if (state.gitTab === 'remote') renderRemoteTab();
}

function renderCloudPanel() {
  els.gitBody.innerHTML = `
    <div class="git-sync-row">
      <div class="branch-pill">${icon('cloud')}<span class="branch-name">${escapeHtml(state.currentRepo.branch || 'main')}</span></div>
      <button class="icon-btn" data-cloud="refresh" title="${escapeAttr(t('refresh'))}">${icon('refresh')}</button>
    </div>
    <div class="cloud-meta-list">
      <div class="cloud-meta-row">
        <span>${escapeHtml(t('repo'))}</span>
        <strong title="${escapeAttr(state.currentRepo.githubFullName)}">${escapeHtml(state.currentRepo.githubFullName)}</strong>
      </div>
      <div class="cloud-meta-row">
        <span>${escapeHtml(t('branch'))}</span>
        <strong>${escapeHtml(state.currentRepo.branch || 'main')}</strong>
      </div>
      <div class="cloud-meta-row">
        <span>${escapeHtml(t('mode'))}</span>
        <strong>${escapeHtml(t('liveCloudMode'))}</strong>
      </div>
      <div class="cloud-meta-row">
        <span>${escapeHtml(t('directory'))}</span>
        <strong title="${escapeAttr(state.currentPath || '/')}">${escapeHtml(state.currentPath || '/')}</strong>
      </div>
    </div>
    <div class="remote-note">${escapeHtml(t('cloudNote'))}</div>
  `;
}

function renderChangesTab() {
  const status = state.gitStatus || { branch: '', ahead: 0, behind: 0, changes: [] };
  const changes = status.changes || [];
  const stagedCount = changes.filter((change) => change.staged).length;
  const syncInfo = [];
  if (status.ahead) syncInfo.push(`↑${status.ahead}`);
  if (status.behind) syncInfo.push(`↓${status.behind}`);

  els.gitBody.innerHTML = `
    <div class="git-sync-row">
      <div class="branch-pill">${icon('branch')}<span class="branch-name">${escapeHtml(status.branch || 'detached')}</span></div>
      ${syncInfo.length ? `<span class="ahead-behind">${syncInfo.join(' ')}</span>` : ''}
      <button class="icon-btn" data-git="pull" title="拉取">${icon('download')}</button>
      <button class="icon-btn" data-git="push" title="推送">${icon('upload')}</button>
    </div>
    <div class="changes-list">
      ${changes.length ? changes.map((change) => `
        <div class="change-item">
          <input type="checkbox" data-stage-path="${escapeAttr(change.path)}" ${change.staged ? 'checked' : ''}>
          <span class="change-status st-${change.kind}">${statusLabel(change.kind)}</span>
          <span class="change-path" title="${escapeAttr(change.path)}">${escapeHtml(change.path)}</span>
          <button class="icon-btn small" data-diff="${escapeAttr(change.path)}" data-staged="${change.staged}" title="查看差异">${icon('eye')}</button>
          <button class="icon-btn small danger" data-discard="${escapeAttr(change.path)}" title="丢弃">${icon('trash')}</button>
        </div>
      `).join('') : '<div class="empty-inline">工作区干净</div>'}
    </div>
    <div class="commit-box">
      <textarea id="commit-message" placeholder="提交信息"></textarea>
      <div class="commit-actions">
        <button class="secondary-btn" data-git="stage-all">${icon('check')} 全部暂存</button>
        <button class="primary-btn" data-git="commit" ${stagedCount ? '' : 'disabled'}>${icon('commit')} 提交</button>
        <button class="primary-btn" data-git="commit-push" ${stagedCount ? '' : 'disabled'}>${icon('upload')} 提交并推送</button>
      </div>
    </div>
  `;
}

function renderHistoryTab() {
  const logs = state.gitLog || [];
  els.gitBody.innerHTML = `
    <div class="git-section-title">最近提交</div>
    <div class="history-list">
      ${logs.length ? logs.map((log) => `
        <div class="history-item" data-commit="${escapeAttr(log.hash)}">
          <span class="history-dot"></span>
          <div>
            <div class="history-subject">${escapeHtml(log.subject)}</div>
            <div class="history-meta">${escapeHtml(log.hash)} · ${escapeHtml(log.author)} · ${escapeHtml(log.date)}</div>
          </div>
        </div>
      `).join('') : '<div class="empty-inline">暂无提交记录</div>'}
    </div>
  `;
}

function renderBranchesTab() {
  const branches = state.branches || { local: [], remotes: [] };
  const current = state.gitStatus.branch;
  els.gitBody.innerHTML = `
    <div class="branch-create">
      <input id="branch-name-input" type="text" placeholder="新分支名" spellcheck="false">
      <button class="primary-btn" data-git="create-branch">${icon('plus')} 创建</button>
    </div>
    <div class="git-section-title">本地分支</div>
    ${branches.local.length ? branches.local.map((branch) => `
      <button class="branch-row${branch.name === current ? ' current' : ''}" data-git="checkout" data-branch="${escapeAttr(branch.name)}">
        ${icon(branch.name === current ? 'dot' : 'branch')}
        <span class="branch-row-name">${escapeHtml(branch.name)}</span>
      </button>
    `).join('') : '<div class="empty-inline">暂无本地分支</div>'}
    <div class="git-section-title">远程分支</div>
    ${branches.remotes.length ? branches.remotes.map((branch) => `
      <button class="branch-row" data-git="checkout" data-branch="${escapeAttr(branch.name)}">
        ${icon('cloud')}
        <span class="branch-row-name">${escapeHtml(branch.name)}</span>
      </button>
    `).join('') : '<div class="empty-inline">暂无远程分支</div>'}
  `;
}

function renderRemoteTab() {
  els.gitBody.innerHTML = `
    <div class="remote-block">
      <span class="remote-label">origin</span>
      <input id="remote-url-input" type="text" value="${escapeAttr(state.remote)}" spellcheck="false">
      <div class="remote-actions">
        <button class="secondary-btn" data-git="save-remote">${icon('save')} 保存</button>
        <button class="secondary-btn" data-git="fetch">${icon('refresh')} 获取</button>
      </div>
      <button class="secondary-btn" data-git="pull">${icon('download')} 拉取</button>
      <button class="secondary-btn" data-git="push">${icon('upload')} 推送</button>
      <div class="remote-note">${escapeHtml(state.remote || '尚未设置远程地址')}</div>
    </div>
  `;
}

async function handleGitAction(event) {
  if (!state.currentRepo) return;
  const cloudButton = event.target.closest('[data-cloud]');
  if (cloudButton) {
    if (cloudButton.dataset.cloud === 'refresh') await refreshCloudFiles();
    return;
  }
  const checkbox = event.target.closest('input[data-stage-path]');
  if (checkbox) {
    const path = checkbox.dataset.stagePath;
    try {
      await runOperation('正在更新暂存状态', async () => {
        if (checkbox.checked) await api.gitStage(state.currentRepo.id, [path]);
        else await api.gitUnstage(state.currentRepo.id, [path]);
        await refreshGitStatus();
      });
    } catch (err) {
      handleError('暂存操作失败', err);
      await refreshGitStatus();
    }
    return;
  }

  const diffButton = event.target.closest('[data-diff]');
  if (diffButton) {
    await showDiff(diffButton.dataset.diff, diffButton.dataset.staged === 'true');
    return;
  }

  const discardButton = event.target.closest('[data-discard]');
  if (discardButton) {
    const path = discardButton.dataset.discard;
    const ok = await showConfirm('丢弃更改', `确定丢弃 ${path} 的所有本地更改？`, { confirmText: '丢弃', danger: true });
    if (!ok) return;
    try {
      await runOperation(`正在丢弃 ${path}`, async () => {
        await api.gitDiscard(state.currentRepo.id, path);
        await refreshAfterFileChange(path);
        showToast('更改已丢弃');
      });
    } catch (err) {
      handleError('丢弃失败', err);
    }
    return;
  }

  const commitItem = event.target.closest('[data-commit]');
  if (commitItem) {
    try {
      await runOperation('正在读取提交', async () => {
        const text = await api.gitShow(state.currentRepo.id, commitItem.dataset.commit);
        state.diffView = { title: `提交 ${commitItem.dataset.commit}`, diff: text, path: null };
        renderWorkspace();
      });
    } catch (err) {
      handleError('读取提交失败', err);
    }
    return;
  }

  const button = event.target.closest('[data-git]');
  if (!button) return;
  const action = button.dataset.git;

  try {
    await runOperation('Git 操作中', async () => {
    if (action === 'pull') {
      setStatus('正在拉取', 'busy');
      const result = await api.gitPull(state.currentRepo.id);
      await afterGitSync(result.output || '拉取完成');
    } else if (action === 'push') {
      setStatus('正在推送', 'busy');
      const result = await api.gitPush(state.currentRepo.id);
      await afterGitSync(result.output || '推送完成');
    } else if (action === 'fetch') {
      setStatus('正在获取', 'busy');
      const result = await api.gitFetch(state.currentRepo.id);
      await afterGitSync(result.output || '获取完成');
    } else if (action === 'stage-all') {
      const changes = state.gitStatus.changes || [];
      if (changes.length) await api.gitStage(state.currentRepo.id, changes.map((change) => change.path));
      await refreshGitStatus();
    } else if (action === 'commit') {
      const message = qs('#commit-message').value.trim();
      if (!message) {
        showToast('请输入提交信息', 'error');
        return;
      }
      const result = await api.gitCommit(state.currentRepo.id, message);
      await afterGitSync(result.output || '提交完成');
      const textarea = qs('#commit-message');
      if (textarea) textarea.value = '';
    } else if (action === 'commit-push') {
      const stagedCount = (state.gitStatus.changes || []).filter((change) => change.staged).length;
      if (!stagedCount) {
        showToast('没有暂存内容，请先导入或暂存文件', 'error');
        return;
      }
      let message = qs('#commit-message').value.trim();
      if (!message) {
        message = state.gitLog.length ? 'Update files via GitHub Repository Manager' : 'Initial commit';
      }
      const commitResult = await api.gitCommit(state.currentRepo.id, message);
      await afterGitSync(commitResult.output || '提交完成');
      const pushResult = await api.gitPush(state.currentRepo.id);
      await afterGitSync(pushResult.output || '推送完成');
    } else if (action === 'checkout') {
      await api.gitCheckout(state.currentRepo.id, button.dataset.branch);
      await afterGitSync(`已切换到 ${button.dataset.branch}`);
    } else if (action === 'create-branch') {
      const name = qs('#branch-name-input').value.trim();
      if (!name) {
        showToast('请输入分支名', 'error');
        return;
      }
      await api.gitCreateBranch(state.currentRepo.id, name);
      await afterGitSync(`已创建分支 ${name}`);
    } else if (action === 'save-remote') {
      const url = qs('#remote-url-input').value.trim();
      if (!url) {
        showToast('请输入远程地址', 'error');
        return;
      }
      await api.gitSetRemote(state.currentRepo.id, url);
      state.remote = url;
      state.currentRepo.remote = url;
      await afterGitSync('远程地址已更新');
    }
    });
  } catch (err) {
    handleError('Git 操作失败', err);
  }
}

async function refreshCloudFiles() {
  if (!state.currentRepo || !state.currentRepo.cloud) return;
  await runOperation(t('refreshing'), async () => {
    await loadDirectory(state.currentPath);
    await loadCloudOverview();
    if (state.repoSearchMode) {
      state.cloudTreeIndex = await api.githubSearchTree(state.currentRepo.githubFullName, cloudRef());
    }
    if (!state.editorFile && !state.diffView) renderWorkspace();
    setStatus(t('cloudRefreshed'));
    showToast(t('cloudRefreshed'));
  }).catch((err) => handleError(t('cloudRefreshFailed'), err));
}

async function afterGitSync(output) {
  setStatus(t('gitCompleted'));
  if (output) showToast(output.split('\n')[0], 'info');
  await refreshGitStatus();
  await Promise.all([loadGitLog(), loadGitBranches(), loadRemoteInfo()]);
}

async function loadGitLog() {
  if (!state.currentRepo) return;
  try {
    state.gitLog = await api.gitLog(state.currentRepo.id);
    if (state.gitTab === 'history') renderGitPanel();
  } catch (err) {
    state.gitLog = [];
  }
}

async function loadGitBranches() {
  if (!state.currentRepo) return;
  try {
    state.branches = await api.gitBranches(state.currentRepo.id);
    if (state.gitTab === 'branches') renderGitPanel();
  } catch (err) {
    state.branches = { local: [], remotes: [] };
  }
}

async function loadRemoteInfo() {
  if (!state.currentRepo) return;
  try {
    state.remote = state.currentRepo.remote || state.currentRepo.url || '';
    if (state.gitTab === 'remote') renderGitPanel();
  } catch (err) {
    state.remote = '';
  }
}

async function showDiff(path, staged = false) {
  if (!state.currentRepo) return;
  await runOperation(t('viewDiff'), async () => {
    const result = await api.gitDiff(state.currentRepo.id, path, staged);
    state.diffView = {
      path,
      staged,
      title: `${t('viewDiff')} · ${path}`,
      diff: result.diff || ''
    };
    renderWorkspace();
    setStatus(t('viewDiff'));
  }).catch((err) => handleError(t('viewDiff'), err));
}

async function connectRepo() {
  const url = els.url.value.trim();
  if (!url) {
    showToast('请输入仓库地址', 'error');
    els.url.focus();
    return;
  }
  els.connectBtn.disabled = true;
  els.connectBtn.innerHTML = '<span class="spinner"></span><span class="btn-label">连接中</span>';
  setStatus('正在连接仓库', 'busy');
  try {
    await runOperation('正在连接仓库', async () => {
      const repo = await api.addRepo(url);
      await loadRepos(false);
      await selectRepo(repo.id);
    });
    els.url.value = '';
    showToast('仓库连接成功');
  } catch (err) {
    handleError('连接仓库失败', err);
  } finally {
    els.connectBtn.disabled = false;
    els.connectBtn.innerHTML = `${icon('plus')}<span class="btn-label">打开仓库</span>`;
  }
}

async function removeRepo(id) {
  const repo = state.repos.find((item) => item.id === id);
  if (!repo) return;
  const ok = await showConfirm('移除仓库', `将从本地工作区删除 ${repo.name} 及其所有文件。`, { confirmText: '移除', danger: true });
  if (!ok) return;
  try {
    await api.removeRepo(id);
    if (state.currentRepo && state.currentRepo.id === id) {
      state.currentRepo = null;
      state.editorFile = null;
      state.diffView = null;
      state.statusMap.clear();
    }
    await loadRepos(false);
    showToast('仓库已移除');
  } catch (err) {
    handleError('移除仓库失败', err);
  }
}

function updateStatusBar() {
  if (!state.currentRepo) {
    els.statusRepo.textContent = t('noRepo');
    els.statusCount.textContent = t('changesCount', { count: 0 });
    els.titlebarRepo.textContent = t('titlebarDefault');
    return;
  }
  const branch = state.gitStatus.branch || state.currentRepo.branch || '';
  els.statusRepo.textContent = branch ? `${state.currentRepo.name} · ${branch}` : state.currentRepo.name;
  els.statusCount.textContent = state.currentRepo.cloud
    ? state.repoSearchMode
      ? t('statusEntries', { count: state.cloudTreeIndex.length })
      : t('statusFile', { count: (state.childrenCache.get(state.currentPath) || []).length })
    : t('statusChange', { count: state.statusMap.size });
  els.titlebarRepo.textContent = state.currentRepo.cloud
    ? `${state.currentRepo.githubFullName} · ${branch || 'main'}`
    : `${state.currentRepo.name} · ${branch || ''}`;
}

async function loadGithubSession() {
  try {
    const user = await api.githubMe();
    state.githubUser = user;
    renderAccountButton();
    if (user) {
      await refreshGithubRepos();
    } else {
      renderRepos();
    }
  } catch (err) {
    state.githubUser = null;
    renderAccountButton();
    renderRepos();
  }
}

async function refreshGithubRepos() {
  if (!state.githubUser) {
    state.githubRepos = [];
    renderRepos();
    return;
  }
  state.githubLoading = true;
  renderRepos();
  try {
    await runOperation(t('syncingCloudRepos'), async () => {
      state.githubRepos = await api.githubRepos();
    });
  } catch (err) {
    state.githubRepos = [];
    handleError(t('syncCloudReposFailed'), err);
  }
  state.githubLoading = false;
  renderRepos();
}

function renderAccountButton() {
  if (state.githubUser && state.githubUser.avatar_url) {
    els.accountBtn.classList.add('logged-in');
    els.accountBtn.title = `${state.githubUser.login} · GitHub`;
    els.accountBtn.innerHTML = `<img class="account-avatar" src="${escapeAttr(state.githubUser.avatar_url)}" alt="">`;
  } else if (state.githubUser) {
    els.accountBtn.classList.add('logged-in');
    els.accountBtn.title = `${state.githubUser.login} · GitHub`;
    els.accountBtn.innerHTML = icon('cloud');
  } else {
    els.accountBtn.classList.remove('logged-in');
    els.accountBtn.title = t('loginGithub');
    els.accountBtn.innerHTML = icon('cloud');
  }
}

async function handleAccountClick() {
  if (state.githubUser) {
    showAccountMenu();
  } else {
    await githubLogin();
  }
}

async function githubLogin() {
  const token = await showPrompt(t('loginTitle'), {
    message: t('loginMessage'),
    placeholder: t('loginPlaceholder'),
    secret: true,
    confirmText: t('login')
  });
  if (!token) return;
  setStatus(t('verifyingToken'), 'busy');
  try {
    let loggedInUser = null;
    await runOperation(t('verifyingToken'), async () => {
      const user = await api.githubLogin(token);
      loggedInUser = user;
      state.githubUser = user;
      renderAccountButton();
      await refreshGithubRepos();
    });
    setStatus(t('loggedInAs', { name: loggedInUser.login }));
    showToast(t('loggedInAs', { name: loggedInUser.login }));
  } catch (err) {
    handleError(t('loginFailed'), err);
  }
}

async function githubLogout() {
  const ok = await showConfirm(t('logout'), t('logoutConfirm'), { confirmText: t('logout'), danger: false });
  if (!ok) return;
  try {
    await runOperation(t('logout'), async () => {
      await api.githubLogout();
      state.githubUser = null;
      state.githubRepos = [];
      if (state.currentRepo && state.currentRepo.cloud) {
        state.currentRepo = null;
        state.editorFile = null;
        state.diffView = null;
      }
      renderAccountButton();
      renderRepos();
      updateCloudToolbar();
      renderWorkspace();
      renderTree();
      renderBreadcrumb();
      updateStatusBar();
    });
    showToast(t('loggedOut'));
  } catch (err) {
    handleError(t('logoutFailed'), err);
  }
}

function showAccountMenu() {
  if (!state.githubUser) return;
  const menu = els.contextMenu;
  menu.innerHTML = `
    <div class="account-menu-user">
      <strong>${escapeHtml(state.githubUser.login || '')}</strong>
      <span>${escapeHtml(state.githubUser.name || '')}</span>
    </div>
    <div class="context-sep"></div>
    <button class="context-item" data-account="create">${icon('plus')}${escapeHtml(t('createGithubRepo'))}</button>
    <button class="context-item" data-account="sync">${icon('refresh')}${escapeHtml(t('syncCloudReposAction'))}</button>
    <button class="context-item danger" data-account="logout">${icon('x')}${escapeHtml(t('logout'))}</button>
  `;
  menu.classList.remove('hidden');
  const buttonRect = els.accountBtn.getBoundingClientRect();
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(12, buttonRect.right - rect.width)}px`;
  menu.style.top = `${buttonRect.bottom + 6}px`;
  menu.onclick = (event) => {
    const item = event.target.closest('[data-account]');
    if (!item) return;
    const action = item.dataset.account;
    hideContextMenu();
    if (action === 'create') openCreateRepoModal();
    if (action === 'sync') refreshGithubRepos();
    if (action === 'logout') githubLogout();
  };
}

const GITIGNORE_FALLBACK = [
  'None', 'Android', 'Node', 'Python', 'VisualStudio', 'Xcode', 'macOS', 'Windows', 'Unity', 'Gradle', 'JetBrains'
];

const LICENSE_FALLBACK = [
  { key: 'None', name: 'None' },
  { key: 'mit', name: 'MIT License' },
  { key: 'apache-2.0', name: 'Apache License 2.0' },
  { key: 'gpl-3.0', name: 'GNU General Public License v3.0' },
  { key: 'bsd-3-clause', name: 'BSD 3-Clause New or Revised License' },
  { key: 'unlicense', name: 'The Unlicense' }
];

async function openCreateRepoModal() {
  if (!state.githubUser) {
    await githubLogin();
    if (!state.githubUser) return;
  }
  resetRepoForm();
  els.repoFormOverlay.classList.remove('hidden');
  updateRepoNameHint();
  await loadRepoCreateOptions();
}

function closeCreateRepoModal() {
  els.repoFormOverlay.classList.add('hidden');
}

function resetRepoForm() {
  els.repoOwnerSelect.innerHTML = `<option>${escapeHtml(t('loadingOwners'))}</option>`;
  els.repoNameInput.value = '';
  els.repoDescInput.value = '';
  els.repoReadmeInput.checked = false;
  els.repoGitignoreSelect.innerHTML = `<option>${escapeHtml(t('loading'))}</option>`;
  els.repoLicenseSelect.innerHTML = `<option>${escapeHtml(t('loading'))}</option>`;
  const publicRadio = els.repoFormOverlay.querySelector('input[name="repo-visibility"][value="public"]');
  if (publicRadio) publicRadio.checked = true;
  els.repoFormCreate.disabled = true;
}

function updateRepoNameHint() {
  const owner = els.repoOwnerSelect.value || (state.githubUser ? state.githubUser.login : '');
  const name = els.repoNameInput.value.trim();
  els.repoNameHint.textContent = name ? `${owner}/${name}` : '';
  els.repoFormCreate.disabled = !name;
}

async function loadRepoCreateOptions() {
  const user = state.githubUser;
  if (!user) return;
  const ownerOptions = [{ login: user.login, label: t('personalAccount', { name: user.login }) }];
  const [orgsResult, gitignoreResult, licenseResult] = await Promise.allSettled([
    api.githubOrgs(),
    api.githubGitignoreTemplates(),
    api.githubLicenses()
  ]);
  if (orgsResult.status === 'fulfilled' && Array.isArray(orgsResult.value)) {
    orgsResult.value.forEach((org) => {
      ownerOptions.push({ login: org.login, label: t('organization', { name: org.login }) });
    });
  }
  els.repoOwnerSelect.innerHTML = ownerOptions.map((owner) =>
    `<option value="${escapeAttr(owner.login)}">${escapeHtml(owner.label)}</option>`
  ).join('');
  const gitignores = gitignoreResult.status === 'fulfilled' && Array.isArray(gitignoreResult.value)
    ? ['None', ...gitignoreResult.value]
    : GITIGNORE_FALLBACK;
  els.repoGitignoreSelect.innerHTML = gitignores.map((value) =>
    `<option value="${escapeAttr(value)}">${escapeHtml(value)}</option>`
  ).join('');
  const licenses = licenseResult.status === 'fulfilled' && Array.isArray(licenseResult.value)
    ? [{ key: 'None', name: 'None' }, ...licenseResult.value]
    : LICENSE_FALLBACK;
  els.repoLicenseSelect.innerHTML = licenses.map((license) =>
    `<option value="${escapeAttr(license.key)}">${escapeHtml(license.name)}</option>`
  ).join('');
  updateRepoNameHint();
}

async function submitCreateRepo() {
  const name = els.repoNameInput.value.trim();
  if (!name) {
    showToast(t('repoNameRequired'), 'error');
    els.repoNameInput.focus();
    return;
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(name)) {
    showToast(t('repoNameInvalid'), 'error');
    return;
  }
  const owner = els.repoOwnerSelect.value || state.githubUser.login;
  const privateRepo = Boolean(els.repoFormOverlay.querySelector('input[name="repo-visibility"]:checked')?.value === 'private');
  const gitignoreTemplate = els.repoGitignoreSelect.value || 'None';
  const licenseTemplate = els.repoLicenseSelect.value || 'None';
  const autoInit = els.repoReadmeInput.checked || gitignoreTemplate !== 'None' || licenseTemplate !== 'None';
  const options = {
    owner,
    currentUser: state.githubUser.login,
    name,
    description: els.repoDescInput.value.trim(),
    private: privateRepo,
    autoInit,
    gitignoreTemplate,
    licenseTemplate
  };
  closeCreateRepoModal();
  let created = null;
  try {
    created = await runOperation(t('creatingRepo'), async () => {
      const result = await api.githubCreateRepo(options);
      const fullName = result && result.full_name ? result.full_name : `${owner}/${name}`;
      const fallbackRepo = {
        fullName,
        name,
        owner,
        private: Boolean(result && result.private),
        cloneUrl: result && result.clone_url,
        htmlUrl: result && result.html_url,
        description: result && result.description,
        language: result && result.language,
        defaultBranch: (result && result.default_branch) || 'main',
        stars: 0,
        forks: 0
      };
      let repoList = [];
      let foundRepo = null;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        try {
          repoList = await api.githubRepos();
          foundRepo = repoList.find((item) => item.fullName === fullName) || null;
          if (foundRepo) break;
        } catch (err) {
          // Retry until GitHub's repository list catches up.
        }
        if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (!foundRepo) {
        if (!repoList.some((item) => item.fullName === fullName)) repoList.unshift(fallbackRepo);
        foundRepo = fallbackRepo;
      }
      state.githubRepos = repoList;
      state.repoFilter = '';
      els.repoFilter.value = '';
      renderRepos();
      return { result, repo: foundRepo };
    });
  } catch (err) {
    handleError(t('createRepoFailed'), err);
    return;
  }
  if (created && created.repo) await openCloudRepo(created.repo);
  showToast(t('repoCreated'));
}

async function cloneGithubRepo(repo) {
  if (state.loadingRepo) return;
  await runOperation(t('openingCloudRepo', { name: repo.fullName || repo.name }), async () => {
    const localRepo = await api.githubClone(repo);
    await loadRepos(false);
    await selectRepo(localRepo.id);
    showToast(t('repoCreated'));
  }).catch((err) => handleError(t('openCloudRepoFailed'), err));
}

let modalResolve = null;

function showPrompt(title, options = {}) {
  return new Promise((resolve) => {
    const hasSelect = Array.isArray(options.select) && options.select.length > 0;
    modalResolve = resolve;
    els.modalTitle.textContent = title;
    els.modalMessage.textContent = options.message || '';
    els.modalMessage.style.display = options.message ? 'block' : 'none';
    els.modalField.classList.remove('hidden');
    els.modalInput.classList.toggle('hidden', hasSelect);
    els.modalSelect.classList.toggle('hidden', !hasSelect);
    if (hasSelect) {
      els.modalSelect.innerHTML = options.select.map((value) =>
        `<option value="${escapeAttr(value)}">${escapeHtml(value)}</option>`
      ).join('');
      els.modalSelect.value = options.value || options.select[0];
    } else {
      els.modalInput.value = options.value || '';
      els.modalInput.placeholder = options.placeholder || '';
      els.modalInput.type = options.secret ? 'password' : 'text';
    }
    els.modalOk.textContent = options.confirmText || t('ok');
    els.modalOk.classList.toggle('danger', false);
    els.modalOverlay.classList.remove('hidden');
    setTimeout(() => (hasSelect ? els.modalSelect.focus() : els.modalInput.focus()), 30);
  });
}

function showConfirm(title, message, options = {}) {
  return new Promise((resolve) => {
    modalResolve = resolve;
    els.modalTitle.textContent = title;
    els.modalMessage.textContent = message;
    els.modalMessage.style.display = 'block';
    els.modalField.classList.add('hidden');
    els.modalOk.textContent = options.confirmText || t('ok');
    els.modalOk.classList.toggle('danger', Boolean(options.danger));
    els.modalOverlay.classList.remove('hidden');
    setTimeout(() => els.modalOk.focus(), 30);
  });
}

function closeModal(value) {
  els.modalOverlay.classList.add('hidden');
  if (modalResolve) {
    const resolve = modalResolve;
    modalResolve = null;
    resolve(value);
  }
}

function hasDroppedFiles(event) {
  return Boolean(event.dataTransfer && Array.from(event.dataTransfer.types || []).includes('Files'));
}

function showDropOverlay() {
  if (state.externalDragging) return;
  state.externalDragging = true;
  els.dropOverlay.classList.remove('hidden');
}

function hideDropOverlay() {
  state.externalDragging = false;
  els.dropOverlay.classList.add('hidden');
}

function handleExternalDragOver(event) {
  if (!hasDroppedFiles(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  showDropOverlay();
}

function handleExternalDragLeave(event) {
  if (!event.relatedTarget || !document.body.contains(event.relatedTarget)) {
    hideDropOverlay();
  }
}

function collectDroppedPaths(event) {
  const paths = new Set();
  const addFile = (file) => {
    try {
      const filePath = api.getPathForFile ? api.getPathForFile(file) : file.path;
      if (filePath) paths.add(filePath);
    } catch (err) {
      // Ignore non-native files.
    }
  };
  Array.from(event.dataTransfer.files || []).forEach(addFile);
  Array.from(event.dataTransfer.items || []).forEach((item) => {
    if (item.kind === 'file') {
      const file = item.getAsFile();
      if (file) addFile(file);
    }
  });
  return Array.from(paths);
}

async function handleExternalDrop(event) {
  if (!hasDroppedFiles(event)) return;
  event.preventDefault();
  event.stopPropagation();
  hideDropOverlay();

  if (!state.currentRepo) {
    showToast(t('openRepoFirst'), 'info');
    return;
  }

  const paths = collectDroppedPaths(event);
  if (!paths.length) {
    showToast(t('noImportedFiles'), 'error');
    return;
  }

  let destination = state.currentPath;
  const row = event.target.closest('.tree-item, .github-file-row');
  if (row) {
    destination = row.dataset.kind === 'dir' ? row.dataset.path : parentPath(row.dataset.path);
  }

  await runOperation(state.currentRepo.cloud
    ? t('uploadingCount', { count: paths.length })
    : t('importingCount', { count: paths.length }), async () => {
    if (state.currentRepo.cloud) {
      const result = await api.githubUpload(state.currentRepo.githubFullName, destination, paths, cloudRef());
      if (result.paths && result.paths.length) {
        await refreshAfterFileChange(result.paths[0]);
      } else {
        await refreshAfterFileChange(destination);
      }
      showToast(t('uploadedCount', { count: result.uploaded }));
      setStatus(t('uploadedSynced', { count: result.uploaded }));
      return;
    }
    const result = await api.importPaths(state.currentRepo.id, destination, paths);
    await refreshAfterFileChange(destination);
    if (result.imported.length) {
      await api.gitStage(state.currentRepo.id, result.imported);
      state.gitTab = 'changes';
      els.gitTabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === 'changes'));
      await refreshGitStatus();
    }
    showToast(t('importedStaged', { count: result.imported.length }));
    setStatus(t('importedStagedNote', { count: result.imported.length }));
  }).catch((err) => handleError(state.currentRepo.cloud ? t('uploadFailed') : t('importFailed'), err));
}

function handleDragStart(event) {
  const row = event.target.closest('.tree-item');
  if (!row) return;
  state.dragData = { path: row.dataset.path, kind: row.dataset.kind };
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', row.dataset.path);
}

function handleDragOver(event) {
  const row = event.target.closest('.tree-item[data-kind="dir"]');
  if (!row || !state.dragData) return;
  event.preventDefault();
  row.classList.add('drop-target');
}

function handleDragLeave(event) {
  const row = event.target.closest('.tree-item');
  if (row) row.classList.remove('drop-target');
}

async function handleDrop(event) {
  event.preventDefault();
  const target = event.target.closest('.tree-item[data-kind="dir"]');
  if (target) target.classList.remove('drop-target');
  const source = state.dragData;
  state.dragData = null;
  if (!source || !target || !state.currentRepo) return;
  const dest = target.dataset.path;
  if (dest === source.path || dest.startsWith(`${source.path}/`)) return;
  const name = source.path.split('/').pop();
  const newPath = dest ? `${dest}/${name}` : name;
  const ok = await showConfirm(t('move'), t('moveConfirm', { source: source.path, target: newPath }), { confirmText: t('move'), danger: false });
  if (!ok) return;
  try {
    await api.rename(state.currentRepo.id, source.path, newPath);
    if (state.editorFile && state.editorFile.path === source.path) {
      state.editorFile.path = newPath;
    }
    await refreshAfterFileChange(parentPath(source.path));
    await refreshAfterFileChange(parentPath(newPath));
    showToast(t('moved'));
  } catch (err) {
    handleError(t('moveFailed'), err);
  }
}

document.addEventListener('DOMContentLoaded', init);
