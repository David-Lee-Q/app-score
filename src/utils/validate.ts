export type LinkKey = "cosmocodeUrl" | "openlabUrl" | "repoUrl";

export interface LinkRule {
  key: LinkKey;
  label: string;
  hint: string;
}

export const LINK_RULES: LinkRule[] = [
  {
    key: "cosmocodeUrl",
    label: "COSMO Code应用链接",
    hint: "https://<端口>-<hash>.code.cosmoplat.cn",
  },
  {
    key: "openlabUrl",
    label: "OpenLab文章链接",
    hint: "https://openlab.cosmoplat.com/article-details?id=36968&articleType=0",
  },
  {
    key: "repoUrl",
    label: "开源代码仓",
    hint: "https://gitcode.cosmoplat.com/<用户名>/<仓库名>",
  },
];

export type LinkStatus = "empty" | "ok" | "error";

export interface LinkCheck {
  status: LinkStatus;
  message: string;
}

const REPO_HOSTS = ["gitcode.cosmoplat.com", "github.com", "gitlab.com"];

export function validateLink(key: LinkKey, raw: string): LinkCheck {
  const value = (raw || "").trim();
  if (!value) return { status: "empty", message: "未填写" };

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { status: "error", message: "链接格式无效，请填写完整 URL" };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { status: "error", message: "链接需以 http:// 或 https:// 开头" };
  }

  const host = url.hostname.toLowerCase();

  switch (key) {
    case "cosmocodeUrl": {
      if (!/\.code\.cosmoplat\.cn$/.test(host)) {
        return {
          status: "error",
          message: "应形如 https://<端口>-<hash>.code.cosmoplat.cn",
        };
      }
      return { status: "ok", message: "格式正确" };
    }
    case "openlabUrl": {
      if (host !== "openlab.cosmoplat.com") {
        return {
          status: "error",
          message: "应为 openlab.cosmoplat.com 的文章链接",
        };
      }
      const hasArticle =
        /article/i.test(url.pathname) || url.searchParams.has("id");
      if (!hasArticle) {
        return {
          status: "error",
          message: "缺少文章参数，应形如 /article-details?id=…",
        };
      }
      return { status: "ok", message: "格式正确" };
    }
    case "repoUrl": {
      const matched =
        REPO_HOSTS.includes(host) || host.includes("gitlab") || host.includes("gitcode");
      if (!matched) {
        return {
          status: "error",
          message: "应为 GitCode / GitHub / GitLab 仓库链接",
        };
      }
      const segments = url.pathname
        .replace(/^\/+|\/+$/g, "")
        .split("/")
        .filter(Boolean);
      if (segments.length < 2) {
        return {
          status: "error",
          message: "应包含「用户名/仓库名」，如 /ChallengerV/office-toolkit",
        };
      }
      return { status: "ok", message: "格式正确" };
    }
    default:
      return { status: "ok", message: "格式正确" };
  }
}

export function linkHint(key: LinkKey): string {
  return LINK_RULES.find((r) => r.key === key)?.hint ?? "";
}

export function isLinkKey(key: string): key is LinkKey {
  return key === "cosmocodeUrl" || key === "openlabUrl" || key === "repoUrl";
}
