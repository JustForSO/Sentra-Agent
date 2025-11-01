import axios from 'axios';
import logger from '../../src/logger/index.js';

function parseGitHubRepoSpec(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('GitHub 仓库 URL/标识不能为空');

  // Accept formats:
  // - owner/repo
  // - https://github.com/owner/repo
  // - https://github.com/owner/repo.git
  // - git@github.com:owner/repo.git (best-effort)
  let owner = null;
  let repo = null;

  try {
    if (/^https?:\/\//i.test(raw)) {
      const u = new URL(raw);
      const parts = u.pathname.replace(/^\/+/, '').split('/');
      if (u.hostname && u.hostname.includes('github.com') && parts.length >= 2) {
        owner = parts[0];
        repo = parts[1].replace(/\.git$/i, '');
      }
    } else if (/^git@github\.com:/i.test(raw)) {
      const s = raw.split(':')[1] || '';
      const parts = s.split('/');
      if (parts.length >= 2) {
        owner = parts[0];
        repo = parts[1].replace(/\.git$/i, '');
      }
    } else if (/^[^\s/]+\/[^^\s/]+$/.test(raw)) {
      const parts = raw.split('/');
      owner = parts[0];
      repo = parts[1];
    }
  } catch {}

  if (!owner || !repo) {
    throw new Error('无效的 GitHub 仓库 URL/标识；示例："username/repo" 或 "https://github.com/username/repo"');
  }
  return { owner, repo };
}

async function fetchGitHubAPI(baseURL, path, headers) {
  const url = `${baseURL.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
  const resp = await axios.get(url, { headers, timeout: 20000, validateStatus: () => true });
  const { status, data } = resp;
  if (status >= 400) {
    const msg = (data && data.message) ? data.message : `HTTP ${status}`;
    const err = new Error(msg);
    err.status = status;
    err.data = data;
    throw err;
  }
  return data;
}

function toCNDateTime(iso) {
  try { return new Date(iso).toLocaleString('zh-CN'); } catch { return iso || null; }
}

function buildQuickLinks(owner, repo) {
  const base = `https://github.com/${owner}/${repo}`;
  return {
    仓库: base,
    Issues: `${base}/issues`,
    PullRequests: `${base}/pulls`,
    Actions: `${base}/actions`,
    Releases: `${base}/releases`,
    Contributors: `${base}/graphs/contributors`
  };
}

function buildSummary({ owner, repo, repoData, pureIssuesCount, pullsCount }) {
  const stars = Number(repoData?.stargazers_count || 0);
  const forks = Number(repoData?.forks_count || 0);
  const updated = toCNDateTime(repoData?.updated_at);
  return `仓库 ${owner}/${repo}：⭐ ${stars}，Fork ${forks}，开放 Issues ${pureIssuesCount}、开放 PR ${pullsCount}，最后更新于 ${updated}`;
}

function clamp(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, Math.floor(x)));
}

async function fetchGitHubAPIRaw(baseURL, path, headers, extra = {}) {
  const url = `${baseURL.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
  const resp = await axios.get(url, {
    headers,
    timeout: extra.timeout || 20000,
    responseType: extra.responseType || 'json',
    validateStatus: () => true,
  });
  return resp;
}

function getRateMetaFromHeaders(h = {}) {
  const remaining = h['x-ratelimit-remaining'] ? Number(h['x-ratelimit-remaining']) : undefined;
  const reset = h['x-ratelimit-reset'] ? Number(h['x-ratelimit-reset']) : undefined;
  const limit = h['x-ratelimit-limit'] ? Number(h['x-ratelimit-limit']) : undefined;
  return { remaining, reset, limit };
}

function envBool(v) {
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'y';
}

export default async function handler(args = {}, options = {}) {
  try {
    const penv = options?.pluginEnv || {};
    const repoUrl = String(args.repoUrl || '').trim();
    if (!repoUrl) {
      return { success: false, code: 'INVALID', error: 'repoUrl 为必填参数，例如："username/repo" 或完整 GitHub 链接' };
    }

    const { owner, repo } = parseGitHubRepoSpec(repoUrl);

    const token = String(penv.GITHUB_TOKEN || process.env.GITHUB_TOKEN || penv.GH_TOKEN || process.env.GH_TOKEN || '').trim();
    const baseURL = String(penv.GITHUB_API_BASE || process.env.GITHUB_API_BASE || 'https://api.github.com');
    const apiVersion = String(penv.GITHUB_API_VERSION || process.env.GITHUB_API_VERSION || '2022-11-28');
    const headers = {
      'User-Agent': 'sentra-mcp-github-plugin',
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': apiVersion,
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const defaultMaxCommits = clamp(penv.GITHUB_MAX_COMMITS || process.env.GITHUB_MAX_COMMITS || 5, 1, 50);
    const defaultMaxContributors = clamp(penv.GITHUB_MAX_CONTRIBUTORS || process.env.GITHUB_MAX_CONTRIBUTORS || 5, 1, 50);
    const defaultMaxTags = clamp(penv.GITHUB_MAX_TAGS || process.env.GITHUB_MAX_TAGS || 10, 1, 50);
    const defaultPreviewChars = clamp(penv.GITHUB_README_PREVIEW_CHARS || process.env.GITHUB_README_PREVIEW_CHARS || 400, 50, 5000);

    const maxCommits = clamp(args.max_commits ?? defaultMaxCommits, 1, 50);
    const maxContributors = clamp(args.max_contributors ?? defaultMaxContributors, 1, 50);
    const maxTags = clamp(args.max_tags ?? defaultMaxTags, 1, 50);
    const previewChars = clamp(args.readme_preview_chars ?? defaultPreviewChars, 50, 5000);

    const envIncludeLanguages = envBool(penv.GITHUB_INCLUDE_LANGUAGES || process.env.GITHUB_INCLUDE_LANGUAGES);
    const envIncludeTopics = envBool(penv.GITHUB_INCLUDE_TOPICS || process.env.GITHUB_INCLUDE_TOPICS);
    const envIncludeReleases = envBool(penv.GITHUB_INCLUDE_RELEASES || process.env.GITHUB_INCLUDE_RELEASES);
    const envIncludeTags = envBool(penv.GITHUB_INCLUDE_TAGS || process.env.GITHUB_INCLUDE_TAGS);
    const envIncludeReadme = envBool(penv.GITHUB_INCLUDE_README_PREVIEW || process.env.GITHUB_INCLUDE_README_PREVIEW);
    const envIncludeCommunity = envBool(penv.GITHUB_INCLUDE_COMMUNITY_PROFILE || process.env.GITHUB_INCLUDE_COMMUNITY_PROFILE);
    const envIncludeStatsCommitActivity = envBool(penv.GITHUB_INCLUDE_STATS_COMMIT_ACTIVITY || process.env.GITHUB_INCLUDE_STATS_COMMIT_ACTIVITY);

    const includeLanguages = (args.include_languages !== undefined) ? !!args.include_languages : envIncludeLanguages;
    const includeTopics = (args.include_topics !== undefined) ? !!args.include_topics : envIncludeTopics;
    const includeReleases = (args.include_releases !== undefined) ? !!args.include_releases : envIncludeReleases;
    const includeTags = (args.include_tags !== undefined) ? !!args.include_tags : envIncludeTags;
    const includeReadme = (args.include_readme_preview !== undefined) ? !!args.include_readme_preview : envIncludeReadme;
    const includeCommunity = (args.include_community_profile !== undefined) ? !!args.include_community_profile : envIncludeCommunity;
    const includeStatsCommitActivity = (args.include_stats && typeof args.include_stats.commit_activity !== 'undefined')
      ? !!args.include_stats.commit_activity
      : envIncludeStatsCommitActivity;

    const reqs = [];
    reqs.push({ key: 'repoMeta', p: fetchGitHubAPIRaw(baseURL, `/repos/${owner}/${repo}`, headers) });
    reqs.push({ key: 'commits', p: fetchGitHubAPI(baseURL, `/repos/${owner}/${repo}/commits?per_page=${maxCommits}`, headers) });
    reqs.push({ key: 'issues', p: fetchGitHubAPI(baseURL, `/repos/${owner}/${repo}/issues?state=open&per_page=100`, headers) });
    reqs.push({ key: 'pulls', p: fetchGitHubAPI(baseURL, `/repos/${owner}/${repo}/pulls?state=open&per_page=100`, headers) });
    reqs.push({ key: 'branches', p: fetchGitHubAPI(baseURL, `/repos/${owner}/${repo}/branches?per_page=100`, headers) });
    reqs.push({ key: 'contributors', p: fetchGitHubAPI(baseURL, `/repos/${owner}/${repo}/contributors?per_page=${maxContributors}`, headers) });

    if (includeLanguages) reqs.push({ key: 'languages', p: fetchGitHubAPI(baseURL, `/repos/${owner}/${repo}/languages`, headers) });
    if (includeTopics) reqs.push({ key: 'topics', p: fetchGitHubAPI(baseURL, `/repos/${owner}/${repo}/topics`, headers) });
    if (includeReleases) {
      reqs.push({ key: 'release_latest', p: fetchGitHubAPIRaw(baseURL, `/repos/${owner}/${repo}/releases/latest`, headers) });
      reqs.push({ key: 'release_first', p: fetchGitHubAPI(baseURL, `/repos/${owner}/${repo}/releases?per_page=1`, headers) });
    }
    if (includeTags) reqs.push({ key: 'tags', p: fetchGitHubAPI(baseURL, `/repos/${owner}/${repo}/tags?per_page=${maxTags}`, headers) });
    if (includeReadme) reqs.push({ key: 'readme', p: fetchGitHubAPIRaw(baseURL, `/repos/${owner}/${repo}/readme`, { ...headers, 'Accept': 'application/vnd.github.raw' }, { responseType: 'text' }) });
    if (includeCommunity) reqs.push({ key: 'community', p: fetchGitHubAPI(baseURL, `/repos/${owner}/${repo}/community/profile`, headers) });
    if (includeStatsCommitActivity) reqs.push({ key: 'stats_commit_activity', p: fetchGitHubAPIRaw(baseURL, `/repos/${owner}/${repo}/stats/commit_activity`, headers) });

    const settled = await Promise.allSettled(reqs.map((r) => r.p));
    const resMap = new Map();
    const partialErrors = [];
    for (let i = 0; i < settled.length; i++) {
      const key = reqs[i].key;
      const s = settled[i];
      if (s.status === 'fulfilled') {
        resMap.set(key, s.value);
      } else {
        const err = s.reason || {};
        const code = err?.status || err?.code || 'ERR';
        const message = String(err?.message || err);
        partialErrors.push({ endpoint: key, code, error: message });
      }
    }

    const repoMetaResp = resMap.get('repoMeta');
    if (!repoMetaResp || repoMetaResp.status >= 400) {
      const status = repoMetaResp?.status || null;
      const msg = repoMetaResp?.data?.message || '无法获取仓库信息';
      let code = status || 'ERR';
      if (status === 404) code = 'NOT_FOUND';
      else if (status === 401) code = 'UNAUTHORIZED';
      else if (status === 403 && /rate limit/i.test(String(msg))) code = 'RATE_LIMIT';
      else if (status === 403) code = 'FORBIDDEN';
      return { success: false, code, error: msg };
    }

    const rateMeta = getRateMetaFromHeaders(repoMetaResp.headers || {});
    const repoData = repoMetaResp.data || {};
    const commitsData = resMap.get('commits') || [];
    const issuesData = resMap.get('issues') || [];
    const pullsData = resMap.get('pulls') || [];
    const branchesData = resMap.get('branches') || [];
    const contributorsData = resMap.get('contributors') || [];
    const languagesData = resMap.get('languages') || null;
    const topicsData = resMap.get('topics') || null;
    const releaseLatestResp = resMap.get('release_latest') || null;
    const releaseFirst = resMap.get('release_first') || null;
    const tagsData = resMap.get('tags') || null;
    const readmeResp = resMap.get('readme') || null;
    const communityData = resMap.get('community') || null;
    const statsCommitActivityResp = resMap.get('stats_commit_activity') || null;

    const commits = Array.isArray(commitsData) ? commitsData.map((commit, idx) => ({
      [`提交${idx + 1}`]: {
        消息: commit?.commit?.message || null,
        作者: commit?.commit?.author?.name || commit?.author?.login || null,
        日期: toCNDateTime(commit?.commit?.author?.date),
        SHA: (commit?.sha || '').slice(0, 7) || null,
      }
    })) : [];

    const contributors = Array.isArray(contributorsData) ? contributorsData.map((c) => ({
      用户名: c?.login || null,
      贡献数: c?.contributions ?? null,
      头像: c?.avatar_url || null,
      主页: c?.html_url || null,
    })) : [];

    // GitHub issues API会包含PR项（带 pull_request 字段）；此处只统计纯 Issues 数量
    const pureIssuesCount = Array.isArray(issuesData) ? issuesData.filter((it) => !it?.pull_request).length : 0;

    const pullsCount = Array.isArray(pullsData) ? pullsData.length : 0;

    const info = {
      基本信息: {
        仓库名称: repoData?.name || `${owner}/${repo}`,
        描述: repoData?.description || '无描述',
        创建时间: toCNDateTime(repoData?.created_at),
        最后更新: toCNDateTime(repoData?.updated_at),
        默认分支: repoData?.default_branch || null,
        Star数量: repoData?.stargazers_count ?? null,
        Fork数量: repoData?.forks_count ?? null,
        Watch数量: (repoData?.subscribers_count ?? repoData?.watchers_count) ?? null,
        开放Issues: pureIssuesCount,
        开放PullRequests: pullsCount,
        分支数量: Array.isArray(branchesData) ? branchesData.length : 0,
        语言: repoData?.language || null,
        URL: repoData?.html_url || `https://github.com/${owner}/${repo}`,
        是否归档: !!repoData?.archived,
        许可证: repoData?.license?.name || '未指定',
      },
      概要: buildSummary({ owner, repo, repoData, pureIssuesCount, pullsCount }),
      最近提交: commits,
      主要贡献者: contributors,
      快速链接: buildQuickLinks(owner, repo),
    };

    if (languagesData && typeof languagesData === 'object') {
      info.语言统计 = languagesData;
    }
    if (topicsData && typeof topicsData === 'object' && Array.isArray(topicsData.names)) {
      info.话题 = topicsData.names;
    }
    if (includeReleases) {
      let latest = null;
      if (releaseLatestResp && releaseLatestResp.status === 200) latest = releaseLatestResp.data || null;
      if (!latest && Array.isArray(releaseFirst) && releaseFirst.length > 0) latest = releaseFirst[0];
      if (latest) {
        info.最新发布 = {
          tag: latest?.tag_name || null,
          name: latest?.name || null,
          created_at: toCNDateTime(latest?.created_at || latest?.published_at),
          html_url: latest?.html_url || null,
        };
      }
    }
    if (Array.isArray(tagsData)) {
      info.标签 = tagsData.map((t) => ({ name: t?.name || null, commit_sha: t?.commit?.sha || null }));
    }
    if (readmeResp && typeof readmeResp.data === 'string') {
      const text = readmeResp.data;
      info.README预览 = text.slice(0, previewChars);
    }
    if (communityData && typeof communityData === 'object') {
      info.社区健康 = {
        健康百分比: communityData.health_percentage ?? null,
        详情: communityData,
      };
    }
    if (statsCommitActivityResp) {
      const st = Number(statsCommitActivityResp.status || 0);
      if (st === 202) {
        info.统计 = { 提交活跃度: { calculating: true } };
      } else if (Array.isArray(statsCommitActivityResp.data)) {
        info.统计 = { 提交活跃度: statsCommitActivityResp.data };
      }
    }

    info.元数据 = { rate_limit: rateMeta, partial_errors: partialErrors };

    return { success: true, data: info };
  } catch (e) {
    const msg = String(e?.message || e);
    const status = e?.status || (e?.response?.status) || null;
    let code = status || 'ERR';
    if (status === 404) code = 'NOT_FOUND';
    else if (status === 401) code = 'UNAUTHORIZED';
    else if (status === 403 && /rate limit/i.test(msg)) code = 'RATE_LIMIT';
    else if (status === 403) code = 'FORBIDDEN';

    let hint = undefined;
    if (code === 'RATE_LIMIT') {
      hint = '命中 GitHub API 速率限制。建议在 plugins/github_repo_info/.env 中配置 GITHUB_TOKEN 或 GH_TOKEN 提升配额。';
    } else if (code === 'UNAUTHORIZED') {
      hint = '未授权访问 GitHub API，请检查令牌是否有效或是否需要令牌访问私有仓库。';
    } else if (code === 'NOT_FOUND') {
      hint = '仓库不存在、已重命名，或当前凭据无权访问。请核对 owner/repo 或使用具有权限的令牌。';
    }
    try { logger.error('github_repo_info: 调用失败', { label: 'PLUGIN', error: msg, status, code }); } catch {}
    const out = { success: false, code, error: msg };
    if (hint) out.hint = hint;
    return out;
  }
}
